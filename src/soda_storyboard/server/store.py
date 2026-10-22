"""Editor operations composed from the existing storyboard library."""

from __future__ import annotations

import threading
import uuid
from copy import deepcopy
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

from soda_storyboard.captions import panel_caption_info
from soda_storyboard.compiler import compile_geometry_map, compile_page
from soda_storyboard.figures import sketch_geometry
from soda_storyboard.geometry import bbox_overlap, bbox_xywh, shape_bbox, skew_rectangles
from soda_storyboard.io import load_character, load_project, read_json, save_page, write_json
from soda_storyboard.json_safety import check_json_numbers
from soda_storyboard.models import Character, Page, Project
from soda_storyboard.persistence import page_lock
from soda_storyboard.preview import render_preview
from soda_storyboard.production.paths import validate_production_paths
from soda_storyboard.templates import suggest_layouts
from soda_storyboard.validation import validate_page

from .common import APIError, identifier, inside, snapshot

if TYPE_CHECKING:
    from pathlib import Path

# The public JSON boundary accepts forward-compatible storyboard metadata.
# ruff: noqa: ANN401, RUF001

MAX_PREVIEW_PIXELS = 16_000_000
MAX_PREVIEW_SCALE = 2
MAX_CANDIDATES = 32
CANDIDATE_CACHE_SIZE = 256


