"""Portable, file-only storyboard interchange shared by CLI and node clients.

The v1 envelope retains the source documents, except that machine-local file
metadata is made portable. Loading and compiling never access a network or a
referenced asset, and never modify the supplied documents.
"""

from __future__ import annotations

import base64
import binascii
import copy
import io
import json
import re
from collections.abc import Mapping
from datetime import UTC, datetime
from importlib.metadata import PackageNotFoundError, version
from ipaddress import ip_address
from pathlib import Path, PurePosixPath, PureWindowsPath
from tempfile import TemporaryDirectory
from typing import Any
from urllib.parse import urlsplit

from PIL import Image

from .captions import custom_caption_enabled, source_hash, translation_state
from .compiler import compile_page
from .io import read_json, write_json
from .lettering import page_texts
from .lora import lora_info, select_lora
from .models import DIALOGUE_MODES, PAGE_FORMAT, Character, Page, Project
from .preview import render_preview
from .validation import validate_page

# JSON boundaries preserve arbitrary metadata. Chinese diagnostics are intentional.
# ruff: noqa: ANN401, RUF001

BUNDLE_FORMAT = "soda-storyboard-bundle-v1"
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_SKETCH_BYTES = 2 * 1024 * 1024
MAX_SKETCH_PIXELS = 4_000_000
SKETCH_LONG_SIDE = 768
MISSING_CHARACTERS = "未包含角色卡，LoRA 和外观描述缺失"
_PAGE_FORMATS = {PAGE_FORMAT, "soda-storyboard/v1", ""}
_URL = re.compile(r"(?:https?|wss?)://[^\s\"'<>]+", re.IGNORECASE)
_WINDOWS_PATH = re.compile(r"(?<![\w])(?:[A-Za-z]:[\\/]|\\\\)[^\s\"'<>|]*")
_POSIX_PATH = re.compile(r"(?<![\w:/])/(?:[^\s/'\"<>]+/)+[^\s'\"<>]*")
_REFERENCE_KEYS = {
    "reference_images",
    "references",
    "approved_images",
    "approved_reference_images",
}


def _page_defaults(raw: dict, settings: dict) -> dict:
    project = Project.from_dict(settings)
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
        "caption_language": project.caption_language,
    }
    aliases = {
        "canvas_width": ("width", "canvas", "canvas_size"),
        "canvas_height": ("height", "canvas", "canvas_size"),
        "reading_direction": ("direction",),
        "style_prefix": ("style",),
        "dialogue_mode": ("lettering_mode",),
    }
    result = copy.deepcopy(raw)
    result["lora_policy"] = project.lora_policy
    for key, value in defaults.items():
        if key not in result and not any(alias in result for alias in aliases.get(key, ())):
            result[key] = copy.deepcopy(value)
    if not result.get("style_prompt"):
        result["style_prompt"] = project.style_prompt
    if not result.get("style_prefix") and not result.get("style"):
        result["style_prefix"] = project.default_style_prefix
    if result.get("caption_language") is None:
        result["caption_language"] = project.caption_language
    return result


def _read_source(source: str | Path | Mapping[str, Any]) -> dict:
    if isinstance(source, Mapping):
        value = copy.deepcopy(dict(source))
        if len(json.dumps(value, ensure_ascii=False).encode("utf-8")) > MAX_FILE_BYTES:
            message = "分镜文件不能超过 16 MiB"
            raise ValueError(message)
    else:
        path = Path(source)
        if path.stat().st_size > MAX_FILE_BYTES:
            message = "分镜文件不能超过 16 MiB"
            raise ValueError(message)
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        message = "分镜文件必须包含 JSON 对象"
        raise TypeError(message)
    return value


def _sketch_limits(image: Image.Image, byte_count: int) -> None:
    if (
        byte_count > MAX_SKETCH_BYTES
        or image.format != "PNG"
        or image.width * image.height > MAX_SKETCH_PIXELS
    ):
        message = "草稿缩略图必须为不超过 2 MiB、400 万像素的 PNG"
        raise ValueError(message)


def _check_sketch(encoded: Any) -> None:
    if encoded == "":
        return
    if not isinstance(encoded, str) or len(encoded) > MAX_SKETCH_BYTES * 2:
        message = "草稿缩略图无效或超过大小限制"
        raise ValueError(message)
    try:
        payload = base64.b64decode(encoded, validate=True)
        with Image.open(io.BytesIO(payload)) as image:
            _sketch_limits(image, len(payload))
            image.verify()
    except (OSError, ValueError, binascii.Error, Image.DecompressionBombError) as exc:
        message = f"草稿缩略图损坏：{exc}"
        raise ValueError(message) from exc


