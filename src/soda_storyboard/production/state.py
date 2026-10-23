# ruff: noqa: RUF001
# Chinese user-facing diagnostics intentionally use Chinese punctuation.
"""Project paths and backward-compatible production metadata."""

from __future__ import annotations

import copy
import hashlib
import json
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from soda_storyboard.io import load_characters, read_json
from soda_storyboard.json_safety import check_json_numbers, loads_json
from soda_storyboard.models import Page
from soda_storyboard.persistence import file_snapshot, page_lock

from .client import ComfyClient
from .errors import ProductionError
from .graphs import DEFAULTS, PRESETS
from .paths import production_path, resolved_path, validate_production_paths

type JSON = dict[str, Any]


def identifier(value: str) -> str:
    if not value or value in {".", ".."} or any(c in value for c in "/\\:\x00"):
        msg = f"无效的页或图层 id：{value}"
        raise ProductionError(msg)
    return value


def stamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def save_json(path: Path, value: object, *, expected_version: str | None = None) -> None:
    """Replace only after serializing a complete JSON document."""
    check_json_numbers(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_text(
            json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8"
        )
        _, committed_version = file_snapshot(temporary)
        if expected_version is not None and file_snapshot(path)[1] != expected_version:
            msg = "页面版本冲突，生成文件已保留，请重新读取后重试"
            raise ProductionError(msg)
        temporary.replace(path)
        if expected_version is not None and file_snapshot(path)[1] != committed_version:
            msg = "页面版本冲突，生成文件已保留，请重新读取后重试"
            raise ProductionError(msg)
    finally:
        temporary.unlink(missing_ok=True)


_MISSING = object()


def _merge_production(before: Any, changed: Any, current: Any) -> Any:  # noqa: ANN401
    """Rebase this task's metadata changes; reject incompatible concurrent edits."""
    if changed == before:
        return copy.deepcopy(current) if current is not _MISSING else _MISSING
    if current in (before, changed):
        return copy.deepcopy(changed) if changed is not _MISSING else _MISSING
    if before is _MISSING:
        if isinstance(changed, dict) and isinstance(current, dict):
            before = {}
        elif isinstance(changed, list) and isinstance(current, list):
            before = []
    if isinstance(before, dict) and isinstance(changed, dict) and isinstance(current, dict):
        result = copy.deepcopy(current)
        for key in before.keys() | changed.keys():
            merged = _merge_production(
                before.get(key, _MISSING), changed.get(key, _MISSING), current.get(key, _MISSING)
            )
            if merged is _MISSING:
                result.pop(key, None)
            else:
                result[key] = merged
        return result
    if (
        isinstance(before, list)
        and isinstance(changed, list)
        and isinstance(current, list)
        and changed[: len(before)] == before
        and current[: len(before)] == before
    ):
        result = copy.deepcopy(current)
        result.extend(copy.deepcopy(item) for item in changed[len(before) :] if item not in result)
        return result
    msg = "production 元数据修改冲突，生成文件已保留，请重新读取后重试"
    raise ProductionError(msg)


def configure(project_dir: str | Path, **updates: Any) -> JSON:  # noqa: ANN401 -- heterogeneous project configuration
    root = resolved_path(Path(project_dir))
    path = root / "project.json"
    payload = read_json(path)
    config = {**DEFAULTS, **payload.get("comfy", {})}
    unknown = updates.keys() - DEFAULTS.keys()
    if unknown:
        msg = f"未知 ComfyUI 配置：{', '.join(sorted(unknown))}"
        raise ProductionError(msg)
    config.update(updates)
    if config["preset"] not in PRESETS or config["backend"] not in {"minimal", "v2"}:
        msg = "预设必须是 draft/final，后端必须是 minimal/v2"
        raise ProductionError(msg)
    if config["timeout"] <= 0 or config["poll_interval"] < 0:
        msg = "超时必须大于 0，轮询间隔不能小于 0"
        raise ProductionError(msg)
    if config["cut_inset"] < 0 or config["border_width"] < 1:
        msg = "cut_inset 不能为负，border_width 至少为 1"
        raise ProductionError(msg)
    ComfyClient(config["url"], timeout=config["timeout"], poll_interval=config["poll_interval"])
    if updates:
        payload["comfy"] = config
        save_json(path, payload)
    return config


class PageState:
    def __init__(self, project_dir: str | Path, page_id: str) -> None:
        self.root = resolved_path(Path(project_dir))
        identifier(page_id)
        self.path = self.root / "pages" / f"{page_id}.json"
        if not self.path.is_file():
            matches = [
                p
                for p in (self.root / "pages").glob("*.json")
                if (data := read_json(p)).get("id", data.get("page_id")) == page_id
            ]
            if not matches:
                msg = f"找不到分镜页：{page_id}"
                raise ProductionError(msg)
            self.path = matches[0]
        self.raw = read_json(self.path)
        errors = validate_production_paths(self.raw, self.root)
        if errors:
            raise ProductionError("；".join(errors))
        project = read_json(self.root / "project.json")
        payload = dict(self.raw)
        payload["lora_policy"] = project.get("lora_policy", "single")
        for key in ("text_direction", "color_mode", "tags", "style_prompt", "caption_language"):
            if (key not in payload or (key == "style_prompt" and not payload[key])) and key in project:
                payload[key] = project[key]
        payload.setdefault("dialogue_mode", project.get("default_dialogue_mode", "moss_text"))
        payload.setdefault("style_prefix", project.get("default_style_prefix", ""))
        self.page = Page.from_dict(payload)
        self.directory = self.local(f"pages/{identifier(self.page.page_id)}")
        self.characters = load_characters(self.root / "characters")
        self.config = configure(self.root)
        self.production = self.raw.setdefault("production", {})
        self._baseline = copy.deepcopy(self.raw)

    def save(self) -> None:
        with page_lock(self.path):
            content, version = file_snapshot(self.path)
            latest = loads_json(content)
            if not isinstance(latest, dict):
                msg = "页面文件必须包含 JSON 对象，生成文件已保留"
                raise ProductionError(msg)
            latest["production"] = _merge_production(
                self._baseline.get("production", {}),
                self.production,
                latest.get("production", {}),
            )
            baseline_panels = {panel["id"]: panel for panel in self._baseline["panels"]}
            latest_panels = {panel["id"]: panel for panel in latest["panels"]}
            for panel in self.raw["panels"]:
                before = baseline_panels[panel["id"]].get("production", {})
                changed = panel.get("production", {})
                if before == changed:
                    continue
                target = latest_panels.get(panel["id"])
                if target is None:
                    msg = "页面格子已被删除，production 写回冲突；生成文件已保留"
                    raise ProductionError(msg)
                target["production"] = _merge_production(before, changed, target.get("production", {}))
            errors = validate_production_paths(latest, self.root)
            if errors:
                raise ProductionError("；".join(errors))
            save_json(self.path, latest, expected_version=version)
            self.raw = latest
            self.production = self.raw["production"]
            self._baseline = copy.deepcopy(latest)

    def panel(self, panel_id: str) -> JSON:
        for panel in self.raw["panels"]:
            if panel["id"] == panel_id:
                return panel
        msg = f"找不到格子：{panel_id}"
        raise ProductionError(msg)

    def local(self, path: str | Path) -> Path:
        try:
            return production_path(self.root, path, allow_absolute=True)
        except ValueError as exc:
            raise ProductionError(str(exc)) from exc

    def relative(self, path: Path) -> str:
        return resolved_path(path).relative_to(self.root).as_posix()

    def base(self) -> Path:
        selected = self.production.get("selected_render")
        if not selected:
            msg = "请先用 pick 选定整页底图"
            raise ProductionError(msg)
        path = self.local(selected)
        if not path.is_file():
            msg = f"选定底图不存在：{path}"
            raise ProductionError(msg)
        return path

    def client(self) -> ComfyClient:
        return ComfyClient(
            self.config["url"],
            timeout=self.config["timeout"],
            poll_interval=self.config["poll_interval"],
            log_directory=self.root / "logs" / "comfy",
        )

    def signature(self) -> str:
        page = copy.deepcopy(self.page.to_dict())
        page.pop("production", None)
        for panel in page.get("panels", []):
            panel.pop("production", None)
        return digest(
            {
                "page": page,
                "geometry_options": {key: self.config[key] for key in ("cut_inset", "border_width")},
                "production": {
                    "selected_render": self.production.get("selected_render"),
                    "panels": {p["id"]: p.get("production", {}).get("selected") for p in self.raw["panels"]},
                    "overlays": self.production.get("overlays", {}),
                },
            }
        )

    def invalidate(self) -> None:
        self.production.pop("composed", None)
        self.production.pop("lettered", None)

    def image_stage(self, stage: str) -> Path | None:
        record = self.production.get(stage, {})
        if record.get("signature") == self.signature():
            path = self.local(record["path"])
            if path.is_file():
                return path
        return None


def page_ids(project_dir: str | Path) -> list[str]:
    root = Path(project_dir)
    project = read_json(root / "project.json")
    declared = project.get("pages", project.get("page_ids"))
    if declared is not None:
        return [
            identifier(item if isinstance(item, str) else item.get("page_id", item.get("id", "")))
            for item in declared
        ]
    pages = [read_json(p) for p in (root / "pages").glob("*.json")]

    # Natural id ordering (page2 precedes page10) unless an explicit order is given.
    def key(page: JSON) -> tuple[int, list[tuple[int, object]]]:
        tokens = [(0, int(t)) if t.isdigit() else (1, t) for t in re.split(r"(\d+)", page.get("id", ""))]
        return int(page.get("order", page.get("page_number", 0))), tokens

    return [p.get("id", p.get("page_id")) for p in sorted(pages, key=key)]
