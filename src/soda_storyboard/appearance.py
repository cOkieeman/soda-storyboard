"""Deterministic character appearance composition without scene translation changes."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from typing import Any

from .models import Character

# Forward-compatible character JSON is deliberately heterogeneous.
# ruff: noqa: ANN401, EM101, EM102, TRY003, RUF001


def content_hash(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _bilingual(value: Any, field: str) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise TypeError(f"{field} 必须是中英文字段对象")
    for language in ("zh", "en"):
        if language in value and not isinstance(value[language], str):
            raise TypeError(f"{field}.{language} 必须是文本")
    return value


def _phrase(value: dict, language: str = "zh") -> str:
    return value.get(language, "").strip().strip("，,。;； ")


def compose_appearance(profile: dict) -> str:
    """Compose fixed Chinese features in a stable order; never infer missing details."""
    if not isinstance(profile, dict):
        raise TypeError("appearance_profile 必须是对象")
    if profile.get("version", 1) != 1 or profile.get("mode", "structured") not in {"structured", "text"}:
        raise ValueError("appearance_profile 版本或模式无效")
    hair = profile.get("hair", {})
    if not isinstance(hair, dict):
        raise TypeError("appearance_profile.hair 必须是对象")
    style = _bilingual(hair.get("style"), "hair.style")
    color = _bilingual(hair.get("color"), "hair.color")
    parts = [_phrase(color) + _phrase(style), _phrase(_bilingual(profile.get("eyes"), "eyes"))]
    outfit = profile.get("outfit", [])
    signatures = profile.get("signatures", [])
    if not isinstance(outfit, list) or not isinstance(signatures, list):
        raise TypeError("appearance_profile.outfit/signatures 必须是数组")
    garment_ids = set()
    for index, garment in enumerate(outfit):
        if not isinstance(garment, dict):
            raise TypeError(f"outfit[{index}] 必须是对象")
        garment_id = garment.get("id")
        if not isinstance(garment_id, str) or not garment_id or garment_id in garment_ids:
            raise ValueError(f"outfit[{index}].id 不能为空或重复")
        garment_ids.add(garment_id)
        components = [
            _phrase(_bilingual(garment.get(field), f"outfit[{index}].{field}"))
            for field in ("color", "style", "detail")
        ]
        parts.append("".join(components))
    parts.extend(
        _phrase(_bilingual(signature, f"signatures[{index}]")) for index, signature in enumerate(signatures)
    )
    parts.append(_phrase(_bilingual(profile.get("extra"), "extra")))
    return "，".join(part for part in parts if part)


def set_appearance(value: dict, language: str, text: str) -> None:
    """Update every existing legacy alias while preserving unknown nested fields."""
    flat = f"appearance_{language}"
    if flat in value:
        value[flat] = text
    current = value.get("appearance")
    if not isinstance(current, dict):
        current = {"zh": current} if isinstance(current, str) else {}
        value["appearance"] = current
    current[language] = text
    if language == "zh" and "cn" in current:
        current["cn"] = text


def synthesize_character(value: dict) -> dict:
    """Return a copy with structured Chinese appearance and provenance hashes."""
    result = deepcopy(value)
    profile = result.get("appearance_profile")
    if profile is None:
        return result
    chinese = compose_appearance(profile)
    if profile.get("mode", "structured") == "text":
        return result
    source_hash = content_hash({key: item for key, item in profile.items() if key != "generated"})
    character = Character.from_dict(result)
    existing_hash = content_hash(character.appearance_zh)
    generated = profile.get("generated", {})
    # An external final-text edit must not be overwritten by unrelated saves.
    if (
        isinstance(generated, dict)
        and generated.get("appearance_hash") is not None
        and generated.get("appearance_hash") != existing_hash
    ):
        return result
    set_appearance(result, "zh", chinese)
    generated = dict(generated) if isinstance(generated, dict) else {}
    generated.update(
        composer="appearance-v1",
        source_hash=source_hash,
        appearance_hash=content_hash(Character.from_dict(result).appearance_zh),
    )
    profile["generated"] = generated
    return result


def appearance_warnings(value: dict) -> list[dict]:
    """Form hints supplement the shared conservative clothing warnings."""
    character = Character.from_dict(value)
    warnings = []

    def add(code: str, message: str, field: str) -> None:
        warnings.append({"severity": "warning", "code": code, "message": message, "field": field})

    if not character.appearance_zh and not character.appearance_en:
        add("character_appearance_missing", "尚未填写固定外观，可先保存后补充。", "appearance")
    if character.appearance_zh and not character.appearance_en:
        add(
            "character_english_missing", "英文外观为空，可手动填写或交给插件 AI 翻译后粘贴。", "appearance.en"
        )
    profile = value.get("appearance_profile")
    if not isinstance(profile, dict) or profile.get("mode") == "text":
        return warnings
    for index, garment in enumerate(profile.get("outfit", [])):
        for field, label in (("style", "款式"), ("color", "颜色")):
            if not _phrase(garment.get(field, {})):
                add(
                    f"character_garment_{field}_missing",
                    f"第 {index + 1} 件服装尚未填写{label}；头发和眼睛的颜色不能代替服装颜色。",
                    f"appearance_profile.outfit.{index}.{field}",
                )
    generated = profile.get("generated", {})
    if isinstance(generated, dict) and generated.get("appearance_hash") not in {
        None,
        content_hash(character.appearance_zh),
    }:
        add(
            "appearance_generated_mismatch",
            "最终外观已被其他工具修改，已保留当前文本；可切换文本模式或显式重新生成。",
            "appearance_profile",
        )
    return warnings