def _validated_warnings(page: Page, cards: dict[str, Character], *, bare: bool = False) -> list[str]:
    if page.dialogue_mode not in DIALOGUE_MODES:
        message = "台词模式必须为 moss_text 或 lettering"
        raise ValueError(message)
    report = validate_page(page, cards)
    # A bare page deliberately has no character table. Keep every geometry and
    # content error, but permit overlays to use the same id-only fallback as figures.
    errors = [
        issue
        for issue in report.errors
        if not (bare and not cards and issue.code == "unknown_overlay_character")
    ]
    if errors:
        message = "分镜页校验失败：\n" + "\n".join(issue.message for issue in errors)
        raise ValueError(message)
    warnings = [issue.message for issue in [*report.infos, *report.warnings]]
    if not cards:
        warnings.insert(0, MISSING_CHARACTERS)
    if any(
        issue.code
        in {"caption_translation_missing", "caption_translation_stale", "caption_translation_legacy"}
        for issue in report.warnings
    ):
        warnings.append("英文译文缺失或已过期；请先运行 soda-storyboard translate <页> --todo。")
    return list(dict.fromkeys(warnings))


def load_bundle(
    path_or_dict: str | Path | Mapping[str, Any],
) -> tuple[Page, dict[str, Character], dict[str, Any], list[str]]:
    """Load a v1 bundle or bare page, inheriting project defaults and validating.

    The third result is the raw project settings, including unknown fields.
    Bare pages compile with id-only characters and a missing-card warning; their
    geometry and content errors still fail. No referenced image or LoRA is read.
    """
    value = _read_source(path_or_dict)
    bare = value.get("format") != BUNDLE_FORMAT
    if not bare:
        raw, settings, characters = value.get("page"), value.get("project", {}), value.get("characters", {})
        _check_sketch(value.get("sketch_png_base64", ""))
    elif value.get("format", PAGE_FORMAT) in _PAGE_FORMATS and (
        "panels" in value or value.get("format") in {PAGE_FORMAT, "soda-storyboard/v1"}
    ):
        raw, settings, characters = value, {}, {}
    else:
        message = "不是 soda-storyboard-bundle-v1 分镜包或单独分镜单"
        raise ValueError(message)
    if not isinstance(raw, dict) or not isinstance(settings, dict) or not isinstance(characters, dict):
        message = "分镜包的 page、project、characters 必须是对象"
        raise TypeError(message)
    page = Page.from_dict(_page_defaults(raw, settings))
    cards = {key: Character.from_dict(card) for key, card in characters.items()}
    if any(key != card.id for key, card in cards.items()):
        message = "分镜包的角色 id 必须与角色卡 id 一致"
        raise ValueError(message)
    return page, cards, settings, _validated_warnings(page, cards, bare=bare)


def _basename(value: str) -> str:
    return PurePosixPath(value.replace("\\", "/")).name


def _lora(page: Page, cards: dict[str, Character]) -> dict | None:
    chosen = select_lora(page, cards)
    if chosen is None:
        return None
    return {
        "character_id": chosen["character_id"],
        "filename": _basename(chosen["path"]),
        "strength": chosen["strength"],
    }


def _without_tokens(value: str, tokens: list[str]) -> str:
    for token in tokens:
        left = r"(?<![A-Za-z0-9_])" if token[0].isascii() and (token[0].isalnum() or token[0] == "_") else ""
        right = (
            r"(?![A-Za-z0-9_])" if token[-1].isascii() and (token[-1].isalnum() or token[-1] == "_") else ""
        )
        value = re.sub(left + re.escape(token) + right, "", value, flags=re.IGNORECASE)
    value = re.sub(r"([,，;；])(?:\s*[,，;；])+", r"\1", value)
    value = re.sub(r"[ \t]{2,}", " ", value)
    return value.strip(" ,，;；")


