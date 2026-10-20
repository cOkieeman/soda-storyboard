"""Compile storyboard pages into the MOSS-Image layout JSON contract."""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from math import floor
from typing import TYPE_CHECKING, Any

from .geometry import panel_to_moss_bbox, shape_bbox

if TYPE_CHECKING:
    from .models import Character, Dialogue, Page, Panel, Shape

SHOT_PHRASES = {
    "extreme_long": "extreme long shot",
    "long": "long shot",
    "full": "full shot",
    "medium": "medium shot",
    "close_up": "close-up",
    "extreme_close_up": "extreme close-up",
}
ANGLE_PHRASES = {
    "eye": "eye-level",
    "high": "high-angle view",
    "low": "low-angle view",
    "bird": "bird's-eye view",
    "worm": "worm's-eye view",
    "dutch": "Dutch angle",
}


def _character_map(characters: Mapping[str, Character] | Iterable[Character] | None) -> dict[str, Character]:
    if characters is None:
        return {}
    if isinstance(characters, Mapping):
        return {str(key): value for key, value in characters.items()}
    return {character.id: character for character in characters}


def _character_caption(panel: Panel, characters: Mapping[str, Character]) -> str:
    parts: list[str] = []
    for identifier in panel.character_ids:
        character = characters.get(identifier)
        if character is None:
            parts.append(identifier)
            continue
        detail = character.appearance_text()
        triggers = ", ".join(character.trigger_words)
        value = character.display_name or identifier
        if detail:
            value += f" ({detail})"
        elif triggers:
            value += f" [{triggers}]"
        parts.append(value)
    return "、".join(parts)


def _panel_caption(panel: Panel, characters: Mapping[str, Character]) -> str:
    chunks = []
    character_text = _character_caption(panel, characters)
    if character_text:
        chunks.append(character_text)
    if panel.description:
        chunks.append(panel.description)
    if panel.sfx:
        chunks.append(f"sound effects: {', '.join(panel.sfx)}")
    shot = SHOT_PHRASES.get(panel.shot, panel.shot.replace("_", "-"))
    angle = ANGLE_PHRASES.get(panel.angle, panel.angle.replace("_", "-"))
    return f"Panel {panel.order}, {shot}, {angle}: {', '.join(chunks) or 'a manga scene'}"


def _panel_summary(panel: Panel) -> str:
    shot = SHOT_PHRASES.get(panel.shot, panel.shot)
    clauses = re.split(r"[，,。.;；!?！？\n]", panel.description.strip(), maxsplit=1)
    # Retain one opening beat, never echo the complete per-panel description.
    beat = clauses[0].strip()[:24] if len(clauses) > 1 and clauses[1].strip() else ""
    return f"Panel {panel.order}: {shot}{', ' + beat if beat else ''}."


def _integer_bbox(shape: Shape, page: Page) -> list[int]:
    bounds = [page.canvas_height // 2, page.canvas_width // 2] * 2
    return [
        max(-bound, min(bound, floor(value + 0.5)))
        for value, bound in zip(
            panel_to_moss_bbox(shape, page.canvas_width, page.canvas_height), bounds, strict=True
        )
    ]


def _dialogue_caption(dialogue: Dialogue, page: Page) -> str:
    orientation = page.text_direction
    bubbles = {
        "speech": f"A white {orientation} speech bubble",
        "shout": f"A jagged shout bubble with {orientation} lettering",
        "thought": f"A cloud-shaped thought bubble with {orientation} lettering",
        "narration": f"A rectangular narration box with {orientation} lettering",
    }
    return f'{bubbles.get(dialogue.bubble, bubbles["speech"])} with Chinese text "{dialogue.text}"'


def _text_bbox(panel: Panel, dialogue: Dialogue, index: int, page: Page) -> list[int]:
    """Place a speech item in the upper portion of its panel."""

    x, y, x2, y2 = shape_bbox(panel.shape)
    width = max(1.0, x2 - x)
    height = max(1.0, y2 - y)
    band_height = min(max(72.0, height * 0.22), 180.0, height)
    band_width = min(max(160.0, width * 0.72), width)
    position = (dialogue.position or "").lower()
    rtl = page.reading_direction != "ltr"
    if position in {"left", "upper_left", "top_left"}:
        left = x
    elif position in {"right", "upper_right", "top_right"} or (index % 2 == 0) == rtl:
        left = x + width - band_width
    else:
        left = x
    top = y + min(24.0 + index * (band_height * 0.85), max(0.0, height - band_height))
    return _integer_bbox({"x": left, "y": top, "w": band_width, "h": band_height}, page)


def compile_page(
    page: Page,
    characters: Mapping[str, Character] | Iterable[Character] | None = None,
    *,
    size_check: tuple[int, int] | None = None,
    with_ids: bool = False,
) -> dict[str, Any]:
    """Return a MOSS layout dictionary for ``page``."""

    character_map = _character_map(characters)
    panel_summaries = [_panel_summary(panel) for panel in sorted(page.panels, key=lambda item: item.order)]
    lead = "; ".join(part for part in (page.style_prefix, page.description) if part)
    color = "full-color" if page.color_mode == "color" else "black-and-white"
    direction = "left to right" if page.reading_direction == "ltr" else "right to left"
    suffix = f"{color} Japanese manga page, {len(page.panels)} panels, read {direction}, clean white gutters"
    caption = "; ".join(part for part in (lead, suffix, " ".join(panel_summaries)) if part)
    if page.dialogue_mode == "lettering" or not any(d.text.strip() for p in page.panels for d in p.dialogue):
        caption += "; no text, no speech bubbles"
    result: dict[str, Any] = {
        "summary": {"meta": ["comic"], "canvas": "single", "caption": caption},
        "items": [],
        "bbox_coord_space": "abs_centralized",
        "bbox_format": "yxyx",
    }
    if size_check is not None:
        result["size_check"] = {
            "canvas": [page.canvas_width, page.canvas_height],
            "target": [int(size_check[0]), int(size_check[1])],
            "matches": [page.canvas_width, page.canvas_height] == [int(size_check[0]), int(size_check[1])],
        }
    items: list[dict[str, Any]] = result["items"]
    for panel in sorted(page.panels, key=lambda item: item.order):
        items.append(
            {
                "label": "object",
                "caption": _panel_caption(panel, character_map),
                "bbox": _integer_bbox(panel.shape, page),
            }
        )
        if with_ids:
            items[-1]["panel_id"] = panel.id
        if page.dialogue_mode == "moss_text":
            for index, dialogue in enumerate(panel.dialogue):
                if not dialogue.text.strip():
                    continue
                items.append(
                    {
                        "label": "text",
                        "caption": _dialogue_caption(dialogue, page),
                        "bbox": _text_bbox(panel, dialogue, index, page),
                    }
                )
                if with_ids:
                    items[-1].update(panel_id=panel.id, speaker_id=dialogue.speaker_id)
    return result


__all__ = ["compile_page"]
