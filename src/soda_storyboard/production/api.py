# ruff: noqa: RUF001
# Chinese user-facing diagnostics intentionally use Chinese punctuation.
"""Public, print-free production operations shared by CLI and the P4a server."""

from __future__ import annotations

import copy
import json
import secrets
import shutil
from collections import Counter
from pathlib import Path
from typing import TYPE_CHECKING, Any

from PIL import Image, ImageDraw, ImageOps

from soda_storyboard.compiler import character_caption, compile_geometry_map, compile_page
from soda_storyboard.lettering import layout_texts

from .check import page_graph
from .errors import ProductionError, production_operation
from .graphs import minimal_graph, node
from .imaging import (
    candidate_sheet,
    figure_mask,
    inset_quad,
    open_rgb,
    panel_box,
    panel_size,
    preserve_text,
    quad_mask,
)
from .lettering import letter_image
from .state import PageState, digest, identifier, save_json, stamp
from .state import page_ids as project_page_ids

if TYPE_CHECKING:
    from soda_storyboard.models import Character, Page, Panel

    from .client import Progress

type JSON = dict[str, Any]
OPAQUE = 255


def panel_characters(panel: Panel) -> list[str]:
    return list(dict.fromkeys([*panel.character_ids, *(f.character_id for f in panel.figures)]))


def select_lora(page: Page, characters: dict[str, Character], selection: str = "auto") -> JSON | None:
    if selection == "none":
        return None
    counts = Counter(c for panel in page.panels for c in panel_characters(panel))
    counts.update(o.character_id for o in page.overlays if o.mode == "moss")
    if selection == "auto":
        eligible = [c for c in characters.values() if c.lora and counts[c.id]]
        if not eligible:
            return None
        # Stable lexical tie-break independent of filesystem enumeration.
        selection = min(eligible, key=lambda c: (-counts[c.id], c.id)).id
    character = characters.get(selection)
    if not character or not character.lora:
        msg = f"角色 {selection} 不存在或没有 LoRA"
        raise ProductionError(msg)
    if not counts[selection] and not any(o.character_id == selection for o in page.overlays):
        msg = f"角色 {selection} 没有在此页出场"
        raise ProductionError(msg)
    return {"character_id": selection, **character.lora.to_dict()}


def _canvas(state: PageState) -> tuple[int, int]:
    return state.page.canvas_width, state.page.canvas_height


def _character_lora(state: PageState, character_id: str) -> JSON | None:
    character = state.characters.get(character_id)
    if character is None:
        message = f"找不到角色卡：{character_id}"
        raise ProductionError(message)
    return {"character_id": character_id, **character.lora.to_dict()} if character.lora else None


def _normalize_png(path: Path, size: tuple[int, int]) -> None:
    open_rgb(path, size).save(path, format="PNG")


@production_operation
def generate_page(  # noqa: PLR0913 -- fixed P4a API signature
    project_dir: str | Path,
    page_id: str,
    *,
    seeds: int = 4,
    preset: str = "draft",
    model: str | None = None,
    lora: str = "auto",
    progress: Progress = None,
) -> list[dict]:
    if isinstance(seeds, bool) or not isinstance(seeds, int) or seeds < 1:
        msg = "seeds 必须是大于 0 的整数（候选数量）"
        raise ProductionError(msg)
    state = PageState(project_dir, page_id)
    chosen = select_lora(state.page, state.characters, lora)
    generation_page = copy.deepcopy(state.page)
    # Keep program-lettered text out of the diffusion prompt while retaining
    # its geometry in the cut sidecar and the original page document.
    generation_page.texts = [t for t in generation_page.texts if t.extra.get("render_mode") != "lettering"]
    compiled = compile_page(generation_page, state.characters)
    prompt = json.dumps(compiled, ensure_ascii=False)
    compiled_hash = digest(compiled)
    save_json(state.directory / "compiled.moss.json", compiled)
    save_json(state.directory / "compiled.moss.cut.json", compile_geometry_map(state.page))
    timestamp = stamp()
    results = []
    client = state.client()
    for index in range(seeds):
        seed = secrets.randbits(63)
        path = state.directory / "renders" / f"{timestamp}_{seed}.png"
        graph = page_graph(
            state,
            prompt,
            model=model,
            preset=preset,
            seed=seed,
            width=state.page.canvas_width,
            height=state.page.canvas_height,
            lora=chosen,
            prefix=f"soda-storyboard/{page_id}/{timestamp}_{seed}",
        )
        if progress:
            progress({"stage": "candidate", "index": index + 1, "total": seeds, "seed": seed})
        client.run(
            graph, path, progress=progress, output_node="81" if state.config["backend"] == "v2" else "10"
        )
        _normalize_png(path, _canvas(state))
        meta = {
            "preset": preset,
            "model": model or state.config["model"],
            "model_file": graph["135:111" if state.config["backend"] == "v2" else "1"]["inputs"]["unet_name"],
            "clip_file": state.config["clip"],
            "vae_file": state.config["vae"],
            "lora": chosen,
            "json_hash": compiled_hash,
            "backend": state.config["backend"],
            "created_at": timestamp,
        }
        record = {"path": state.relative(path), "seed": seed, "meta": meta}
        state.production.setdefault("renders", []).append(record)
        state.save()  # Keep earlier candidates if a later one fails or times out.
        results.append({"path": str(path), "seed": seed, "meta": dict(meta)})
    sheet = state.directory / "renders" / f"{timestamp}_candidates.png"
    candidate_sheet([Path(r["path"]) for r in results], [r["seed"] for r in results], sheet)
    state.production["candidate_sheet"] = state.relative(sheet)
    state.save()
    for record in results:
        record["meta"]["candidate_sheet"] = str(sheet)
    return results


