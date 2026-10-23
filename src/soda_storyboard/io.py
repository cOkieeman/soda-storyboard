"""JSON file helpers for storyboard projects."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .json_safety import check_json_numbers, loads_json
from .models import CHARACTER_FORMAT, PAGE_FORMAT, PROJECT_FORMAT, Character, Page, Project
from .persistence import project_lock


def read_json(path: str | Path) -> dict[str, Any]:
    file_path = Path(path)
    with file_path.open(encoding="utf-8-sig") as handle:
        value = loads_json(handle.read())
    if not isinstance(value, dict):
        raise ValueError(f"JSON 文件必须包含对象：{file_path}")
    return value


def write_json(path: str | Path, value: Any, *, indent: int = 2) -> Path:
    file_path = Path(path)
    payload = value.to_dict() if hasattr(value, "to_dict") else value
    check_json_numbers(payload)
    content = json.dumps(payload, ensure_ascii=False, indent=indent, allow_nan=False) + "\n"
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with project_lock(file_path), file_path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)
    return file_path


def load_page(path: str | Path) -> Page:
    return Page.from_dict(read_json(path))


def load_project(path: str | Path) -> Project:
    return Project.from_dict(read_json(path))


def load_character(path: str | Path) -> Character:
    return Character.from_dict(read_json(path))


def load_model(path: str | Path) -> Page | Project | Character:
    """Load any supported v1 JSON file based on its format marker."""

    value = read_json(path)
    marker = value.get("format", "")
    if marker == PAGE_FORMAT:
        return Page.from_dict(value)
    if marker == PROJECT_FORMAT:
        return Project.from_dict(value)
    if marker == CHARACTER_FORMAT:
        return Character.from_dict(value)
    if "panels" in value:
        return Page.from_dict(value)
    if any(key in value for key in ("display_name", "trigger_words", "lora", "appearance", "clothing")):
        return Character.from_dict(value)
    return Project.from_dict(value)


def save_page(page: Page, path: str | Path) -> Path:
    return write_json(path, page)


def save_model[ModelT: Page | Project | Character](model: ModelT, path: str | Path) -> Path:
    return write_json(path, model)


def load_characters(root: str | Path) -> dict[str, Character]:
    directory = Path(root)
    if directory.is_file():
        character = load_character(directory)
        return {character.id: character}
    if not directory.exists():
        return {}
    result: dict[str, Character] = {}
    for path in sorted(directory.glob("*.json")):
        character = load_character(path)
        if character.id:
            result[character.id] = character
    return result


__all__ = [
    "load_character",
    "load_characters",
    "load_model",
    "load_page",
    "load_project",
    "read_json",
    "save_model",
    "save_page",
    "write_json",
]
