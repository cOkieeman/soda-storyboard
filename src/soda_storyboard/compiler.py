"""Compile storyboard pages into the MOSS-Image layout JSON contract."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from itertools import combinations
from math import ceil, floor
from typing import TYPE_CHECKING, Any

from .geometry import inscribed_rect, midline_rect, panel_to_moss_bbox, shape_bbox
from .lettering import layout_texts
from .models import shape_to_dict

if TYPE_CHECKING:
    from .models import Character, Overlay, Page, Panel, Shape, Text

TOP_ROW_LIMIT = 0.34
BOTTOM_ROW_START = 0.72

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


def character_caption(identifier: str, characters: Mapping[str, Character]) -> str:
    character = characters.get(identifier)
    if character is None:
        return identifier
    detail = character.appearance_en or character.appearance_zh or character.display_name
    return ", ".join(part for part in (character.age, detail, ", ".join(character.trigger_words)) if part)


def panel_location(panel: Panel, page: Page) -> str:
    x, y, x2, y2 = shape_bbox(panel.shape)
    cy = (y + y2) / 2 / page.canvas_height
    row = "Top" if cy < TOP_ROW_LIMIT else "Bottom" if cy > BOTTOM_ROW_START else "Middle"
    if x2 - x > page.canvas_width * 0.75:
        return f"{row} wide panel"
    side = "right" if (x + x2) / 2 > page.canvas_width / 2 else "left"
    size = " small vertical" if y2 - y > (x2 - x) * 1.5 else ""
    return f"{row}-{side}{size} panel"


def _panel_caption(panel: Panel, page: Page, characters: Mapping[str, Character]) -> str:
    if panel.caption_en:
        return panel.caption_en
    identifiers = list(dict.fromkeys([*panel.character_ids, *(f.character_id for f in panel.figures)]))
    details = "; ".join(character_caption(identifier, characters) for identifier in identifiers)
    shot = SHOT_PHRASES.get(panel.shot, panel.shot.replace("_", "-"))
    angle = ANGLE_PHRASES.get(panel.angle, panel.angle.replace("_", "-"))
    return (
        f"Panel {panel.order}, {shot}, {angle}: {panel_location(panel, page)}, "
        f"{details}, {panel.description or 'a manga scene'}"
    )


def _integer_bbox(shape: Shape, page: Page, *, inward: bool = False) -> list[int]:
    bounds = [page.canvas_height // 2, page.canvas_width // 2] * 2
    values = panel_to_moss_bbox(shape, page.canvas_width, page.canvas_height)
    rounded = (
        [ceil(v - 1e-8) if i < len(values) // 2 else floor(v + 1e-8) for i, v in enumerate(values)]
        if inward
        else [floor(v + 0.5) for v in values]
    )
    result = [max(-bound, min(bound, value)) for value, bound in zip(rounded, bounds, strict=True)]
    if inward and (result[0] >= result[2] or result[1] >= result[3]):
        message = "Panel is too small to contain a positive-area integer MOSS bbox"
        raise ValueError(message)
    return result


def _compiled_shape(panel: Panel, mode: str) -> dict[str, Any]:
    shape = shape_to_dict(panel.shape)
    if shape["type"] != "quad" or mode == "rect":
        return shape
    return inscribed_rect(shape) if mode == "hint" else midline_rect(shape)


def compile_geometry_map(
    page: Page, *, slant_mode: str = "cut", size_check: tuple[int, int] | None = None
) -> dict[str, Any]:
    """Sidecar geometry only; never append this data to the MOSS prompt."""
    _validate_slant_mode(slant_mode)
    panels = []
    for panel in sorted(page.panels, key=lambda panel: panel.order):
        region = _compiled_shape(panel, slant_mode)
        entry = {
            "panel_id": panel.id,
            "order": panel.order,
            "shape": shape_to_dict(panel.shape),
            "generation_rect": dict(zip(("x", "y", "x2", "y2"), shape_bbox(region), strict=True)),
            "bbox": _integer_bbox(region, page, inward=slant_mode == "hint"),
        }
        if panel.shape_type == "quad":
            entry["quad"] = shape_to_dict(panel.shape)["points"]
        panels.append(entry)
    _validate_cut_regions(page, slant_mode, [entry["bbox"] for entry in panels])
    return {
        "page_id": page.page_id,
        "canvas": [page.canvas_width, page.canvas_height],
        "slant_mode": slant_mode,
        "shape_coord_space": "top_left_pixels",
        "bbox_coord_space": "abs_centralized",
        "bbox_format": "yxyx",
        "panels": panels,
        "overlays": [overlay.to_dict() for overlay in page.overlays],
        "texts": [text.to_dict() for text in layout_texts(page)],
        **({"size_check": size_check_report(page, size_check)} if size_check is not None else {}),
    }


def _validate_slant_mode(mode: str) -> None:
    if mode not in {"cut", "hint", "rect"}:
        message = "slant_mode must be cut, hint or rect"
        raise ValueError(message)


def _validate_cut_regions(page: Page, mode: str, bboxes: list[list[int]]) -> None:
    if mode != "cut" or not any(panel.shape_type == "quad" for panel in page.panels):
        return
    for first, second in combinations(bboxes, 2):
        if min(first[2], second[2]) > max(first[0], second[0]) and min(first[3], second[3]) > max(
            first[1], second[1]
        ):
            message = (
                "Cut midline rectangles overlap; use shared-seam geometry or slant_mode='rect' for debugging"
            )
            raise ValueError(message)


def _text_caption(text: Text, page: Page, characters: Mapping[str, Character]) -> str:
    direction = text.direction or page.text_direction
    kinds = {
        "dialogue": f"Clean {direction} Chinese dialogue text",
        "narration": f"Clean {direction} Chinese narration text",
        "sfx": f"Bold comic sound effect text with {direction} lettering",
        "title": (
            f"Ornate stylized Japanese manga title logo with {direction} lettering "
            "and a clean decorative frame"
        ),
        "caption_tag": f"Clean {direction} Chinese caption tag text",
    }
    bubbles = {
        "speech": "a white speech bubble",
        "shout": "a jagged shout bubble",
        "thought": "a cloud-shaped thought bubble",
        "box": "a rectangular narration box",
    }
    caption = kinds.get(text.kind, kinds["dialogue"])
    if text.bubble != "none":
        caption += f" in {bubbles.get(text.bubble, 'a white speech bubble')}"
    panel = next((panel for panel in page.panels if panel.id == text.panel_id), None)
    if panel:
        caption += f" in the {panel_location(panel, page).lower()}"
    if text.speaker_id:
        caption += f" next to {character_caption(text.speaker_id, characters)}"
    if text.style_hint:
        caption += f", {text.style_hint}"
    return caption + "."


def size_check_report(page: Page, target: tuple[int, int]) -> dict[str, Any]:
    return {
        "canvas": [page.canvas_width, page.canvas_height],
        "target": list(target),
        "matches": (page.canvas_width, page.canvas_height) == target,
    }


def compile_page(  # noqa: C901 -- ordered object, overlay and text emission
    page: Page,
    characters: Mapping[str, Character] | Iterable[Character] | None = None,
    *,
    size_check: tuple[int, int] | None = None,
    with_ids: bool = False,
    slant_mode: str = "cut",
) -> dict[str, Any]:
    """Return only the MOSS contract. Size diagnostics belong to CLI/maps."""
    _validate_slant_mode(slant_mode)
    # Retain the public argument for clients; diagnostics never enter the prompt.
    del size_check
    character_map = _character_map(characters)
    color = (
        "full-color 2D anime digital painting"
        if page.color_mode == "color"
        else "black-and-white 2D manga with screentone shading"
    )
    shading = (
        "soft cel shading with gentle painterly highlights, warm daylight, a fresh pastel palette"
        if page.color_mode == "color"
        else "delicate screentone shading, strong ink silhouettes, balanced white negative space"
    )
    default_style = (
        f"High-taste {color} comic page, crisp clean line art, {shading}, "
        "expressive faces, gentle lighting, zero rough sketch lines."
    )
    direction = "left to right" if page.reading_direction == "ltr" else "right to left"
    texts = layout_texts(page) if page.dialogue_mode == "moss_text" else []
    caption = "; ".join(
        part
        for part in (
            page.style_prompt or default_style,
            page.style_prefix,
            page.description,
            ", ".join(page.tags),
            f"Japanese manga layout read {direction}, clean white gutters",
            "crisp Chinese comic text in clean speech bubbles and narration boxes"
            if texts
            else "no text, no speech bubbles",
        )
        if part
    )
    if slant_mode == "hint" and any(panel.shape_type == "quad" for panel in page.panels):
        caption += "; panels separated by slanted dividing lines"
    result: dict[str, Any] = {
        "summary": {
            "meta": ["comic", "multi_panel"] + (["digital_painting"] if page.color_mode == "color" else []),
            "canvas": "multi_panel",
            "caption": caption,
        },
        "items": [],
        "bbox_coord_space": "abs_centralized",
        "bbox_format": "yxyx",
    }
    items = result["items"]
    overlays = sorted(
        (overlay for overlay in page.overlays if overlay.mode == "moss"), key=lambda overlay: overlay.z_index
    )
    for panel in sorted(page.panels, key=lambda panel: panel.order):
        object_caption = _panel_caption(panel, page, character_map)
        if slant_mode == "hint" and panel.shape_type == "quad":
            object_caption += ", slanted panel"
        item = {
            "label": "object",
            "caption": object_caption,
            "bbox": _integer_bbox(_compiled_shape(panel, slant_mode), page, inward=slant_mode == "hint"),
        }
        if with_ids:
            item["panel_id"] = panel.id
        items.append(item)
        for overlay in overlays:
            if overlay.panel_id == panel.id:
                items.append(_overlay_item(overlay, page, character_map, with_ids=with_ids))
    for overlay in overlays:
        if overlay.panel_id is None or not any(panel.id == overlay.panel_id for panel in page.panels):
            items.append(_overlay_item(overlay, page, character_map, with_ids=with_ids))
    _validate_cut_regions(page, slant_mode, [item["bbox"] for item in items if item["label"] == "object"])
    for text in texts:
        item = {
            "label": "text",
            "caption": _text_caption(text, page, character_map),
            "text": text.text,
            "bbox": _integer_bbox(text.bbox, page, inward=slant_mode == "hint"),
        }
        if with_ids:
            item.update(text_id=text.id, panel_id=text.panel_id, speaker_id=text.speaker_id)
        items.append(item)
    return result


def _overlay_item(
    overlay: Overlay, page: Page, characters: Mapping[str, Character], *, with_ids: bool
) -> dict[str, Any]:
    item = {
        "label": "character",
        "caption": (
            "Main center character focus breaking across the middle panels: "
            f"{character_caption(overlay.character_id, characters)}, {overlay.description}"
        ),
        "bbox": _integer_bbox(overlay.rect, page),
    }
    if with_ids:
        item.update(overlay_id=overlay.id, character_id=overlay.character_id)
    return item


__all__ = ["compile_geometry_map", "compile_page"]