def _registered(records: list[JSON], state: PageState, requested: str | Path) -> JSON:
    """Accept an exact registered path or an unambiguous filename, never an arbitrary image."""
    value = str(requested)
    candidates = [r for r in records if state.local(r["path"]).resolve() == state.local(requested).resolve()]
    if not candidates and Path(value).name == value:
        candidates = [r for r in records if Path(r["path"]).name == value]
    if len(candidates) != 1:
        msg = f"结果未登记或名称不唯一，请提供返回的完整路径：{requested}"
        raise ProductionError(msg)
    record = candidates[0]
    if not state.local(record["path"]).is_file():
        msg = f"结果图片不存在：{record['path']}"
        raise ProductionError(msg)
    return record


@production_operation
def pick_render(project_dir: str | Path, page_id: str, render_path: str | Path) -> dict:
    state = PageState(project_dir, page_id)
    record = _registered(state.production.get("renders", []), state, render_path)
    if state.production.get("selected_render") != record["path"]:
        state.production["selected_render"] = record["path"]
        for panel in state.raw["panels"]:
            panel.get("production", {}).pop("selected", None)
        state.invalidate()
    state.save()
    return {**record, "path": str(state.local(record["path"]))}


def _selected_panel(state: PageState, panel_id: str) -> JSON | None:
    data = state.panel(panel_id).get("production", {})
    selected = data.get("selected")
    for record in data.get("renders", []):
        if record["path"] == selected and record.get("source_render") == state.production.get(
            "selected_render"
        ):
            return record
    return None


@production_operation
def production_plan(project_dir: str | Path, page_id: str) -> dict:
    state = PageState(project_dir, page_id)
    selected = state.production.get("selected_render")
    render = next((r for r in state.production.get("renders", []) if r["path"] == selected), {})
    main = (render.get("meta", {}).get("lora") or {}).get("character_id")
    swaps, cuts = [], []
    for panel in sorted(state.page.panels, key=lambda p: p.order):
        current = _selected_panel(state, panel.id)
        done = (current or {}).get("resolved_characters", [])
        characters = panel_characters(panel)
        swaps.extend(
            {
                "panel_id": panel.id,
                "character_id": char_id,
                "mode": "inpaint" if len(characters) > 1 else "swap",
                "denoise": 0.85,
            }
            for char_id in characters
            if (
                char_id != main
                and char_id not in done
                and state.characters.get(char_id)
                and state.characters[char_id].lora
            )
        )
        if panel.shape_type == "quad":
            cuts.append(
                {"panel_id": panel.id, "quad": panel.shape["points"], "cut_inset": state.config["cut_inset"]}
            )
    overlays = [
        {
            "overlay_id": o.id,
            "character_id": o.character_id,
            "needs_cutout": not bool(_overlay_path(state, o.id)),
        }
        for o in state.page.overlays
        if o.mode == "layer"
    ]
    texts = [
        t.id
        for t in layout_texts(state.page)
        if state.page.dialogue_mode == "lettering" or t.extra.get("render_mode") == "lettering"
    ]
    composed = state.image_stage("composed")
    lettered = state.image_stage("lettered")
    return {
        "page_id": state.page.page_id,
        "selected_render": str(state.local(selected)) if selected else None,
        "needs_pick": not bool(selected),
        "main_character": main,
        "redraws": swaps,
        "cuts": cuts if not composed else [],
        "overlays": overlays,
        "lettering": {"needed": bool(texts) and not bool(lettered), "text_ids": texts},
        "needs_compose": not bool(composed),
        "warnings": ["人物遮罩由 figures 估计；请先查看遮罩，重叠人物建议提供明确的 bbox。"]
        if any(s["mode"] == "inpaint" for s in swaps)
        else [],
    }


