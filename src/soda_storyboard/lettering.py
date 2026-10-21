"""Shared text conversion, measurement and placement for compiler and preview."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import replace
from math import ceil
from typing import TYPE_CHECKING

from .geometry import inscribed_rect, shape_bbox
from .models import RectShape, Text

if TYPE_CHECKING:
    from .models import Page


def page_texts(page: Page) -> list[Text]:
    """Adapt legacy dialogue/sfx without mutating the source page."""
    texts = list(page.texts)
    for panel in sorted(page.panels, key=lambda panel: panel.order):
        for index, dialogue in enumerate(panel.dialogue):
            texts.append(
                Text(
                    id=f"{panel.id}-dialogue-{index + 1}",
                    text=dialogue.text,
                    kind="narration" if dialogue.bubble == "narration" else "dialogue",
                    panel_id=panel.id,
                    speaker_id=dialogue.speaker_id,
                    bubble="box" if dialogue.bubble == "narration" else dialogue.bubble,
                    extra={"position": dialogue.position},
                )
            )
        for index, text in enumerate(panel.sfx):
            texts.append(
                Text(
                    id=f"{panel.id}-sfx-{index + 1}",
                    text=text,
                    kind="sfx",
                    panel_id=panel.id,
                    bubble="none",
                    direction="horizontal",
                )
            )
    return [text for text in texts if text.text.strip()]


def text_lines(text: str, limit: int) -> list[str]:
    """Newlines delimit columns vertically and rows horizontally."""
    limit = max(1, limit)
    return [
        line[start : start + limit]
        for line in text.split("\n")
        for start in range(0, max(1, len(line)), limit)
    ]


def estimate_text_size(text: Text, page: Page) -> tuple[float, float]:
    size = max(1, page.text_font_size) * page.canvas_width / 1024
    lines = text_lines(text.text, page.text_max_chars)
    cross = len(lines) * size * 1.3
    along = max(1, *map(len, lines)) * size * 1.15
    return (cross, along) if (text.direction or page.text_direction) == "vertical" else (along, cross)


def layout_texts(page: Page) -> list[Text]:
    """Return lettering with resolved bboxes, preserving explicit rectangles."""
    panels = {panel.id: panel for panel in page.panels}
    counts: dict[str | None, int] = defaultdict(int)
    result = []
    for text in page_texts(page):
        index = counts[text.panel_id]
        counts[text.panel_id] += 1
        if text.bbox is not None:
            result.append(text)
            continue
        panel = panels.get(text.panel_id)
        shape = (
            inscribed_rect(panel.shape)
            if panel and panel.shape_type == "quad"
            else panel.shape
            if panel
            else None
        )
        x, y, x2, y2 = shape_bbox(shape) if shape else (0, 0, page.canvas_width, page.canvas_height)
        margin = min(12, (x2 - x) * 0.04, (y2 - y) * 0.04)
        width, height = estimate_text_size(text, page)
        factor = min(1, max(1, x2 - x - margin * 2) / width, max(1, y2 - y - margin * 2) / height)
        width, height = ceil(width * factor), ceil(height * factor)
        position = str(text.extra.get("position") or "")
        on_right = position in {"right", "upper_right", "top_right"} or (
            position not in {"left", "upper_left", "top_left"}
            and (index % 2 == 0) == (page.reading_direction == "rtl")
        )
        left = x2 - margin - width if on_right else x + margin
        top = y + margin + min(index // 2 * (height + margin), max(0, y2 - y - height - 2 * margin))
        result.append(replace(text, bbox=RectShape(left, top, width, height)))
    return result