class Store:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.lock = threading.RLock()
        self.candidates: dict[str, dict] = {}
        self.production_pages: set[str] = set()
        load_project(self.path("project.json"))

    def path(self, relative: str) -> Path:
        return inside(self.root, relative)

    def page_path(self, page_id: str) -> Path:
        return self.path(f"pages/{identifier(page_id)}.json")

    def characters(self) -> list[dict]:
        directory = self.path("characters")
        return [
            load_character(self.path(f"characters/{p.name}")).to_dict()
            for p in sorted(directory.glob("*.json"))
        ]

    def character_map(self) -> dict[str, Character]:
        return {value["id"]: Character.from_dict(value) for value in self.characters()}

    def pages(self) -> list[dict]:
        result = []
        for path in sorted(self.path("pages").glob("*.json")):
            try:
                identifier(path.stem)
            except APIError:
                continue
            value, version = snapshot(self.page_path(path.stem))
            result.append(
                {
                    "id": path.stem,
                    "description": value.get("description", ""),
                    "panel_count": len(value.get("panels", [])),
                    "version": version,
                }
            )
        return result

    def project(self) -> dict:
        return {
            "project": read_json(self.path("project.json")),
            "pages": self.pages(),
            "characters": [
                {
                    "id": c["id"],
                    "display_name": c["display_name"],
                    "has_lora": bool(c.get("lora")),
                    **({"sketch_color": c["sketch_color"]} if "sketch_color" in c else {}),
                }
                for c in self.characters()
            ],
        }

    def atomic(self, path: Path, value: Any, expected_version: str | None = None) -> tuple[dict, str]:
        temporary = self.path(path.relative_to(self.root).as_posix() + f".{uuid.uuid4().hex}.tmp")
        try:
            if isinstance(value, Page):
                save_page(value, temporary)
            else:
                write_json(temporary, value)
            committed, committed_version = snapshot(temporary)
            if expected_version is not None:
                current, version = snapshot(path)
                if version != expected_version:
                    raise APIError(
                        409, "页面版本冲突，请合并当前内容后重试", current=current, version=version
                    )
            temporary.replace(path)
            current, version = snapshot(path)
            if version != committed_version:
                raise APIError(409, "页面版本冲突，请合并当前内容后重试", current=current, version=version)
            # Return the actual submitted snapshot; another writer may change the
            # target immediately after this check, but must never be adopted here.
            return committed, committed_version
        finally:
            temporary.unlink(missing_ok=True)

    def patch_project(self, fields: dict) -> dict:
        with self.lock:
            path = self.path("project.json")
            value = read_json(path)
            value.update(fields)
            project = Project.from_dict(value)
            if project.default_canvas_width <= 0 or project.default_canvas_height <= 0:
                raise APIError(400, "默认画布尺寸必须大于零")
            self.atomic(path, value)
            return self.project()

    def page(self, page_id: str) -> dict:
        value, version = snapshot(self.page_path(page_id))
        return {"page": value, "version": version}

    def sketch_geometry(self, page_id: str) -> dict:
        current = self.page(page_id)
        return {
            "version": current["version"],
            **sketch_geometry(self.render_page(page_id, raw=current["page"]), self.character_map()),
        }

    def match(self, page_id: str, version: str | None) -> dict:
        current = self.page(page_id)
        if version != current["version"]:
            raise APIError(
                409, "页面版本冲突，请合并当前内容后重试", current=current["page"], version=current["version"]
            )
        return current

    def editable(self, page_id: str) -> None:
        if page_id in self.production_pages:
            current = self.page(page_id)
            raise APIError(
                409,
                "页面正在执行生产任务，请等待任务结束后重新读取",
                current=current["page"],
                version=current["version"],
                reason="production_running",
            )

    def checked(self, value: dict) -> tuple[Page, dict]:
        try:
            check_json_numbers(value)
            path_errors = validate_production_paths(value, self.root)
            page = Page.from_dict(value)
            page.lora_policy = load_project(self.path("project.json")).lora_policy
            report = validate_page(page, self.character_map()).to_dict()
        except (ValueError, TypeError, KeyError, AttributeError, OverflowError) as exc:
            issue = {"severity": "error", "code": "invalid_page", "message": f"页面数据格式错误：{exc}"}
            raise APIError(422, "页面校验失败", errors=[issue], warnings=[]) from exc
        report["errors"].extend(
            {"severity": "error", "code": "production_path", "message": message} for message in path_errors
        )
        if report["errors"]:
            raise APIError(422, "页面校验失败", **report)
        return page, report

    def save(self, page_id: str, value: dict, version: str | None) -> dict:
        with self.lock, page_lock(self.page_path(page_id)):
            self.editable(page_id)
            self.match(page_id, version)
            page, report = self.checked(value)
            if page.id != page_id:
                raise APIError(400, "页面 id 必须与 URL 一致")
            # Validation can be slow; catch CLI changes made during validation too.
            self.match(page_id, version)
            saved, saved_version = self.atomic(self.page_path(page_id), page, expected_version=version)
            return {"page": saved, "version": saved_version, "warnings": report["warnings"]}

    def create_page(self, value: dict) -> dict:
        page_id = identifier(value.get("id", ""))
        with self.lock, page_lock(self.page_path(page_id)):
            target = self.page_path(page_id)
            if target.exists():
                raise APIError(409, "页面已存在")
            project = load_project(self.path("project.json"))
            defaults = {
                "canvas_width": project.default_canvas_width,
                "canvas_height": project.default_canvas_height,
                "reading_direction": project.reading_direction,
                "style_prefix": project.default_style_prefix,
                "dialogue_mode": project.default_dialogue_mode,
                "text_direction": project.text_direction,
                "color_mode": project.color_mode,
                "style_prompt": project.style_prompt,
                "tags": project.tags,
            }
            page, report = self.checked({**defaults, **value})
            if page.id != page_id:
                raise APIError(400, "页面 id 与 page_id 不一致")
            saved, saved_version = self.atomic(target, page)
            return {"page": saved, "version": saved_version, "warnings": report["warnings"]}

    def delete(self, page_id: str, version: str | None) -> dict:
        with self.lock:
            self.editable(page_id)
            self.match(page_id, version)
            relative = f".trash/{identifier(page_id)}-{uuid.uuid4().hex}.json"
            target = self.path(relative)
            target.parent.mkdir(exist_ok=True)
            self.page_path(page_id).replace(target)
            return {"id": page_id, "trash_path": relative}

    def save_character(
        self, value: dict, character_id: str | None = None, version: str | None = None
    ) -> dict:
        with self.lock:
            character = Character.from_dict(value)
            identifier(character.id)
            if character_id is not None and character.id != character_id:
                raise APIError(400, "角色 id 必须与 URL 一致")
            path = self.path(f"characters/{character.id}.json")
            if character_id is None and path.exists():
                raise APIError(409, "角色已存在")
            if character_id is not None and not path.exists():
                raise APIError(404, "角色不存在")
            if version is not None and character_id is not None:
                current, current_version = snapshot(path)
                if current_version != version:
                    raise APIError(
                        409,
                        "角色资料已在其他位置修改，请刷新后重试",
                        current=current,
                        version=current_version,
                    )
            # Validate with the model, but retain unknown nested fields in existing role files.
            saved = value if character_id is not None else character.to_dict()
            saved, saved_version = self.atomic(path, saved, version if character_id is not None else None)
            return {"character": saved, "version": saved_version}

    def preview(self, page_id: str, style: str, scale: float) -> bytes:
        page = self.render_page(page_id)
        if (
            not 0 < scale <= MAX_PREVIEW_SCALE
            or page.canvas_width * page.canvas_height * scale * scale > MAX_PREVIEW_PIXELS
        ):
            raise APIError(400, "预览 scale 必须在 0 到 2 之间，且输出不能超过 1600 万像素")
        target = self.path(f".server/previews/{uuid.uuid4().hex}.png")
        try:
            render_preview(page, target, self.character_map(), scale=scale, style=style)
            return target.read_bytes()
        finally:
            target.unlink(missing_ok=True)

    def render_page(self, page_id: str, *, raw: dict | None = None) -> Page:
        """Apply the same project-level render defaults as CLI _page_for."""
        if raw is None:
            raw, _ = snapshot(self.page_path(page_id))
        page = Page.from_dict(raw)
        project = load_project(self.path("project.json"))
        page.lora_policy = project.lora_policy
        for key in ("text_direction", "color_mode", "tags", "caption_language"):
            if key not in raw:
                setattr(page, key, getattr(project, key))
        if not raw.get("style_prompt"):
            page.style_prompt = project.style_prompt
        return page

    def compile(self, page_id: str, options: dict) -> dict:
        with self.lock:
            page = self.render_page(page_id)
            mode = options.get("slant_mode", "cut")
            compiled = compile_page(
                page, self.character_map(), with_ids=options.get("with_ids", False), slant_mode=mode
            )
            relative = f"{page_id}.moss.json"
            self.atomic(self.path(relative), compiled)
            paths = {"moss": relative}
            if mode == "cut" and any(panel.shape_type == "quad" for panel in page.panels):
                cut = compile_geometry_map(page, slant_mode=mode)
                cut.pop("overlays", None)
                paths["cut"] = f"{page_id}.moss.cut.json"
                self.atomic(self.path(paths["cut"]), cut)
            if options.get("with_ids", False):
                paths["map"] = f"{page_id}.moss.map.json"
                self.atomic(self.path(paths["map"]), compile_geometry_map(page, slant_mode=mode))
            return {"moss": compiled, "path": relative, "paths": paths}

    def caption_preview(self, page_id: str, options: dict) -> dict:
        """Compile the editor's current draft without saving or launching any job."""
        with self.lock:
            # Check the requested resource even when the body contains an unsaved draft.
            self.page(page_id)
            raw = options.get("page")
            if raw is not None and not isinstance(raw, dict):
                raise APIError(400, "page 必须是页面 JSON 对象")
            page = self.render_page(page_id, raw=raw)
            if page.page_id != page_id:
                raise APIError(400, "预览页面 id 与请求路径不一致")
            characters = self.character_map()
            return {
                "panels": [
                    panel_caption_info(panel, page, characters)
                    for panel in sorted(page.panels, key=lambda item: item.order)
                ]
            }

    def suggest(self, page_id: str, options: dict) -> dict:
        style = options.get("style", "sketch")
        if style not in {"sketch", "boxes"}:
            raise APIError(400, "style 必须是 sketch 或 boxes")
        with self.lock:
            current = self.page(page_id)
            page = Page.from_dict(current["page"])
            if options.get("panels", len(page.panels)) != len(page.panels):
                raise APIError(400, "panels 与当前页格数不一致")
            importance = options.get(
                "importance", [p.importance for p in sorted(page.panels, key=lambda p: p.order)]
            )
            if isinstance(importance, str):
                importance = [int(v) for v in importance.split(",")]
            candidates = options.get("candidates", 6)
            if not isinstance(candidates, int) or not 1 <= candidates <= MAX_CANDIDATES:
                raise APIError(400, "candidates 必须在 1 到 32 之间")
            templates = self.path(options["templates"]) if options.get("templates") else None
            gap = options.get("gap", page.panel_gap)
            direction = options.get("direction", page.reading_direction)
            results = suggest_layouts(
                len(page.panels),
                width=page.canvas_width,
                height=page.canvas_height,
                importance=importance,
                user_templates=templates,
                candidates=candidates,
                gap=gap,
                reading_direction=direction,
                pick=options.get("pick"),
                skew=options.get("skew"),
            )
            batch = uuid.uuid4().hex
            entries = []
            for index, result in enumerate(results):
                preview = deepcopy(current["page"])
                self.apply_shapes(preview, result["panels"])
                preview["panel_gap"] = gap
                preview["reading_direction"] = direction
                preview_page = Page.from_dict(preview)
                if preview_page.canvas_width * preview_page.canvas_height > MAX_PREVIEW_PIXELS:
                    raise APIError(400, "画布过大，无法生成候选预览")
                relative = f".server/layouts/{batch}-{index}.png"
                render_preview(
                    preview_page, self.path(relative), self.character_map(), style=style, scale=0.25
                )
                candidate_id = f"{batch}-{index}"
                entry = {
                    **result,
                    "candidate_id": candidate_id,
                    "preview_url": f"/api/files/{quote(relative)}",
                }
                self.candidates[candidate_id] = {
                    "page_id": page_id,
                    "version": current["version"],
                    "page": preview,
                }
                entries.append(entry)
            # Candidates are ephemeral and bounded; restarting/refetching regenerates them.
            while len(self.candidates) > CANDIDATE_CACHE_SIZE:
                self.candidates.pop(next(iter(self.candidates)))
            return {"version": current["version"], "candidates": entries}

    @staticmethod
    def apply_shapes(value: dict, shapes: list[dict]) -> None:
        for panel, shape in zip(sorted(value["panels"], key=lambda p: p["order"]), shapes, strict=True):
            panel["shape"] = {key: v for key, v in shape.items() if key != "order"}

    def apply(self, page_id: str, candidate_id: str, version: str | None) -> dict:
        with self.lock:
            self.match(page_id, version)
            candidate = self.candidates.get(candidate_id)
            if candidate is None or candidate["page_id"] != page_id:
                raise APIError(404, "版式候选不存在或已过期，请重新生成")
            if candidate["version"] != version:
                raise APIError(409, "候选基于旧页面，请重新生成", **self.page(page_id))
            return self.save(page_id, candidate["page"], version)

    def skew(self, page_id: str, options: dict, version: str | None) -> dict:
        with self.lock:
            value = self.match(page_id, version)["page"]
            ids = options.get("panels", [])
            if isinstance(ids, str):
                ids = [v.strip() for v in ids.split(",") if v.strip()]
            panels = {p["id"]: p for p in value["panels"]}
            if len(ids) <= 1 or len(set(ids)) != len(ids) or not set(ids) <= panels.keys():
                raise APIError(400, "panels 需要至少两个不同的、已存在的格子 id")
            bounds = [shape_bbox(panels[i]["shape"]) for i in ids]
            group = (
                min(b[0] for b in bounds),
                min(b[1] for b in bounds),
                max(b[2] for b in bounds),
                max(b[3] for b in bounds),
            )
            box = (group[0], group[1], group[2] - group[0], group[3] - group[1])
            if any(bbox_overlap(box, bbox_xywh(p["shape"])) for i, p in panels.items() if i not in ids):
                raise APIError(400, "选中的格子之间还有其他格子，请选择完整的相邻组")
            quads = skew_rectangles(
                [panels[i]["shape"] for i in ids],
                angle=options.get("angle", 8),
                gap=value.get("panel_gap", 24),
                axis=options.get("axis", "auto"),
            )
            for panel_id, shape in zip(ids, quads, strict=True):
                panels[panel_id]["shape"] = shape
            return self.save(page_id, value, version)

    def renders(self, page_id: str) -> dict:
        value = self.page(page_id)["page"]
        production = value.get("production", {})
        metadata = production.get("renders", value.get("renders", []))
        by_path = {record["path"]: record for record in metadata}
        directory = self.path(f"pages/{page_id}/renders")
        renders = []
        for path in sorted(directory.glob("*.png")):
            safe = self.path(path.relative_to(self.root).as_posix())
            relative = safe.relative_to(self.root).as_posix()
            # P3's contact sheet is not a registered render and cannot be picked.
            if path.name.endswith("_candidates.png") or (metadata and relative not in by_path):
                continue
            renders.append(
                {**by_path.get(relative, {}), "path": relative, "url": f"/api/files/{quote(relative)}"}
            )
        sheet = production.get("candidate_sheet")
        if sheet:
            sheet = self.path(sheet).relative_to(self.root).as_posix()
        return {
            "renders": renders,
            "metadata": metadata,
            "selected_render": production.get("selected_render", value.get("selected_render")),
            "candidate_sheet": {"path": sheet, "url": f"/api/files/{quote(sheet)}"} if sheet else None,
        }