@production_operation
def split_page(project_dir: str | Path, page_id: str) -> list[dict]:
    state = PageState(project_dir, page_id)
    image = open_rgb(state.base(), _canvas(state))
    result = []
    for panel in state.page.panels:
        folder = state.directory / "panels" / identifier(panel.id)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / "original.png"
        mask = folder / "quad-mask.png"
        image.crop(panel_box(panel)).save(path)
        quad_mask(panel).save(mask)
        record = {
            "path": state.relative(path),
            "mask": state.relative(mask),
            "source_render": state.production["selected_render"],
        }
        state.panel(panel.id).setdefault("production", {})["split"] = record
        result.append({"panel_id": panel.id, "path": str(path), "mask": str(mask)})
    state.save()
    return result


def _panel_source(state: PageState, panel: Panel) -> Image.Image:
    selected = _selected_panel(state, panel.id)
    if selected:
        return open_rgb(state.local(selected["path"]), panel_size(panel))
    return open_rgb(state.base(), _canvas(state)).crop(panel_box(panel))


def _single_prompt(state: PageState, panel: Panel, character_id: str | None) -> str:
    caption = panel.caption_en or panel.description
    if not caption:
        msg = f"格子 {panel.id} 缺少单格画面描述，请填写 caption_en"
        raise ProductionError(msg)
    character = character_caption(character_id, state.characters) if character_id else ""
    return ". ".join(
        s
        for s in (
            (
                "A single manga illustration, one frame only, no panel borders, "
                "no gutters, no text, no speech bubbles"
            ),
            caption,
            character,
        )
        if s
    )


def _redraw(  # noqa: PLR0913, PLR0915 -- shared generation and version registration transaction
    state: PageState,
    panel_id: str,
    *,
    mode: str,
    character_id: str | None,
    denoise: float,
    progress: Progress,
    margin: int = 24,
    feather: int = 16,
) -> dict:
    state.base()
    state.panel(panel_id)
    panel = next(p for p in state.page.panels if p.id == panel_id)
    if character_id and character_id not in panel_characters(panel):
        msg = f"角色 {character_id} 没有在格子 {panel_id} 出场"
        raise ProductionError(msg)
    chosen = None
    if character_id:
        chosen = _character_lora(state, character_id)
    elif mode == "detail":
        selected = next(
            (
                r
                for r in state.production.get("renders", [])
                if r["path"] == state.production.get("selected_render")
            ),
            {},
        )
        candidate = (selected.get("meta", {}).get("lora") or {}).get("character_id")
        if candidate in panel_characters(panel):
            chosen = select_lora(state.page, state.characters, candidate)
    if mode in {"swap", "inpaint"} and not character_id:
        msg = "换人重画必须指定 --character"
        raise ProductionError(msg)
    if mode == "swap" and len(panel_characters(panel)) > 1:
        msg = "两人同格请使用 inpaint，避免整格换人覆盖另一角色"
        raise ProductionError(msg)
    original = _panel_source(state, panel)
    folder = state.directory / "panels" / identifier(panel_id)
    folder.mkdir(parents=True, exist_ok=True)
    token, seed = stamp(), secrets.randbits(63)
    source = folder / f"{token}_input.png"
    upload = original.convert("RGBA")
    mask = None
    mask_path = None
    if mode == "inpaint":
        mask = figure_mask(panel, state.page, character_id, margin=margin, feather=feather)
        mask_path = folder / f"{token}_mask.png"
        mask.save(mask_path)
        upload.putalpha(ImageOps.invert(mask))
    # MOSS latent dimensions must be multiples of 16; resize the alpha with the RGB.
    width, height = max(16, round(original.width / 16) * 16), max(16, round(original.height / 16) * 16)
    upload.resize((width, height), Image.Resampling.LANCZOS).save(source)
    client = state.client()
    uploaded = client.upload(source)
    graph = minimal_graph(
        _single_prompt(state, panel, character_id),
        config=state.config,
        preset=state.config["preset"],
        seed=seed,
        width=width,
        height=height,
        lora=chosen,
        image=uploaded,
        denoise=denoise,
        inpaint=mode == "inpaint",
        prefix=f"soda-storyboard/{state.page.page_id}/{panel_id}_{token}",
    )
    destination = folder / f"{token}_{seed}.png"
    client.run(graph, destination, progress=progress)
    redrawn = open_rgb(destination, original.size)
    if mask is not None:
        # Also enforce preservation locally, independent of server node behavior.
        redrawn = Image.composite(redrawn, original, mask)
    redrawn = preserve_text(original, redrawn, panel, state.page)
    redrawn.save(destination)
    previous = _selected_panel(state, panel_id) or {}
    resolved = set(previous.get("resolved_characters", []))
    if mode in {"swap", "inpaint"}:
        resolved.add(character_id)
    record = {
        "path": state.relative(destination),
        "seed": seed,
        "mode": mode,
        "character_id": character_id,
        "denoise": denoise,
        "lora": chosen,
        "source_render": state.production["selected_render"],
        "resolved_characters": sorted(resolved),
        "mask": state.relative(mask_path) if mask_path else None,
    }
    state.panel(panel_id).setdefault("production", {}).setdefault("renders", []).append(record)
    state.save()
    return {**record, "path": str(destination), "mask": str(mask_path) if mask_path else None}


