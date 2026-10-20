"""Compile storyboard pages into the MOSS-Image layout JSON contract."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from .geometry import panel_to_moss_bbox, shape_bbox
from .models import Character, Dialogue, Page, Panel


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
            value += f"（{detail}）"
        elif triggers:
            value += f" [{triggers}]"
        parts.append(value)
    return "、".join(parts)


def _panel_caption(panel: Panel, characters: Mapping[str, Character]) -> str:
    chunks = [f"景别：{panel.shot}", f"角度：{panel.angle}"]
    character_text = _character_caption(panel, characters)
    if character_text:
        chunks.append(f"角色：{character_text}")
    if panel.description:
        chunks.append(f"画面：{panel.description}")
    if panel.sfx:
        chunks.append(f"音效：{'、'.join(panel.sfx)}")
    return "；".join(chunks)


def _text_bbox(panel: Panel, dialogue: Dialogue, index: int, page: Page) -> list[float]:
    """Place a speech item in the upper portion of its panel."""

    x, y, x2, y2 = shape_bbox(panel.shape)
    width = max(1.0, x2 - x)
    height = max(1.0, y2 - y)
    band_height = min(max(72.0, height * 0.22), 180.0)
    band_width = min(max(160.0, width * 0.72), width)
    position = (dialogue.position or "").lower()
    rtl = page.reading_direction != "ltr"
    if position in {"left", "upper_left", "top_left"}:
        left = x
    elif position in {"right", "upper_right", "top_right"}:
        left = x + width - band_width
    elif (index % 2 == 0) == rtl:
        left = x + width - band_width
    else:
        left = x
    top = y + min(24.0 + index * (band_height * 0.85), max(0.0, height - band_height))
    return panel_to_moss_bbox(
        {"x": left, "y": top, "w": band_width, "h": band_height}, page.canvas_width, page.canvas_height
    )


def compile_page(
    page: Page,
    characters: Mapping[str, Character] | Iterable[Character] | None = None,
    *,
    size_check: tuple[int, int] | None = None,
) -> dict[str, Any]:
    """Return a MOSS layout dictionary for ``page``."""

    character_map = _character_map(characters)
    panel_summaries = [f"{panel.order}. {_panel_caption(panel, character_map)}" for panel in page.panels]
    lead = "；".join(part for part in (page.style_prefix, page.description) if part)
    suffix = f"日式漫画页，{len(page.panels)} 格，白色格间留白"
    caption = "；".join(part for part in (lead, "；".join(panel_summaries), suffix) if part)
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
                "bbox": panel_to_moss_bbox(panel.shape, page.canvas_width, page.canvas_height),
                "panel_id": panel.id,
            }
        )
        if page.dialogue_mode == "moss_text":
            for index, dialogue in enumerate(panel.dialogue):
                items.append(
                    {
                        "label": "text",
                        "caption": f"{dialogue.bubble}：{dialogue.text}",
                        "bbox": _text_bbox(panel, dialogue, index, page),
                        "panel_id": panel.id,
                        "speaker_id": dialogue.speaker_id,
                    }
                )
    return result


__all__ = ["compile_page"]