def _suppress_triggers(page: Page, cards: dict[str, Character]) -> list[str]:
    states = {panel.id: translation_state(panel, page, cards) for panel in page.panels}
    tokens = sorted(
        {token.strip() for card in cards.values() for token in card.trigger_words if token.strip()},
        key=len,
        reverse=True,
    )
    for card in cards.values():
        card.trigger_words = []
    for panel in page.panels:
        if panel.caption_auto_en and states[panel.id] == "fresh":
            panel.caption_auto_en["source_hash"] = source_hash(panel, page, cards)
        elif panel.caption_auto_en and states[panel.id] == "stale":
            # Removing triggers must not accidentally validate an already stale cache.
            panel.caption_auto_en["source_hash"] = "trigger-suppressed-stale"
    return tokens


def compile_bundle(
    bundle: str | Path | Mapping[str, Any],
    *,
    dialogue_mode: str | None = None,
    slant_mode: str = "cut",
    include_triggers: bool = True,
) -> dict[str, Any]:
    """Compile through the ordinary F5 compiler without mutating the envelope.

    Return ``moss`` (a JSON object), ``width``, ``height``, ``lora`` (the shared
    selection's character_id, filename and strength, or None), and ``warnings``.
    Trigger suppression leaves fresh English caches fresh and removes explicit
    trigger tokens from generated, cached, overridden and preserved captions.
    Dialogue text remains verbatim.
    """
    page, cards, _, warnings = load_bundle(bundle)
    if dialogue_mode is not None:
        if dialogue_mode not in DIALOGUE_MODES:
            message = "台词模式必须为 moss_text 或 lettering"
            raise ValueError(message)
        page.dialogue_mode = dialogue_mode
        warnings = _validated_warnings(page, cards, bare=not cards)
    chosen = _lora(page, cards)
    tokens = [] if include_triggers else _suppress_triggers(page, cards)
    moss = compile_page(page, cards, slant_mode=slant_mode)
    if tokens:
        moss["summary"]["caption"] = _without_tokens(moss["summary"]["caption"], tokens)
        for item in moss["items"]:
            if isinstance(item.get("caption"), str):
                item["caption"] = _without_tokens(item["caption"], tokens)
    return {"moss": moss, "width": page.width, "height": page.height, "lora": chosen, "warnings": warnings}


def _appearing(page: Page) -> list[str]:
    identifiers = {identifier for panel in page.panels for identifier in panel.character_ids}
    identifiers.update(figure.character_id for panel in page.panels for figure in panel.figures)
    identifiers.update(overlay.character_id for overlay in page.overlays)
    identifiers.update(text.speaker_id for text in page_texts(page) if text.speaker_id)
    return sorted(identifier for identifier in identifiers if identifier)


def _portable_url(match: re.Match[str]) -> str:
    value = match[0]
    try:
        hostname = (urlsplit(value).hostname or "").casefold()
    except ValueError:
        return ""
    if "." not in hostname or hostname.endswith((".localhost", ".local", ".lan", ".internal")):
        return ""
    try:
        address = ip_address(hostname)
    except ValueError:
        return value
    return "" if address.is_private or address.is_loopback or address.is_link_local else value


def _portable_string(value: str, *, filename: bool = False) -> str:
    value = _URL.sub(_portable_url, value)
    if not value:
        return value
    if filename or PureWindowsPath(value).is_absolute() or PurePosixPath(value).is_absolute():
        return _basename(value)
    if value.casefold().startswith("file://"):
        return _basename(value)
    value = _WINDOWS_PATH.sub(lambda match: _basename(match[0].rstrip()), value)
    return _POSIX_PATH.sub(lambda match: _basename(match[0]), value)


def _portable(value: Any, *, key: str = "", in_lora: bool = False) -> Any:
    if isinstance(value, dict):
        return {
            _portable_string(str(name)): _portable(item, key=str(name), in_lora=in_lora or name == "lora")
            for name, item in value.items()
        }
    if isinstance(value, list):
        return [_portable(item, key=key, in_lora=in_lora) for item in value]
    if isinstance(value, str):
        return _portable_string(
            value,
            filename=key in _REFERENCE_KEYS or key in {"lora", "lora_path"} or (in_lora and key == "path"),
        )
    return value


def _project_root(page_path: Path) -> Path:
    for parent in page_path.parents:
        if (parent / "project.json").is_file():
            return parent
    return page_path.parent.parent if page_path.parent.name == "pages" else page_path.parent