@production_operation
def redraw_panel(  # noqa: PLR0913 -- fixed P4a API signature
    project_dir: str | Path,
    page_id: str,
    panel_id: str,
    *,
    mode: str = "detail",
    character_id: str | None = None,
    denoise: float | None = None,
    progress: Progress = None,
) -> dict:
    if mode not in {"detail", "swap"}:
        msg = "重画模式必须是 detail 或 swap"
        raise ProductionError(msg)
    strength = (0.45 if mode == "detail" else 0.85) if denoise is None else denoise
    if not 0 <= strength <= 1:
        msg = "denoise 必须在 0 到 1 之间"
        raise ProductionError(msg)
    return _redraw(
        PageState(project_dir, page_id),
        panel_id,
        mode=mode,
        character_id=character_id,
        denoise=strength,
        progress=progress,
    )


@production_operation
def inpaint_panel(  # noqa: PLR0913 -- explicit mask geometry options
    project_dir: str | Path,
    page_id: str,
    panel_id: str,
    *,
    character_id: str,
    denoise: float = 0.85,
    margin: int = 24,
    feather: int = 16,
    progress: Progress = None,
) -> dict:
    if not 0 <= denoise <= 1:
        msg = "denoise 必须在 0 到 1 之间"
        raise ProductionError(msg)
    return _redraw(
        PageState(project_dir, page_id),
        panel_id,
        mode="inpaint",
        character_id=character_id,
        denoise=denoise,
        progress=progress,
        margin=margin,
        feather=feather,
    )


@production_operation
def pick_panel(project_dir: str | Path, page_id: str, panel_id: str, render_path: str | Path) -> dict:
    state = PageState(project_dir, page_id)
    data = state.panel(panel_id).setdefault("production", {})
    record = _registered(data.get("renders", []), state, render_path)
    if record.get("source_render") != state.production.get("selected_render"):
        msg = "该格结果来自另一张整页底图，请重新重画或切换回对应底图"
        raise ProductionError(msg)
    data["selected"] = record["path"]
    state.invalidate()
    state.save()
    return {**record, "path": str(state.local(record["path"]))}


def _overlay_path(state: PageState, overlay_id: str) -> Path | None:
    record = state.production.get("overlays", {}).get(overlay_id, {})
    overlay = next(o for o in state.page.overlays if o.id == overlay_id)
    path = record.get("path") or overlay.image_path
    return state.local(path) if path and state.local(path).is_file() else None


