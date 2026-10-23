# ruff: noqa: RUF001
# Chinese user-facing diagnostics intentionally use Chinese punctuation.
"""Public, print-free production operations shared by CLI and the P4a server."""

from __future__ import annotations

import copy
import hashlib
import json
import re
import secrets
import shutil
from pathlib import Path
from typing import TYPE_CHECKING, Any

from PIL import Image, ImageDraw

from soda_storyboard.compiler import character_caption, compile_geometry_map, compile_page, panel_caption
from soda_storyboard.figure_semantics import figure_page_box
from soda_storyboard.figures import panel_figures
from soda_storyboard.io import read_json
from soda_storyboard.json_safety import check_json_numbers
from soda_storyboard.lettering import layout_texts
from soda_storyboard.lora import panel_characters, select_lora
from soda_storyboard.persistence import page_lock

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
    working_size,
)
from .lettering import letter_image
from .state import PageState, digest, identifier, save_json, stamp
from .state import page_ids as project_page_ids

if TYPE_CHECKING:
    from soda_storyboard.models import Overlay, Panel

    from .client import Progress

type JSON = dict[str, Any]
OPAQUE = 255
MAX_SEED = 2**64 - 1


def _seed(value: int | None) -> int:
    if value is None:
        return secrets.randbits(63)
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_SEED:
        msg = "seed 必须是 0 到 18446744073709551615 之间的整数"
        raise ProductionError(msg)
    return value


def _generation_seeds(count: int, seed: int | list[int] | tuple[int, ...] | None) -> list[int]:
    if isinstance(count, bool) or not isinstance(count, int) or count < 1:
        msg = "seeds 必须是大于 0 的整数（候选数量）"
        raise ProductionError(msg)
    # Explicit values are the complete candidate list; never silently append
    # random candidates when the historical default count is still four.
    if seed is None:
        return [_seed(None) for _ in range(count)]
    values = list(seed) if isinstance(seed, (list, tuple)) else [seed]
    if not values:
        msg = "seed 列表不能为空"
        raise ProductionError(msg)
    return [_seed(value) for value in values]


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
    seed: int | list[int] | tuple[int, ...] | None = None,
    preset: str = "draft",
    model: str | None = None,
    lora: str = "auto",
    progress: Progress = None,
) -> list[dict]:
    selected_seeds = _generation_seeds(seeds, seed)
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
    for index, actual_seed in enumerate(selected_seeds):
        path = state.directory / "renders" / f"{timestamp}_{index + 1}_{actual_seed}.png"
        graph = page_graph(
            state,
            prompt,
            model=model,
            preset=preset,
            seed=actual_seed,
            width=state.page.canvas_width,
            height=state.page.canvas_height,
            lora=chosen,
            prefix=f"soda-storyboard/{page_id}/{timestamp}_{index + 1}_{actual_seed}",
        )
        if progress:
            progress(
                {"stage": "candidate", "index": index + 1, "total": len(selected_seeds), "seed": actual_seed}
            )
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
        record = {"path": state.relative(path), "seed": actual_seed, "meta": meta}
        state.production.setdefault("renders", []).append(record)
        state.save()  # Keep earlier candidates if a later one fails or times out.
        results.append({"path": str(path), "seed": actual_seed, "meta": dict(meta)})
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


def _select_page_render(state: PageState, path: str) -> None:
    if state.production.get("selected_render") != path:
        state.production["selected_render"] = path
        for panel in state.raw["panels"]:
            panel.get("production", {}).pop("selected", None)
        state.invalidate()


