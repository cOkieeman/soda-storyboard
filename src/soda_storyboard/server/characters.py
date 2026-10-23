"""Raw character storage, versioned editor writes and unsaved form validation."""

from __future__ import annotations

import re
import uuid
from copy import deepcopy
from typing import TYPE_CHECKING

from soda_storyboard.appearance import (
    appearance_warnings,
    content_hash,
    set_appearance,
    synthesize_character,
)
from soda_storyboard.clothing import clothing_warnings
from soda_storyboard.json_safety import check_json_numbers
from soda_storyboard.models import CHARACTER_FORMAT, Character, Page
from soda_storyboard.persistence import page_lock

from .common import APIError, snapshot

if TYPE_CHECKING:
    from pathlib import Path

    from .store import Store

# This module accepts forward-compatible raw JSON and reports Chinese diagnostics.
# ruff: noqa: RUF001

NEW_ID = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
RESERVED_IDS = {"auto", "none", "con", "prn", "aux", "nul", "validate"} | {
    f"{prefix}{index}" for prefix in ("com", "lpt") for index in range(1, 10)
}
ALIASES = (
    ("display_name", "name"),
    ("trigger_words", "triggers"),
    ("reference_images", "references"),
    ("approved_images", "approved_reference_images"),
)


def merge_raw(current: dict, fields: dict) -> dict:
    """Objects merge recursively; arrays replace; unknown nested metadata survives."""
    result = deepcopy(current)
    for key, value in fields.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = merge_raw(result[key], value)
        else:
            result[key] = deepcopy(value)
    return result


def patch_character(current: dict, fields: dict) -> dict:  # noqa: C901, PLR0912 -- legacy alias families
    baseline = current
    if isinstance(current.get("appearance"), str) and isinstance(fields.get("appearance"), dict):
        baseline = {**current, "appearance": {"zh": current["appearance"]}}
    result = merge_raw(baseline, fields)
    for keys in ALIASES:
        supplied = next((key for key in keys if key in fields), None)
        if supplied is not None:
            for key in set(keys) & result.keys() | {keys[0]}:
                result[key] = deepcopy(fields[supplied])
    appearance = fields.get("appearance", {})
    for language in ("zh", "en"):
        flat = f"appearance_{language}"
        nested = "zh" if isinstance(appearance, dict) and "zh" in appearance else "cn"
        if flat in fields:
            set_appearance(result, language, fields[flat])
        elif isinstance(appearance, dict) and (
            language in appearance or (language == "zh" and "cn" in appearance)
        ):
            set_appearance(result, language, appearance[language if language == "en" else nested])
        elif isinstance(appearance, str) and language == "zh":
            set_appearance(result, language, appearance)
    if "lora" in fields or "lora_path" in fields or "lora_strength" in fields:
        if fields.get("lora", ...) is None:
            for key in ("lora", "lora_path", "lora_strength"):
                result.pop(key, None)
        else:
            lora = fields.get("lora", {})
            path = fields.get("lora_path")
            strength = fields.get("lora_strength")
            if isinstance(lora, str):
                path = lora
            elif isinstance(lora, dict):
                path = next((lora[key] for key in ("path", "model", "file") if key in lora), path)
                strength = lora.get("strength", strength)
            previous = Character.from_dict(current).lora
            nested_lora = result.get("lora")
            nested_lora = dict(nested_lora) if isinstance(nested_lora, dict) else {}
            if path is not None:
                for key in {"path"} | ({"model", "file"} & nested_lora.keys()):
                    nested_lora[key] = path
                if "lora_path" in result:
                    result["lora_path"] = path
            elif previous is not None:
                nested_lora.setdefault("path", previous.path)
            if strength is not None:
                nested_lora["strength"] = strength
                if "lora_strength" in result:
                    result["lora_strength"] = strength
            result["lora"] = nested_lora
    if fields.get("appearance_profile", ...) is None:
        result.pop("appearance_profile", None)
    elif (
        isinstance(fields.get("appearance_profile"), dict) and "generated" not in fields["appearance_profile"]
    ):
        result["appearance_profile"].pop("generated", None)
    return result


def appearing_ids(page: Page) -> set[str]:
    return {
        identifier
        for panel in page.panels
        for identifier in [*panel.character_ids, *(figure.character_id for figure in panel.figures)]
    } | {overlay.character_id for overlay in page.overlays}