def _apply_overlays(state: PageState, image: Image.Image) -> Image.Image:
    result = image.convert("RGBA")
    for overlay in sorted(state.page.overlays, key=lambda o: o.z_index):
        if overlay.mode != "layer":
            continue
        path = _overlay_path(state, overlay.id)
        if not path:
            continue
        with Image.open(path) as source:
            layer = source.convert("RGBA")
        rect = overlay.rect
        layer.thumbnail((max(1, round(rect.w)), max(1, round(rect.h))), Image.Resampling.LANCZOS)
        result.alpha_composite(
            layer, (round(rect.x + (rect.w - layer.width) / 2), round(rect.y + rect.h - layer.height))
        )
    return result.convert("RGB")


@production_operation
def compose_page(project_dir: str | Path, page_id: str) -> str:
    return compose_with_options(project_dir, page_id)


@production_operation
def compose_with_options(
    project_dir: str | Path, page_id: str, *, cut_inset: float | None = None, border_width: int | None = None
) -> str:
    state = PageState(project_dir, page_id)
    inset = state.config["cut_inset"] if cut_inset is None else cut_inset
    border = state.config["border_width"] if border_width is None else border_width
    if inset < 0 or border < 1:
        msg = "cut-inset 不能为负，格框宽度至少为 1"
        raise ProductionError(msg)
    image = open_rgb(state.base(), _canvas(state))
    sources = {p.id: _panel_source(state, p) for p in state.page.panels}
    # Clear all quad bounding rectangles first; repaste EVERY panel afterwards,
    # so a neighbouring panel cannot be erased by another quad's white fill.
    for panel in state.page.panels:
        if panel.shape_type == "quad":
            image.paste("white", panel_box(panel))
    for panel in sorted(state.page.panels, key=lambda p: p.order):
        x, y, _, _ = panel_box(panel)
        image.paste(sources[panel.id], (x, y), quad_mask(panel, inset=inset))
    draw = ImageDraw.Draw(image)
    for panel in state.page.panels:
        if panel.shape_type == "quad":
            points = inset_quad(panel.shape["points"], inset)
            draw.line([*points, points[0]], fill="black", width=border, joint="curve")
    state.directory.mkdir(parents=True, exist_ok=True)
    underlay = state.directory / "composed-underlay.png"
    image.save(underlay)
    destination = state.directory / "composed.png"
    _apply_overlays(state, image).save(destination)
    state.production["composed"] = {
        "path": state.relative(destination),
        "underlay": state.relative(underlay),
        "signature": state.signature(),
        "cut_inset": inset,
        "border_width": border,
    }
    state.production.pop("lettered", None)
    state.save()
    return str(destination)


@production_operation
def letter_page(project_dir: str | Path, page_id: str) -> str:
    return letter_with_options(project_dir, page_id)


@production_operation
def letter_with_options(
    project_dir: str | Path,
    page_id: str,
    *,
    font: str | Path | None = None,
    text_ids: list[str] | None = None,
) -> str:
    state = PageState(project_dir, page_id)
    if not state.image_stage("composed"):
        compose_page(project_dir, page_id)
        state = PageState(project_dir, page_id)
    image = open_rgb(state.local(state.production["composed"]["underlay"]), _canvas(state))
    result = _apply_overlays(state, letter_image(image, state.page, font=font, text_ids=text_ids))
    destination = state.directory / "lettered.png"
    result.save(destination)
    state.production["lettered"] = {
        "path": state.relative(destination),
        "signature": state.signature(),
        "font": str(font) if font else None,
        "text_ids": text_ids,
    }
    state.save()
    return str(destination)


@production_operation
def export(project_dir: str | Path, page_ids: list[str] | None = None, fmt: str = "png") -> list[str]:
    if fmt not in {"png", "pdf"}:
        msg = "导出格式必须是 png 或 pdf"
        raise ProductionError(msg)
    ids = project_page_ids(project_dir) if page_ids is None else page_ids
    if not ids:
        msg = "项目中没有可导出的页面"
        raise ProductionError(msg)
    folder = Path(project_dir).resolve() / "exports"
    folder.mkdir(parents=True, exist_ok=True)
    images, outputs = [], []
    for page_id in ids:
        state = PageState(project_dir, page_id)
        source = state.image_stage("lettered") or state.image_stage("composed") or state.base()
        if fmt == "png":
            path = folder / f"{identifier(page_id)}.png"
            shutil.copyfile(source, path)
            outputs.append(str(path))
        else:
            images.append(open_rgb(source))
    if fmt == "pdf":
        destination = folder / "storyboard.pdf"
        images[0].save(destination, "PDF", save_all=True, append_images=images[1:], resolution=150)
        outputs.append(str(destination))
    return outputs


