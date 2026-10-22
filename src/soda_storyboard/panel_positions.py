"""Geometry-only panel phrases, kept outside translation source hashes."""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import Page, Panel

# ruff: noqa: PLR2004 -- bilingual geometry thresholds are part of the public contract.


def _ordinal(index: int, language: str) -> str:
    words = ("first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth")
    return (words[index - 1] if index <= len(words) else f"{index}th") if language == "en" else f"第{index}个"


def _phrase(panel: Panel, page: Page, language: str, side: str | None = None) -> str:
    x, y, width, height = panel.bbox
    # Equal fifths of canvas height; horizontal thirds, with an inclusive 80% span.
    band = min(4, max(0, int((y + height / 2) / page.height * 5)))
    center = (x + width / 2) / page.width
    side = side or (
        "full-width"
        if width >= page.width * 0.8
        else "left"
        if center < 1 / 3
        else "right"
        if center > 2 / 3
        else "center"
    )
    ratio = width / max(height, 0.001)
    shape = "horizontal" if ratio > 1.3 else "vertical" if ratio < 0.77 else "square"
    slanted = panel.shape_type == "quad"
    if language == "en":
        vertical = ("Top", "Upper", "Middle", "Lower", "Bottom")[band]
        location = f"{vertical} {side}" if side == "full-width" else f"{vertical}-{side}"
        return f"{location} {shape}{' slanted' if slanted else ''} panel"
    locations = {
        "left": ("左上", "左偏上", "中左", "左偏下", "左下"),
        "center": ("顶部居中", "上部居中", "正中", "下部居中", "底部居中"),
        "right": ("右上", "右偏上", "中右", "右偏下", "右下"),
        "full-width": ("顶部满宽", "上部满宽", "中部满宽", "下部满宽", "底部满宽"),
    }
    form = (
        {"horizontal": "横向斜", "vertical": "竖向斜", "square": "方形斜"}
        if slanted
        else {"horizontal": "横", "vertical": "竖", "square": "方"}
    )[shape]
    return f"{locations[side][band]}{form}格"


def panel_positions(page: Page, language: str = "en") -> dict[str, str]:
    """Return unique phrases; collisions refine left/center/right, then reading order."""
    phrases = {panel.id: _phrase(panel, page, language) for panel in page.panels}
    groups: dict[str, list[Panel]] = defaultdict(list)
    for panel in page.panels:
        groups[phrases[panel.id]].append(panel)
    for group in groups.values():
        if len(group) < 2:
            continue
        centers = sorted({panel.bbox[0] + panel.bbox[2] / 2 for panel in group})
        if len(centers) > 1 and not all(panel.bbox[2] >= page.width * 0.8 for panel in group):
            for panel in group:
                center = panel.bbox[0] + panel.bbox[2] / 2
                side = "left" if center == centers[0] else "right" if center == centers[-1] else "center"
                phrases[panel.id] = _phrase(panel, page, language, side)
    groups.clear()
    for panel in page.panels:
        groups[phrases[panel.id]].append(panel)
    # Sort by the stored reading order, independent of array order and language.
    for group in groups.values():
        if len(group) > 1:
            for index, panel in enumerate(sorted(group, key=lambda item: (item.order, item.id)), 1):
                phrases[panel.id] = f"{_ordinal(index, language)} {phrases[panel.id]}".strip()
    return phrases