def _sketch(page: Page, cards: dict[str, Character]) -> str:
    with TemporaryDirectory(prefix="soda-bundle-sketch-") as directory:
        target = Path(directory) / "sketch.png"
        render_preview(page, target, cards, scale=SKETCH_LONG_SIDE / max(page.canvas_size))
        with Image.open(target) as image:
            image.thumbnail((SKETCH_LONG_SIDE, SKETCH_LONG_SIDE))
            output = io.BytesIO()
            image.convert("RGB").save(output, format="PNG", optimize=True)
        encoded = base64.b64encode(output.getvalue()).decode("ascii")
        _check_sketch(encoded)
        return encoded


def _generator() -> str:
    try:
        return f"soda-storyboard {version('soda-storyboard')}"
    except PackageNotFoundError:  # pragma: no cover - only uninstalled source checkouts
        return "soda-storyboard 0+unknown"


def export_bundle(
    page_path: str | Path, *, output: str | Path | None = None, no_sketch: bool = False
) -> dict[str, Any]:
    """Validate and export raw page/project/appearing cards as one portable file.

    The default destination is ``<project>/exports/<page-id>.storyboard.json``.
    Return its path and counts, appearing ids, suggested LoRA, per-panel
    translation_status and nonblocking warnings. Invalid input never creates or
    overwrites the output. Source files and referenced assets are never changed.
    """
    source = Path(page_path).resolve()
    raw = read_json(source)
    root = _project_root(source)
    settings = read_json(root / "project.json") if (root / "project.json").is_file() else {}
    page = Page.from_dict(_page_defaults(raw, settings))
    appearing = _appearing(page)
    raw_cards = {}
    for identifier in appearing:
        # A character id is data, never an arbitrary file path.
        if identifier in {".", ".."} or any(character in identifier for character in "/\\:\x00"):
            message = f"角色 id 不能包含路径：{identifier}"
            raise ValueError(message)
        character_path = root / "characters" / f"{identifier}.json"
        if not character_path.is_file():
            message = f"分镜页校验失败：找不到角色卡 {identifier}"
            raise ValueError(message)
        raw_cards[identifier] = read_json(character_path)
    cards = {key: Character.from_dict(card) for key, card in raw_cards.items()}
    if any(key != card.id for key, card in cards.items()):
        message = "角色卡 id 必须与文件名一致"
        raise ValueError(message)
    warnings = _validated_warnings(page, cards)
    payload = _portable(
        {
            "format": BUNDLE_FORMAT,
            "exported_at": datetime.now(UTC).isoformat(),
            "generator": _generator(),
            "project": settings,
            "page": raw,
            "characters": raw_cards,
        }
    )
    # Validate the portable copy too, so sanitization cannot silently invalidate a
    # model or a fresh caption cache. A sketch reads no source/reference images.
    portable_page, portable_cards, _, portable_warnings = load_bundle(payload)
    warnings = list(dict.fromkeys([*warnings, *portable_warnings]))
    if not no_sketch:
        payload["sketch_png_base64"] = _sketch(portable_page, portable_cards)
    if len((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")) > MAX_FILE_BYTES:
        message = "导出的分镜文件不能超过 16 MiB"
        raise ValueError(message)
    if output is None:
        if not page.id or page.id in {".", ".."} or any(character in page.id for character in "/\\:\x00"):
            message = "默认导出需要不含路径的页面 id"
            raise ValueError(message)
        destination = root / "exports" / f"{page.id}.storyboard.json"
    else:
        destination = Path(output)
    inputs = {source, (root / "project.json").resolve()}
    inputs.update((root / "characters" / f"{identifier}.json").resolve() for identifier in appearing)
    if destination.resolve() in inputs:
        message = "导出路径不能覆盖分镜、项目或角色卡源文件"
        raise ValueError(message)
    write_json(destination, payload)
    return {
        "path": str(destination.resolve()),
        "page_id": page.id,
        "panel_count": len(page.panels),
        "dialogue_count": sum(text.kind == "dialogue" for text in page_texts(page)),
        "characters": appearing,
        "lora": _lora(portable_page, portable_cards),
        "lora_info": lora_info(portable_page, portable_cards),
        "translation_status": {
            panel.id: "custom"
            if custom_caption_enabled(panel, portable_page)
            else translation_state(panel, portable_page, portable_cards)
            for panel in portable_page.panels
        },
        "warnings": warnings,
        "sketch": not no_sketch,
    }


__all__ = ["BUNDLE_FORMAT", "compile_bundle", "export_bundle", "load_bundle"]