def _remove_background_node(definition: JSON, class_name: str) -> tuple[JSON, int]:
    inputs = {}
    for key, spec in definition.get("input", {}).get("required", {}).items():
        kind = spec[0]
        options = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
        if kind == "IMAGE":
            inputs[key] = ["9", 0]
        elif "default" in options:
            inputs[key] = options["default"]
        elif isinstance(kind, list) and kind:
            inputs[key] = kind[0]
        else:
            msg = f"抠图节点 {class_name} 的必填参数 {key} 没有默认值，请提供已抠好的 PNG"
            raise ProductionError(msg)
    if not any(isinstance(v, list) and v == ["9", 0] for v in inputs.values()):
        msg = f"抠图节点 {class_name} 未声明 IMAGE 输入，请提供已抠好的 PNG"
        raise ProductionError(msg)
    outputs = definition.get("output", [])
    if "IMAGE" not in outputs:
        msg = f"抠图节点 {class_name} 未声明 IMAGE 输出，请提供已抠好的 PNG"
        raise ProductionError(msg)
    return node(class_name, **inputs), outputs.index("IMAGE")


@production_operation
def cutout(
    project_dir: str | Path,
    page_id: str,
    overlay_id: str,
    *,
    png: str | Path | None = None,
    progress: Progress = None,
) -> dict:
    state = PageState(project_dir, page_id)
    state.base()
    overlay = next((o for o in state.page.overlays if o.id == overlay_id), None)
    if overlay is None or overlay.mode != "layer":
        msg = f"找不到 mode: layer 的出格图层：{overlay_id}"
        raise ProductionError(msg)
    destination = state.directory / "overlays" / f"{identifier(overlay_id)}_{stamp()}.png"
    destination.parent.mkdir(parents=True, exist_ok=True)
    if png:
        source = state.local(png)
        with Image.open(source) as image:
            if "A" not in image.getbands() or image.getchannel("A").getextrema()[0] == OPAQUE:
                msg = "出格图层需要带透明背景的 PNG"
                raise ProductionError(msg)
            image.convert("RGBA").save(destination)
    else:
        client = state.client()
        definition, class_name = None, None
        for name in ("BiRefNetRMBG", "RMBG", "Image Remove Background (rembg)"):
            info = client.object_info(name)
            if name in info:
                definition, class_name = info[name], name
                break
        if definition is None:
            msg = (
                "缺少抠图节点，请安装 ComfyUI-RMBG（BiRefNetRMBG / RMBG）或 rembg 节点；"
                "也可用 cutout --png 提供已抠好的透明 PNG"
            )
            raise ProductionError(msg)
        remove, output_index = _remove_background_node(definition, class_name)
        chosen = _character_lora(state, overlay.character_id)
        prompt = (
            "A single solo character illustration, one person only, full body, plain solid white background, "
            "no panel borders, no text, no speech bubbles. "
            + character_caption(overlay.character_id, state.characters)
            + ". "
            + overlay.description
        )
        width = max(16, round(overlay.rect.w / 16) * 16)
        height = max(16, round(overlay.rect.h / 16) * 16)
        graph = minimal_graph(
            prompt,
            config=state.config,
            preset=state.config["preset"],
            lora=chosen,
            width=width,
            height=height,
            seed=secrets.randbits(63),
        )
        graph["cutout"] = remove
        graph["10"]["inputs"]["images"] = ["cutout", output_index]
        client.run(graph, destination, progress=progress)
        with Image.open(destination) as image:
            if "A" not in image.getbands() or image.getchannel("A").getextrema()[0] == OPAQUE:
                msg = f"节点 {class_name} 未返回透明图片，请提供已抠好的 PNG"
                raise ProductionError(msg)
    old_lettering = state.production.get("lettered")
    state.production.setdefault("overlays", {})[overlay_id] = {"path": state.relative(destination)}
    state.invalidate()
    state.save()
    result = compose_page(project_dir, page_id)
    if old_lettering:
        result = letter_with_options(
            project_dir, page_id, font=old_lettering.get("font"), text_ids=old_lettering.get("text_ids")
        )
    return {"overlay_id": overlay_id, "path": str(destination), "page_path": result}


__all__ = [
    "compose_page",
    "cutout",
    "export",
    "generate_page",
    "inpaint_panel",
    "letter_page",
    "pick_panel",
    "pick_render",
    "production_plan",
    "redraw_panel",
    "split_page",
]
