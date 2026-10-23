"""AI-assisted translation file exchange. This module never calls a service."""

# ruff: noqa: RUF001 -- instructions for offline Chinese-to-English translators.

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from .captions import (
    SCENE_TRANSLATION_FORMAT,
    TRANSLATION_MIGRATION,
    clean_caption,
    custom_caption_enabled,
    panel_character_ids,
    source_hash,
    translation_source,
    translation_state,
)
from .panel_positions import panel_positions

if TYPE_CHECKING:
    from collections.abc import Mapping

    from .models import Character, Page


def translation_todo(page: Page, characters: Mapping[str, Character], glossary: Mapping[str, str]) -> dict:
    return {
        "page_id": page.id,
        "format": SCENE_TRANSLATION_FORMAT,
        "instructions": (
            "只翻译 source_zh 中的场景、动作和道具，保留动作的角色归属。"
            "人物外观和服装（包括动作句中的发色、服装颜色与款式）不翻译，"
            "不要写方位前缀、景别、角度或程序姿势；编译器会统一插入这些内容。"
            "例如发色随风飘动只翻译为 hair blowing in the wind。"
            "返回 panel_id、source_hash 和英文 text。"
        ),
        "glossary": dict(glossary),
        "panels": [
            {
                "panel_id": panel.id,
                "position_en": panel_positions(page).get(panel.id),
                "caption_zh": clean_caption(list(translation_source(panel).values())),
                "source_zh": translation_source(panel),
                "source_hash": source_hash(panel, page, characters),
                "status": translation_state(panel, page, characters),
                "characters": [
                    {
                        "character_id": identifier,
                        "name": characters[identifier].display_name
                        if identifier in characters
                        else identifier,
                        "name_en": (characters[identifier].role_en or characters[identifier].display_name)
                        if identifier in characters
                        else identifier,
                        "appearance": "[由编译器插入，不翻译]",
                    }
                    for identifier in panel_character_ids(panel, page)
                ],
                **(
                    {"migration": TRANSLATION_MIGRATION}
                    if translation_state(panel, page, characters) == "legacy"
                    else {}
                ),
            }
            for panel in page.panels
            if not custom_caption_enabled(panel, page)
            and translation_state(panel, page, characters) not in {"fresh", "preserved"}
        ],
    }


def apply_translations(page: Page, characters: Mapping[str, Character], payload: object) -> dict:
    entries = payload.get("translations", payload.get("panels", [])) if isinstance(payload, dict) else payload
    if not isinstance(entries, list):
        message = "Translations must be an array or an object containing translations"
        raise TypeError(message)
    panels = {panel.id: panel for panel in page.panels}
    accepted = []
    rejected = []
    seen = set()
    for entry in entries:
        identifier = entry.get("panel_id") if isinstance(entry, dict) else None
        reason = None
        text = entry.get("text") if isinstance(entry, dict) else None
        cleaned = clean_caption([text], "en") if isinstance(text, str) else ""
        panel = panels.get(identifier) if isinstance(identifier, str) else None
        if panel is None:
            reason = "unknown_panel"
        elif identifier in seen:
            reason = "duplicate_panel"
        elif entry.get("source_hash") != source_hash(panel, page, characters):
            reason = "source_hash_mismatch"
        elif not cleaned:
            reason = "empty_translation"
        if reason:
            rejected.append({"panel_id": identifier, "reason": reason})
            continue
        seen.add(identifier)
        panel.caption_auto_en = {
            "format": SCENE_TRANSLATION_FORMAT,
            "text": cleaned,
            "source_hash": entry["source_hash"],
            "translated_at": datetime.now(UTC).isoformat(),
        }
        accepted.append(identifier)
    return {"applied": accepted, "rejected": rejected}
