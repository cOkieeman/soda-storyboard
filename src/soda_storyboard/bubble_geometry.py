"""Deterministic shout outlines and safe, centered text layout shared by renderers."""

from __future__ import annotations

import math
from dataclasses import dataclass

from .lettering import text_lines, vertical_columns


def _spike_depth(width: float, height: float) -> float:
    return min(min(width, height) * 0.15, max(4, min(10, min(width, height) * 0.075)))


def shout_bubble_points(
    width: float,
    height: float,
    border_width: float = 2,
    tail_tip: tuple[float, float] | None = None,
) -> list[tuple[float, float]]:
    """Space short teeth by arc length, rather than stretching an angular star."""
    cx, cy = width / 2, height / 2
    rx, ry = max(0.5, (width - border_width) / 2), max(0.5, (height - border_width) / 2)
    depth = _spike_depth(width, height)
    sample_count = 360
    samples = [(0.0, -math.pi / 2)]
    length = 0.0
    for index in range(1, sample_count + 1):
        angle = -math.pi / 2 + index * math.tau / sample_count
        previous = samples[index - 1][1]
        length += math.hypot(
            rx * (math.cos(angle) - math.cos(previous)), ry * (math.sin(angle) - math.sin(previous))
        )
        samples.append((length, angle))
    count = max(10, min(28, math.floor(length / 76 + 0.5) * 2))
    cursor = 1
    points = []
    for index in range(count * 2):
        target = index * length / (count * 2)
        while cursor < sample_count and samples[cursor][0] < target:
            cursor += 1
        a, b = samples[cursor - 1], samples[cursor]
        angle = a[1] + (b[1] - a[1]) * (target - a[0]) / (b[0] - a[0])
        x, y = cx + rx * math.cos(angle), cy + ry * math.sin(angle)
        if index % 2:
            nx, ny = math.cos(angle) / rx, math.sin(angle) / ry
            normal = math.hypot(nx, ny)
            x, y = x - nx / normal * depth, y - ny / normal * depth
        points.append((x, y))
    if tail_tip and ((tail_tip[0] - cx) / rx) ** 2 + ((tail_tip[1] - cy) / ry) ** 2 > 1:
        nearest = min(range(0, len(points), 2), key=lambda index: math.dist(points[index], tail_tip))
        x, y = points[nearest]
        distance = math.dist((x, y), tail_tip)
        extension = min(distance, 40, min(width, height) * 0.25)
        points[nearest] = (
            x + (tail_tip[0] - x) / distance * extension,
            y + (tail_tip[1] - y) / distance * extension,
        )
    return points


@dataclass
class ShoutTextLayout:
    area: tuple[float, float, float, float]
    font_size: int
    columns: list[list[str]]
    lines: list[str]
    cell_width: float
    cell_height: float
    content_x: float
    content_y: float


def layout_shout_text(
    width: float,
    height: float,
    text: str,
    direction: str,
    requested_size: float,
) -> ShoutTextLayout:
    """Keep the editor, sketch preview and final lettering on the same text grid."""
    depth = _spike_depth(width, height)
    usable_w, usable_h = max(1, (width - depth * 2 - 4) * 0.68), max(1, (height - depth * 2 - 4) * 0.68)
    area = ((width - usable_w) / 2, (height - usable_h) / 2, usable_w, usable_h)
    columns: list[list[str]] = []
    lines: list[str] = []
    initial_size = max(1, min(512, math.floor(requested_size or 20)))
    for size in range(initial_size, 0, -1):
        if direction == "vertical":
            columns = vertical_columns(text, max(1, math.floor(usable_h / (size * 1.22))))
            if len(columns) * size * 1.2 <= usable_w:
                break
        else:
            lines = text_lines(text, max(1, math.floor(usable_w / size)))
            if len(lines) * size * 1.25 <= usable_h:
                break
    cell_w, cell_h = size * 1.2, size * (1.22 if direction == "vertical" else 1.25)
    content_w = len(columns) * cell_w if direction == "vertical" else usable_w
    content_h = (max(1, *map(len, columns)) if direction == "vertical" else len(lines)) * cell_h
    return ShoutTextLayout(
        area, size, columns, lines, cell_w, cell_h, (width - content_w) / 2, (height - content_h) / 2
    )
