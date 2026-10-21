"""Shared text conversion, measurement and placement for compiler and preview."""

from __future__ import annotations

import re
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


# Unicode vertical presentation forms keep punctuation upright in both renderers.
VERTICAL_FORMS = str.maketrans("…—，。！？「」『』（）：；", "︙︱︐︒︕︖﹁﹂﹃﹄︵︶︓︔")  # noqa: RUF001 -- source punctuation
BREAK_AFTER = frozenset("︐︒︕︖﹂﹄︶︓︔")


def vertical_columns(text: str, limit: int) -> list[list[str]]:
    """Balance each explicit column; ASCII runs occupy one horizontal cell."""
    result = []
    limit = max(1, limit)
    for line in text.translate(VERTICAL_FORMS).split("\n"):
        cells = re.findall(r"[A-Za-z0-9]+|[^A-Za-z0-9]", line)
        count = max(1, ceil(len(cells) / limit))
        target = len(cells) / count
        # Dynamic programming balances columns while preferring punctuation breaks.
        states: dict[int, tuple[float, list[list[str]]]] = {0: (0, [])}
        for column in range(count):
            following: dict[int, tuple[float, list[list[str]]]] = {}
            for start, (cost, parts) in states.items():
                for end in range(start + 1, min(len(cells), start + limit) + 1):
                    remaining = len(cells) - end
                    if not count - column - 1 <= remaining <= (count - column - 1) * limit:
                        continue
                    penalty = (end - start - target) ** 2
                    if end < len(cells):
                        penalty += 0 if cells[end - 1] in BREAK_AFTER else 2
                        penalty += 4 if cells[end] in BREAK_AFTER else 0
                    score = cost + penalty
                    if end not in following or score < following[end][0]:
                        following[end] = (score, [*parts, cells[start:end]])
            states = following
        result.extend(states[len(cells)][1] if cells else [[]])
    return result


def estimate_text_size(text: Text, page: Page) -> tuple[float, float]:
    size = max(1, page.text_font_size) * page.canvas_width / 1024
    vertical = (text.direction or page.text_direction) == "vertical"
    lines = (
        vertical_columns(text.text, page.text_max_chars)
        if vertical
        else text_lines(text.text, page.text_max_chars)
    )
    cross = len(lines) * size * 1.3
    along = max(1, *map(len, lines)) * size * 1.15
    return (cross, along) if vertical else (along, cross)


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
