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
from soda_storyboard.models import Page

from .client import ComfyClient
from .errors import ProductionError
from .graphs import DEFAULTS, PRESETS

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


def save_json(path: Path, value: object) -> None:
    """Replace only after serializing a complete JSON document."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def configure(project_dir: str | Path, **updates: Any) -> JSON:  # noqa: ANN401 -- heterogeneous project configuration
    root = Path(project_dir).resolve()
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
        self.root = Path(project_dir).resolve()
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
        project = read_json(self.root / "project.json")
        payload = dict(self.raw)
        payload["lora_policy"] = project.get("lora_policy", "single")
        for key in ("text_direction", "color_mode", "tags", "style_prompt", "caption_language"):
            if (key not in payload or (key == "style_prompt" and not payload[key])) and key in project:
                payload[key] = project[key]
        payload.setdefault("dialogue_mode", project.get("default_dialogue_mode", "moss_text"))
        payload.setdefault("style_prefix", project.get("default_style_prefix", ""))
        self.page = Page.from_dict(payload)
        self.directory = self.root / "pages" / identifier(self.page.page_id)
        self.characters = load_characters(self.root / "characters")
        self.config = configure(self.root)
        self.production = self.raw.setdefault("production", {})

    def save(self) -> None:
        save_json(self.path, self.raw)

    def panel(self, panel_id: str) -> JSON:
        for panel in self.raw["panels"]:
            if panel["id"] == panel_id:
                return panel
        msg = f"找不到格子：{panel_id}"
        raise ProductionError(msg)

    def local(self, path: str | Path) -> Path:
        value = Path(path)
        return value if value.is_absolute() else self.root / value

    def relative(self, path: Path) -> str:
        return path.resolve().relative_to(self.root).as_posix()

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
