"""AI-assisted translation file exchange. This module never calls a service."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from .captions import (
    clean_caption,
    custom_caption_enabled,
    source_hash,
    structured_caption,
    translation_state,
)
from .figure_semantics import figure_description
from .figures import panel_figures
from .panel_positions import panel_positions

if TYPE_CHECKING:
    from collections.abc import Mapping

    from .models import Character, Page


def translation_todo(page: Page, characters: Mapping[str, Character], glossary: Mapping[str, str]) -> dict:
    return {
        "page_id": page.id,
        "glossary": dict(glossary),
        "panels": [
            {
                "panel_id": panel.id,
                "position_en": panel_positions(page).get(panel.id),
                "caption_zh": structured_caption(panel, page, characters),
                "source_hash": source_hash(panel, page, characters),
                "status": translation_state(panel, page, characters),
                "appearances_en": {
                    identifier: characters[identifier].appearance_en
                    for identifier in dict.fromkeys(
                        [*panel.character_ids, *(figure.character_id for figure in panel.figures)]
                    )
                    if identifier in characters and characters[identifier].appearance_en
                },
                "pose_templates_en": [
                    {
                        "character_id": figure.character_id,
                        "description": figure_description(
                            figure, "en", head_only=panel.shot in {"close_up", "extreme_close_up"}
                        ),
                    }
                    for figure in panel_figures(panel, page)
                ],
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
        panel = panels.get(identifier) if isinstance(identifier, str) else None
        if panel is None:
            reason = "unknown_panel"
        elif identifier in seen:
            reason = "duplicate_panel"
        elif entry.get("source_hash") != source_hash(panel, page, characters):
            reason = "source_hash_mismatch"
        elif not isinstance(entry.get("text"), str) or not entry["text"].strip():
            reason = "empty_translation"
        if reason:
            rejected.append({"panel_id": identifier, "reason": reason})
            continue
        seen.add(identifier)
        panel.caption_auto_en = {
            "text": clean_caption([entry["text"]], "en"),
            "source_hash": entry["source_hash"],
            "translated_at": datetime.now(UTC).isoformat(),
        }
        accepted.append(identifier)
    return {"applied": accepted, "rejected": rejected}