class CharacterStore:
    def __init__(self, store: Store) -> None:
        self.store = store

    def index(self) -> tuple[dict[str, tuple[Path, dict, str]], list[dict]]:
        result = {}
        diagnostics = []
        seen = {}
        for candidate in sorted(self.store.path("characters").glob("*.json")):
            relative = candidate.relative_to(self.store.root).as_posix()
            try:
                path = self.store.path(relative)
                raw, version = snapshot(path)
                character = Character.from_dict(raw)
                if not character.id:
                    raise ValueError  # noqa: TRY301 -- converted to a catalog diagnostic
            except (OSError, ValueError, TypeError, KeyError, APIError) as exc:
                diagnostics.append({"code": "invalid_character_file", "path": relative, "message": str(exc)})
                continue
            folded = character.id.casefold()
            if folded in seen:
                diagnostics.append(
                    {
                        "code": "character_id_collision",
                        "character_id": character.id,
                        "paths": [seen[folded], relative],
                        "message": "角色 ID 重复或存在大小写冲突，请在文件中修复后重试。",
                    }
                )
            else:
                seen[folded] = relative
            result.setdefault(character.id, (path, raw, version))
            if path.stem != character.id:
                diagnostics.append(
                    {
                        "code": "character_filename_mismatch",
                        "character_id": character.id,
                        "path": relative,
                        "message": "角色文件名与 ID 不同，将继续写回原文件。",
                    }
                )
        return result, diagnostics

    def locate(self, character_id: str) -> tuple[Path, dict, str]:
        entries, diagnostics = self.index()
        for diagnostic in diagnostics:
            if (
                diagnostic["code"] == "character_id_collision"
                and diagnostic["character_id"].casefold() == character_id.casefold()
            ):
                raise APIError(
                    409, diagnostic["message"], reason="character_id_collision", diagnostics=diagnostics
                )
        if character_id not in entries:
            raise APIError(404, "角色不存在", reason="character_not_found")
        return entries[character_id]

    def catalog(self) -> dict:
        entries, diagnostics = self.index()
        characters = []
        versions = {}
        for character_id, (_, raw, version) in entries.items():
            characters.append(merge_raw(raw, Character.from_dict(raw).to_dict()))
            versions[character_id] = version
        return {
            "characters": characters,
            "versions": versions,
            "catalog_version": content_hash({"versions": versions, "diagnostics": diagnostics}),
            "diagnostics": diagnostics,
        }

    def detail(self, character_id: str) -> dict:
        path, raw, version = self.locate(character_id)
        return {
            "character": raw,
            "version": version,
            "path": path.relative_to(self.store.root).as_posix(),
            "warnings": self.warnings(raw),
        }

    def match(self, character_id: str, expected: str | None) -> tuple[Path, dict, str]:
        path, raw, version = self.locate(character_id)
        if expected != version:
            raise APIError(
                409,
                "角色资料版本冲突，请比较服务器内容并保留本地草稿后重试",
                reason="character_version_conflict",
                current=raw,
                version=version,
            )
        return path, raw, version

    def warnings(self, raw: dict, page: dict | None = None) -> list[dict]:
        candidate = Character.from_dict(raw)
        characters = self.store.character_map() if page is not None else {}
        characters[candidate.id] = candidate
        appearing = appearing_ids(Page.from_dict(page)) if page is not None else set()
        appearing.add(candidate.id)
        return [
            *appearance_warnings(raw),
            *(
                warning
                for warning in clothing_warnings(characters, appearing)
                if warning["details"].get("character_id") == candidate.id
                or candidate.id in warning["details"].get("character_ids", [])
            ),
        ]

    def prepare(self, raw: dict) -> dict:
        try:
            check_json_numbers(raw)
            result = synthesize_character(raw)
            character = Character.from_dict(result)
            if not character.id.strip() or not character.display_name.strip():
                raise ValueError("角色 ID 和名称不能为空")  # noqa: EM101, TRY003, TRY301
            if character.lora is not None and not character.lora.path.strip():
                raise ValueError("LoRA 文件路径不能为空；无需 LoRA 时请关闭此选项")  # noqa: EM101, TRY003, TRY301
        except (TypeError, ValueError, KeyError, AttributeError, OverflowError) as exc:
            raise APIError(422, f"角色数据格式错误：{exc}", reason="invalid_character") from exc
        return result

    def validate(self, options: dict) -> dict:
        raw = options.get("character")
        page = options.get("page")
        if not isinstance(raw, dict) or (page is not None and not isinstance(page, dict)):
            raise APIError(400, "character 和可选 page 必须是 JSON 对象")
        # Empty names and IDs are useful while typing; only persisted writes require them.
        temporary = {
            **raw,
            "id": raw.get("id") or "draft",
            "display_name": raw.get("display_name", raw.get("name")) or "草稿角色",
        }
        value = self.prepare(temporary)
        for field in ("id", "display_name"):
            if field in raw:
                value[field] = raw[field]
            else:
                value.pop(field, None)
        return {
            "character": value,
            "appearance": Character.from_dict(value).appearance,
            "warnings": self.warnings(value, page),
            "errors": [],
        }

    def guard_pages(self, character_id: str, before: dict, after: dict) -> None:
        removing_lora = Character.from_dict(before).has_lora and not Character.from_dict(after).has_lora
        affected = []
        for candidate in sorted(self.store.path("pages").glob("*.json")):
            try:
                path = self.store.path(candidate.relative_to(self.store.root).as_posix())
                raw, _ = snapshot(path)
                page = Page.from_dict(raw)
            except (OSError, ValueError, TypeError, APIError) as exc:
                if removing_lora or self.store.production_pages:
                    raise APIError(
                        409, "无法读取页面，不能确认角色修改的影响", reason="unreadable_reference_page"
                    ) from exc
                continue
            if candidate.stem in self.store.production_pages and character_id in appearing_ids(page):
                raise APIError(409, "引用此角色的页面正在执行生产任务", reason="production_running")
            if removing_lora and raw.get("lora_character") == character_id:
                affected.append(candidate.stem)
        if affected:
            raise APIError(
                409,
                "有页面显式选择了此角色 LoRA，请先在页面中调整选择；跨页联动修复将在后续阶段支持。",
                reason="lora_references_require_plan",
                affected_pages=affected,
            )

    def create(self, raw: dict, *, source_version: tuple[str, str | None] | None = None) -> dict:
        character_id = raw.get("id", "")
        if (
            not isinstance(character_id, str)
            or not NEW_ID.fullmatch(character_id)
            or character_id in RESERVED_IDS
        ):
            raise APIError(
                400,
                "新角色 ID 需为小写字母开头，最多 64 位字母、数字、下划线或短横线，且不能是保留字。",
                reason="invalid_character_id",
            )
        target = self.store.path(f"characters/{character_id}.json")
        with self.store.lock, page_lock(target):
            entries, _ = self.index()
            filenames = {path.stem.casefold() for path in target.parent.glob("*.json")}
            if character_id.casefold() in {key.casefold() for key in entries} | filenames:
                raise APIError(409, "角色 ID 已存在或存在大小写冲突", reason="character_id_exists")
            value = self.prepare({"format": CHARACTER_FORMAT, "clothing": [], **raw})
            if source_version is not None:
                self.match(*source_version)
            saved, version = self.store.atomic(target, value)
            return self.saved_result(target, saved, version)

    def saved_result(self, path: Path, saved: dict, version: str) -> dict:
        return {
            "character": saved,
            "version": version,
            "path": path.relative_to(self.store.root).as_posix(),
            "warnings": self.warnings(saved),
            "operation_id": uuid.uuid4().hex,
        }

    def save(self, character_id: str, fields: dict, expected: str | None, *, patch: bool = True) -> dict:
        with self.store.lock:
            path, current, _ = self.locate(character_id)
            with page_lock(path):
                if patch or expected is not None:
                    _, current, _ = self.match(character_id, expected)
                if fields.get("id", character_id) != character_id:
                    raise APIError(400, "本阶段不能通过角色资料接口更改 ID", reason="character_id_immutable")
                raw = patch_character(current, fields) if patch else deepcopy(fields)
                # PUT remains the legacy complete-document API.
                value = self.prepare(raw)
                self.guard_pages(character_id, current, value)
                if patch or expected is not None:
                    self.match(character_id, expected)
                saved, version = self.store.atomic(path, value, expected_version=expected)
                return self.saved_result(path, saved, version)

    def duplicate(self, source_id: str, options: dict, expected: str | None) -> dict:
        with self.store.lock:
            _, source, _ = self.match(source_id, expected)
            draft = options.get("character")
            if not isinstance(draft, dict):
                raise APIError(400, "character 必须是已编辑完成的副本 JSON 对象")
            for key in ("copy_lora", "copy_trigger_words", "copy_reference_images"):
                if key in options and not isinstance(options[key], bool):
                    raise APIError(400, f"{key} 必须是布尔值")
            value = patch_character(source, draft)
            for keys, enabled in (
                (("lora", "lora_path", "lora_strength"), options.get("copy_lora", False)),
                (("trigger_words", "triggers"), options.get("copy_trigger_words", False)),
                (("reference_images", "references"), options.get("copy_reference_images", True)),
                (("approved_images", "approved_reference_images", "editor_data", "editor_history"), False),
            ):
                if not enabled:
                    for key in keys:
                        value.pop(key, None)
            self.match(source_id, expected)
            return self.create(value, source_version=(source_id, expected))