def _render_target(state: PageState, panel_id: str | None, overlay_id: str | None) -> tuple[JSON, Path]:
    if panel_id is not None and overlay_id is not None:
        msg = "panel_id 和 overlay_id 不能同时指定"
        raise ProductionError(msg)
    if panel_id is not None:
        data = state.panel(panel_id).setdefault("production", {})
        state.base()  # Bind panel candidates to an existing selected page render.
        return data, state.directory / "panels" / identifier(panel_id) / "renders"
    if overlay_id is not None:
        overlay = next((o for o in state.page.overlays if o.id == overlay_id and o.mode == "layer"), None)
        if overlay is None:
            msg = f"找不到 mode: layer 的出格图层：{overlay_id}"
            raise ProductionError(msg)
        data = state.production.setdefault("overlays", {}).setdefault(overlay_id, {})
        return data, state.directory / "overlays" / identifier(overlay_id) / "renders"
    return state.production, state.directory / "renders"


def _check_render_image(path: Path) -> None:
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            image.load()
    except (OSError, ValueError, SyntaxError) as exc:
        msg = "登记源文件不是有效图片，请提供可解码的图片文件"
        raise ProductionError(msg) from exc


def _import_render(state: PageState, image_path: str | Path, folder: Path) -> Path:
    # Explicit external inputs are allowed; every destination still goes through
    # the same resolved project-boundary check as other production operations.
    source = Path(image_path)
    if not source.is_absolute():
        source = state.root / source
    source = source.resolve()
    _check_render_image(source)
    destination = state.local(folder / f"{stamp()}_{secrets.token_hex(8)}{source.suffix or '.img'}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    try:
        _check_render_image(destination)
    except ProductionError:
        destination.unlink(missing_ok=True)
        raise
    return destination


def _render_metadata(meta: JSON | None, preset: str | None, model: str | None) -> JSON:
    if meta is not None and not isinstance(meta, dict):
        msg = "meta 必须是 JSON 对象"
        raise ProductionError(msg)
    metadata = copy.deepcopy(meta) if meta is not None else {}
    metadata["created_at"] = stamp()
    for key, value in (("preset", preset), ("model", model)):
        if value is not None:
            if not isinstance(value, str):
                msg = f"{key} 必须是字符串"
                raise ProductionError(msg)
            metadata[key] = value
    check_json_numbers(metadata)
    json.dumps(metadata, allow_nan=False)
    return metadata


def _save_registered_render(
    state: PageState, panel_id: str | None, overlay_id: str | None, *, select: bool
) -> None:
    if panel_id is None and overlay_id is None:
        state.save()
        return
    # Hold the shared lock through dependency checks and the reentrant save.
    # Field merging alone cannot detect a panel's dependency on the page base,
    # or the removal of a layer whose records live in page-level production.
    with page_lock(state.path):
        latest = read_json(state.path)
        if (
            panel_id is not None
            and select
            and latest.get("production", {}).get("selected_render") != state.production.get("selected_render")
        ):
            msg = "整页底图已切换，单格选中冲突；已复制图片保留，请重新读取后重试"
            raise ProductionError(msg)
        if overlay_id is not None and not any(
            overlay.get("id") == overlay_id and overlay.get("mode") == "layer"
            for overlay in latest.get("overlays", [])
        ):
            msg = "出格图层已删除或改变模式，登记冲突；已复制图片保留，请重新读取后重试"
            raise ProductionError(msg)
        state.save()


@production_operation
def register_render(  # noqa: PLR0913 -- public external-worker registration options
    project_dir: str | Path,
    page_id: str,
    image_path: str | Path,
    *,
    seed: int | None = None,
    preset: str | None = None,
    model: str | None = None,
    source: str = "external",
    select: bool = False,
    panel_id: str | None = None,
    overlay_id: str | None = None,
    meta: JSON | None = None,
) -> dict:
    """Copy and register a local worker image, optionally selecting it atomically.

    Relative input paths are resolved from the project root. The returned path
    is absolute; persisted paths are always project-relative. No jobs are sent.
    """
    if seed is not None:
        _seed(seed)
    if not isinstance(select, bool) or not isinstance(source, str) or not source.strip():
        msg = "select 必须是布尔值，source 必须是非空字符串"
        raise ProductionError(msg)
    metadata = _render_metadata(meta, preset, model)
    state = PageState(project_dir, page_id)
    target, folder = _render_target(state, panel_id, overlay_id)
    destination = _import_render(state, image_path, folder)
    record = {"path": state.relative(destination), "seed": seed, "meta": metadata, "source": source}
    if panel_id is not None:
        record["source_render"] = state.production["selected_render"]
    target.setdefault("renders", []).append(record)
    if select:
        if panel_id is not None:
            target["selected"] = record["path"]
            state.invalidate()
        elif overlay_id is not None:
            target.update(record)
            state.invalidate()
        else:
            _select_page_render(state, record["path"])
    _save_registered_render(state, panel_id, overlay_id, select=select)
    return {**copy.deepcopy(record), "path": str(destination)}


@production_operation
def pick_render(project_dir: str | Path, page_id: str, render_path: str | Path) -> dict:
    state = PageState(project_dir, page_id)
    record = _registered(state.production.get("renders", []), state, render_path)
    _select_page_render(state, record["path"])
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
    cuts = [
        {"panel_id": panel.id, "quad": panel.shape["points"], "cut_inset": state.config["cut_inset"]}
        for panel in sorted(state.page.panels, key=lambda p: p.order)
        if panel.shape_type == "quad"
    ]
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
        "redraws": [],
        "cuts": cuts if not composed else [],
        "overlays": overlays,
        "lettering": {"needed": bool(texts) and not bool(lettered), "text_ids": texts},
        "needs_compose": not bool(composed),
        "warnings": [],
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


def _inpaint_geometry(state: PageState, panel: Panel, character_id: str) -> str:
    px, py, _, _ = panel_box(panel)
    width, height = panel_size(panel)
    figures = panel_figures(panel, state.page)
    boxes = []
    for figure in figures:
        if figure.character_id == character_id:
            left, top, right, bottom = figure_page_box(figure, panel)
            boxes.append(
                f"({(left - px) / width:.1%} left, {(top - py) / height:.1%} top, "
                f"{(right - left) / width:.1%} width, {(bottom - top) / height:.1%} height)"
            )
    return (
        f"The target {character_id} occupies the editor figure bounds "
        + "; ".join(boxes)
        + ". Keep the target at the same shot distance and matching body scale as the other "
        "person in this frame. Preserve their relative heights, framing and perspective; "
        "continue the original background seamlessly through the edited region."
    )


def _single_prompt(state: PageState, panel: Panel, character_id: str | None, *, mode: str = "detail") -> str:
    caption = panel_caption(panel, state.page, state.characters)
    character = character_caption(character_id, state.characters, "en") if character_id else ""
    return ". ".join(
        s
        for s in (
            (
                "A single manga illustration, one frame only, no panel borders, "
                "no gutters, no text, no speech bubbles"
            ),
            state.page.style_prompt or state.page.style_prefix,
            caption,
            character,
            (
                "Preserve the source image's composition, camera framing, body proportions, pose, "
                "actions and character positions. Preserve all props, their positions, motion and "
                "visible contents. Replace only the target character's appearance and identity "
                "with the supplied character description and trigger words. Keep the existing "
                "anime body proportions and scene continuity; use the supplied target clothing design"
                if mode == "swap"
                else ""
            ),
            (
                "Repair only the target character's local details. Preserve each character's "
                "identity, own outfit and colors, pose, body proportions and position. "
                "Keep all other characters, props and the scene composition unchanged"
                if mode == "inpaint"
                else ""
            ),
            _inpaint_geometry(state, panel, character_id) if mode == "inpaint" else "",
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
    seed: int | None = None,
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
    if mode == "swap" and character_id:
        chosen = _character_lora(state, character_id)
    else:
        selected = next(
            (
                r
                for r in state.production.get("renders", [])
                if r["path"] == state.production.get("selected_render")
            ),
            {},
        )
        meta = selected.get("meta", {})
        candidate = (meta.get("lora") or {}).get("character_id")
        if "lora" not in meta:
            candidate = (select_lora(state.page, state.characters) or {}).get("character_id")
        if candidate in panel_characters(panel):
            chosen = select_lora(state.page, state.characters, candidate)
    if mode in {"swap", "inpaint"} and not character_id:
        msg = "swap 或局部修正必须指定 --character"
        raise ProductionError(msg)
    if mode == "swap" and len(panel_characters(panel)) > 1:
        msg = "两人同格请使用 inpaint 修正细节，避免整格 swap 覆盖另一角色"
        raise ProductionError(msg)
    original = _panel_source(state, panel)
    folder = state.directory / "panels" / identifier(panel_id)
    folder.mkdir(parents=True, exist_ok=True)
    token, seed = stamp(), _seed(seed)
    source = folder / f"{token}_input.png"
    mask = None
    mask_path = None
    working_mask_path = None
    width, height = working_size(*original.size)
    if mode == "inpaint":
        mask = figure_mask(panel, state.page, character_id, margin=margin, feather=feather)
        mask_path = folder / f"{token}_mask.png"
        mask.save(mask_path)
        working_mask_path = folder / f"{token}_work-mask.png"
        mask.resize((width, height), Image.Resampling.LANCZOS).save(working_mask_path)
    # Never hide the original RGB under transparent alpha: Pillow premultiplies
    # RGBA during resizing and destroys precisely the pixels being repaired.
    original.resize((width, height), Image.Resampling.LANCZOS).save(source)
    client = state.client()
    uploaded = client.upload(source)
    uploaded_mask = client.upload(working_mask_path) if working_mask_path else None
    graph = minimal_graph(
        _single_prompt(state, panel, character_id, mode=mode),
        config=state.config,
        preset=state.config["preset"],
        seed=seed,
        width=width,
        height=height,
        lora=chosen,
        image=uploaded,
        mask=uploaded_mask,
        denoise=denoise,
        inpaint=mode == "inpaint",
        composite_mask=False,
        prefix=f"soda-storyboard/{state.page.page_id}/{panel_id}_{token}",
    )
    destination = folder / f"{token}_{seed}.png"
    client.run(graph, destination, progress=progress)
    redrawn = open_rgb(destination, original.size)
    if mask is not None:
        # Blend exactly once at native size, with the mask shown in mask-only.
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
        "working_size": [width, height],
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
    seed: int | None = None,
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
        seed=seed,
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
    mask_only: bool = False,
    seed: int | None = None,
    progress: Progress = None,
) -> dict:
    if not 0 <= denoise <= 1:
        msg = "denoise 必须在 0 到 1 之间"
        raise ProductionError(msg)
    if seed is not None:
        _seed(seed)
    if mask_only:
        state = PageState(project_dir, page_id)
        state.panel(panel_id)
        panel = next(p for p in state.page.panels if p.id == panel_id)
        original = _panel_source(state, panel)
        mask = figure_mask(panel, state.page, character_id, margin=margin, feather=feather)
        folder = state.directory / "panels" / identifier(panel_id)
        folder.mkdir(parents=True, exist_ok=True)
        token = stamp()
        path, preview = folder / f"{token}_mask.png", folder / f"{token}_mask-preview.png"
        mask.save(path)
        tint = Image.blend(original, Image.new("RGB", original.size, "red"), 0.4)
        Image.composite(tint, original, mask).save(preview)
        return {
            "panel_id": panel_id,
            "character_id": character_id,
            "mask": str(path),
            "preview": str(preview),
            "mask_only": True,
        }
    return _redraw(
        PageState(project_dir, page_id),
        panel_id,
        mode="inpaint",
        character_id=character_id,
        denoise=denoise,
        progress=progress,
        seed=seed,
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
    if any(p.shape_type == "quad" for p in state.page.panels):
        # Cut-mode pages are rebuilt on paper. This also removes old borders
        # outside panel bboxes, including margins and gutters between rows.
        image = Image.new("RGB", _canvas(state), "white")
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
    font_path = None
    if font:
        font_path = Path(font)
        if not font_path.is_absolute() and (state.root / font_path).is_file():
            font_path = state.local(font_path)
        font_path = font_path.resolve()
    result = _apply_overlays(state, letter_image(image, state.page, font=font_path, text_ids=text_ids))
    if font_path and not font_path.is_relative_to(state.root):
        # Explicit CLI/API imports can use a local font, but persisted metadata
        # must remain portable and confined to the project on later operations.
        content = font_path.read_bytes()
        destination_font = state.local(
            state.directory / "fonts" / f"{hashlib.sha256(content).hexdigest()}{font_path.suffix}"
        )
        destination_font.parent.mkdir(parents=True, exist_ok=True)
        destination_font.write_bytes(content)
        font_path = destination_font
    destination = state.directory / "lettered.png"
    result.save(destination)
    state.production["lettered"] = {
        "path": state.relative(destination),
        "signature": state.signature(),
        "font": state.relative(font_path) if font_path else None,
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
            try:
                with Image.open(source) as image:
                    image.verify()
            except (OSError, ValueError, SyntaxError) as exc:
                msg = "导出源文件不是有效图片，请重新选择或生成底图"
                raise ProductionError(msg) from exc
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
    contract = definition.get("input", {})
    required = contract.get("required", {})
    for key, spec in {**contract.get("optional", {}), **required}.items():
        if not isinstance(spec, (list, tuple)) or not spec:
            msg = f"抠图节点 {class_name} 的参数 {key} 契约无效，请用 cutout --png 导入已抠好的透明 PNG"
            raise ProductionError(msg)
        kind = spec[0]
        options = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
        if kind == "IMAGE":
            inputs[key] = ["9", 0]
        elif "default" in options:
            inputs[key] = options["default"]
        elif key in required and isinstance(kind, list) and kind:
            inputs[key] = kind[0]
        elif key in required:
            msg = f"抠图节点 {class_name} 的必填参数 {key} 没有默认值，请用 cutout --png 导入已抠好的透明 PNG"
            raise ProductionError(msg)
    if not any(isinstance(v, list) and v == ["9", 0] for v in inputs.values()):
        msg = f"抠图节点 {class_name} 未声明 IMAGE 输入，请用 cutout --png 导入已抠好的透明 PNG"
        raise ProductionError(msg)
    outputs = definition.get("output", [])
    if "IMAGE" not in outputs:
        msg = f"抠图节点 {class_name} 未声明 IMAGE 输出，请用 cutout --png 导入已抠好的透明 PNG"
        raise ProductionError(msg)
    return node(class_name, **inputs), outputs.index("IMAGE")


CUTOUT_TEMPLATES = {
    "whole": "A single solo character illustration, one person only, full body",
    "partial": (
        "A tightly cropped body-part detail illustration, showing only the described body parts "
        "and held props, all unrelated anatomy outside the image"
    ),
    "object": "An isolated object illustration, showing only the described objects and props",
}
CUTOUT_PARTIAL = re.compile(
    r"手|手腕|手臂|上半身|半身|局部|脚|腿部|头部|面部|胸像|"
    r"\b(?:hands?|wrists?|arms?|upper[- ]body|bust|body[- ]part|feet|foot|head|face)\b",
    re.IGNORECASE,
)
CUTOUT_WHOLE = re.compile(r"全身|完整人物|\b(?:full[- ]body|whole[- ]body)\b", re.IGNORECASE)
CUTOUT_TIGHT = re.compile(r"只|仅|特写|局部|半身|\b(?:only|just|close[- ]up|detail)\b", re.IGNORECASE)


def cutout_kind(overlay: Overlay) -> str:
    """Prefer explicit framing; infer conservatively and default to an object."""
    if overlay.cutout_type != "auto":
        if overlay.cutout_type not in CUTOUT_TEMPLATES:
            msg = "cutout_type 必须是 auto、whole、partial 或 object"
            raise ProductionError(msg)
        return overlay.cutout_type
    partial = CUTOUT_PARTIAL.search(overlay.description)
    whole = CUTOUT_WHOLE.search(overlay.description)
    # A request for only a hand takes precedence over broad character wording;
    # a whole person may still naturally have hands, a wristwatch or a face.
    if partial and (not whole or CUTOUT_TIGHT.search(overlay.description)):
        return "partial"
    return "whole" if whole else "object"


def _cutout_prompt(state: PageState, overlay: Overlay, kind: str) -> str:
    identity = ""
    character = state.characters.get(overlay.character_id)
    if kind == "whole":
        identity = character_caption(overlay.character_id, state.characters, "en")
    elif kind == "partial" and character:
        # Full appearance cards often describe hair and whole outfits. A hand
        # detail must use its own description rather than request those parts.
        identity = ", ".join(dict.fromkeys([character.display_name, *character.trigger_words]))
    return ". ".join(
        part
        for part in (
            CUTOUT_TEMPLATES[kind]
            + ", plain solid white background, no panel borders, no text, no speech bubbles",
            state.page.style_prompt,
            state.page.style_prefix,
            identity,
            overlay.description,
        )
        if part
    )


@production_operation
def cutout(  # noqa: PLR0913 -- optional reproducible generation and PNG import
    project_dir: str | Path,
    page_id: str,
    overlay_id: str,
    *,
    png: str | Path | None = None,
    seed: int | None = None,
    progress: Progress = None,
) -> dict:
    state = PageState(project_dir, page_id)
    state.base()
    overlay = next((o for o in state.page.overlays if o.id == overlay_id), None)
    if overlay is None or overlay.mode != "layer":
        msg = f"找不到 mode: layer 的出格图层：{overlay_id}"
        raise ProductionError(msg)
    kind = cutout_kind(overlay)
    validated_seed = _seed(seed)
    actual_seed = validated_seed if not png else None
    destination = state.directory / "overlays" / f"{identifier(overlay_id)}_{stamp()}.png"
    destination.parent.mkdir(parents=True, exist_ok=True)
    if png:
        # This is an explicit image import; only the copied project-relative
        # destination is persisted and reused by later production operations.
        source = Path(png).resolve() if Path(png).is_absolute() else state.local(png)
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
        chosen = _character_lora(state, overlay.character_id) if kind != "object" else None
        prompt = _cutout_prompt(state, overlay, kind)
        width, height = working_size(overlay.rect.w, overlay.rect.h)
        graph = minimal_graph(
            prompt,
            config=state.config,
            preset=state.config["preset"],
            lora=chosen,
            width=width,
            height=height,
            seed=actual_seed,
        )
        graph["cutout"] = remove
        graph["10"]["inputs"]["images"] = ["cutout", output_index]
        client.run(graph, destination, progress=progress)
        with Image.open(destination) as image:
            if "A" not in image.getbands() or image.getchannel("A").getextrema()[0] == OPAQUE:
                msg = f"节点 {class_name} 未返回透明图片，请提供已抠好的 PNG"
                raise ProductionError(msg)
    old_lettering = state.production.get("lettered")
    record = {"path": state.relative(destination), "seed": actual_seed, "cutout_type": kind}
    if not png:
        record["working_size"] = [width, height]
    state.production.setdefault("overlays", {})[overlay_id] = record
    state.invalidate()
    state.save()
    result = compose_page(project_dir, page_id)
    if old_lettering:
        result = letter_with_options(
            project_dir, page_id, font=old_lettering.get("font"), text_ids=old_lettering.get("text_ids")
        )
    return {**record, "overlay_id": overlay_id, "path": str(destination), "page_path": result}


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
    "register_render",
    "split_page",
]
