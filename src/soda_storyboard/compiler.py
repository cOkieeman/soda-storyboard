"""Compile storyboard pages into the MOSS-Image layout JSON contract."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from itertools import combinations
from math import ceil, floor
from typing import TYPE_CHECKING, Any

from .captions import (
    character_caption,
    custom_caption_enabled,
    panel_caption,
    translation_state,
)
from .captions import (
    figure_caption as _figure_caption,
)
from .figure_semantics import figure_page_box
from .figures import panel_figures
from .geometry import inscribed_rect, midline_rect, panel_to_moss_bbox, shape_bbox
from .lettering import layout_texts
from .models import shape_to_dict
from .moss_roundtrip import imported_result

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
SHOT_PHRASES_ZH = {
    "extreme_long": "大远景",
    "long": "远景",
    "full": "全景",
    "medium": "中景",
    "close_up": "特写",
    "extreme_close_up": "大特写",
}
ANGLE_PHRASES_ZH = {
    "eye": "平视",
    "high": "俯视",
    "low": "仰视",
    "bird": "鸟瞰",
    "worm": "贴地仰视",
    "dutch": "倾斜视角",
}


def _character_map(characters: Mapping[str, Character] | Iterable[Character] | None) -> dict[str, Character]:
    if characters is None:
        return {}
    if isinstance(characters, Mapping):
        return {str(key): value for key, value in characters.items()}
    return {character.id: character for character in characters}


def panel_location(panel: Panel, page: Page) -> str:
    x, y, x2, y2 = shape_bbox(panel.shape)
    cy = (y + y2) / 2 / page.canvas_height
    row = "Top" if cy < TOP_ROW_LIMIT else "Bottom" if cy > BOTTOM_ROW_START else "Middle"
    if x2 - x > page.canvas_width * 0.75:
        return f"{row} wide panel"
    side = "right" if (x + x2) / 2 > page.canvas_width / 2 else "left"
    size = " small vertical" if y2 - y > (x2 - x) * 1.5 else ""
    return f"{row}-{side}{size} panel"


def _integer_bbox(shape: Shape, page: Page, *, inward: bool = False) -> list[int]:
    # Nearest rounding sends half pixels toward +infinity. Quantize the canvas
    # edges the same way, so an odd width of 101 spans [-50, 51], preserving
    # all 101 pixels. Hint mode instead keeps both ends inside the true edges.
    lower = [-(page.canvas_height // 2), -(page.canvas_width // 2)] * 2
    upper = [size // 2 if inward else (size + 1) // 2 for size in (page.canvas_height, page.canvas_width)] * 2
    values = panel_to_moss_bbox(shape, page.canvas_width, page.canvas_height)
    rounded = (
        [ceil(v - 1e-8) if i < len(values) // 2 else floor(v + 1e-8) for i, v in enumerate(values)]
        if inward
        else [floor(v + 0.5) for v in values]
    )
    result = [max(lo, min(hi, value)) for value, lo, hi in zip(rounded, lower, upper, strict=True)]
    if result[0] >= result[2] or result[1] >= result[3]:
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
            "shape": _pixel_shape(shape_to_dict(panel.shape)),
            "generation_rect": dict(
                zip(("x", "y", "x2", "y2"), (floor(v + 0.5) for v in shape_bbox(region)), strict=True)
            ),
            "bbox": _integer_bbox(region, page, inward=slant_mode == "hint"),
        }
        if panel.shape_type == "quad":
            entry["quad"] = _pixel_shape(shape_to_dict(panel.shape))["points"]
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
        "overlays": [_pixel_entry(overlay.to_dict()) for overlay in page.overlays],
        "texts": [_pixel_entry(text.to_dict()) for text in layout_texts(page)],
        **({"size_check": size_check_report(page, size_check)} if size_check is not None else {}),
    }


def _pixel_shape(shape: dict[str, Any]) -> dict[str, Any]:
    if shape.get("type") == "quad":
        return {**shape, "points": [[floor(v + 0.5) for v in point] for point in shape["points"]]}
    return {
        key: floor(value + 0.5) if key in {"x", "y", "w", "h", "width", "height"} else value
        for key, value in shape.items()
    }


def _pixel_entry(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        key: _pixel_shape(value) if key in {"bbox", "rect"} and isinstance(value, dict) else value
        for key, value in entry.items()
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
        speaker = characters.get(text.speaker_id)
        caption += f" next to {(speaker.role_en or speaker.display_name) if speaker else text.speaker_id}"
    if text.style_hint:
        caption += f", {text.style_hint}"
    return caption + "."


def size_check_report(page: Page, target: tuple[int, int]) -> dict[str, Any]:
    return {
        "canvas": [page.canvas_width, page.canvas_height],
        "target": list(target),
        "matches": (page.canvas_width, page.canvas_height) == target,
    }


def _figure_items(
    panel: Panel, page: Page, characters: Mapping[str, Character], language: str, *, with_ids: bool
) -> list[dict[str, Any]]:
    items = []
    for index, figure in enumerate(panel_figures(panel, page)):
        x, y, right, bottom = figure_page_box(figure, panel)
        if right <= x or bottom <= y:
            continue
        bbox = _integer_bbox({"type": "rect", "x": x, "y": y, "w": right - x, "h": bottom - y}, page)
        if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
            continue
        item = {
            "label": "character",
            "caption": _figure_caption(figure, characters, language, panel.shot),
            "bbox": bbox,
        }
        if with_ids:
            item.update(panel_id=panel.id, character_id=figure.character_id, figure_index=index)
        items.append(item)
    return items


def _object_items(page: Page, *, with_ids: bool) -> list[dict]:
    result = []
    for box in page.objects:
        item = {"label": box.label, "caption": box.caption, "bbox": _integer_bbox(box.rect, page)}
        if with_ids:
            item.update(object_id=box.id, panel_id=box.panel_id)
        result.append(item)
    return result


def compile_page(  # noqa: C901, PLR0913 -- ordered emission and optional compilation settings
    page: Page,
    characters: Mapping[str, Character] | Iterable[Character] | None = None,
    *,
    size_check: tuple[int, int] | None = None,
    with_ids: bool = False,
    slant_mode: str = "cut",
    caption_language: str | None = None,
) -> dict[str, Any]:
    """Return only the MOSS contract. Size diagnostics belong to CLI/maps."""
    _validate_slant_mode(slant_mode)
    requested_ids = with_ids
    if page.extra.get("moss_import"):
        with_ids = True
    caption_language = caption_language or page.caption_language or "en"
    if caption_language not in {"zh", "en"}:
        message = "caption_language must be zh or en"
        raise ValueError(message)
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
    single_canvas = page.extra.get("canvas_mode") == "single"
    direction = "left to right" if page.reading_direction == "ltr" else "right to left"
    texts = layout_texts(page) if page.dialogue_mode == "moss_text" else []
    caption = "; ".join(
        part
        for part in (
            page.style_prompt or default_style,
            page.style_prefix,
            page.description,
            ", ".join(page.tags),
            "Single canvas composition"
            if single_canvas
            else f"Japanese manga layout read {direction}, clean white gutters",
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
            "meta": ["comic", "single_canvas" if single_canvas else "multi_panel"]
            + (["digital_painting"] if page.color_mode == "color" else []),
            "canvas": "single_canvas" if single_canvas else "multi_panel",
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
        object_caption = panel_caption(panel, page, character_map, caption_language)
        item = {
            "label": "object",
            "caption": object_caption,
            "bbox": _integer_bbox(_compiled_shape(panel, slant_mode), page, inward=slant_mode == "hint"),
        }
        if with_ids:
            item["panel_id"] = panel.id
        items.append(item)
        figure_language = (
            "en"
            if caption_language == "en"
            and (
                custom_caption_enabled(panel, page)
                or translation_state(panel, page, character_map) == "fresh"
            )
            else "zh"
        )
        items.extend(_figure_items(panel, page, character_map, figure_language, with_ids=with_ids))
        for overlay in overlays:
            if overlay.panel_id == panel.id:
                items.append(
                    _overlay_item(overlay, page, character_map, with_ids=with_ids, language=caption_language)
                )
    for overlay in overlays:
        if overlay.panel_id is None or not any(panel.id == overlay.panel_id for panel in page.panels):
            items.append(
                _overlay_item(overlay, page, character_map, with_ids=with_ids, language=caption_language)
            )
    _validate_cut_regions(page, slant_mode, [item["bbox"] for item in items if item["label"] == "object"])
    items.extend(_object_items(page, with_ids=with_ids))
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
    return imported_result(page, result, with_ids=requested_ids)


def _overlay_item(
    overlay: Overlay, page: Page, characters: Mapping[str, Character], *, with_ids: bool, language: str
) -> dict[str, Any]:
    item = {
        "label": "character",
        "caption": (
            "Main center character focus breaking across the middle panels: "
            f"{character_caption(overlay.character_id, characters, language)}, {overlay.description}"
        ),
        "bbox": _integer_bbox(overlay.rect, page),
    }
    if with_ids:
        item.update(overlay_id=overlay.id, character_id=overlay.character_id)
    return item


__all__ = ["compile_geometry_map", "compile_page", "custom_caption_enabled", "panel_caption"]
