"""Detect colour-coded frame rules; no OCR and no semantic image model."""

from __future__ import annotations

from itertools import combinations
from typing import TYPE_CHECKING

from PIL import Image

if TYPE_CHECKING:
    from collections.abc import Callable

# ruff: noqa: PLR2004 -- pixel/hue and line-support thresholds.


def color_masks(image: Image.Image) -> dict[str, Image.Image]:
    channels = {key: bytearray() for key in ("cyan", "green", "red")}
    data = image.convert("RGB").tobytes()
    for r, g, b in zip(data[::3], data[1::3], data[2::3], strict=True):
        channels["cyan"].append(
            255 if g > 140 and b > 140 and abs(g - b) < 55 and r < min(g, b) * 0.75 else 0
        )
        channels["green"].append(255 if g > 120 and g > r * 1.25 and g > b * 1.15 else 0)
        channels["red"].append(255 if r > 130 and r > g * 1.6 and r > b * 1.6 else 0)
    return {key: Image.frombytes("L", image.size, bytes(data)) for key, data in channels.items()}


def _runs(mask: Image.Image, *, vertical: bool = False) -> list[tuple[int, int, int]]:
    if vertical:
        mask = mask.transpose(Image.Transpose.TRANSPOSE)
    width, height = mask.size
    data = mask.tobytes()
    segments = []
    minimum = max(32 if vertical else 10, round(min(mask.size) * (0.035 if vertical else 0.012)))
    for y in range(height):
        start, last = None, 0
        for x in range(width + 3):
            hit = x < width and data[y * width + x]
            if hit:
                if start is None:
                    start = x
                last = x
            elif start is not None and x - last > 2:
                if last - start >= minimum:
                    segments.append((y, start, last))
                start = None
    kept = []
    for segment in sorted(segments, key=lambda row: row[2] - row[1], reverse=True):
        if not any(
            abs(segment[0] - other[0]) <= 3
            and min(segment[2], other[2]) - max(segment[1], other[1]) >= 0.8 * (segment[2] - segment[1])
            for other in kept
        ):
            kept.append(segment)
    return kept


def _support(segments: list[tuple[int, int, int]], coordinate: int, start: int, end: int) -> float:
    intervals = sorted(
        (max(start, a), min(end, b))
        for position, a, b in segments
        if abs(position - coordinate) <= 3 and b > start and a < end
    )
    covered, previous = 0, start
    for a, b in intervals:
        covered += max(0, b - max(a, previous))
        previous = max(previous, b)
    return covered / max(1, end - start)


def color_rectangles(mask: Image.Image, *, outer: bool = False) -> list[dict]:
    horizontal, vertical = _runs(mask), _runs(mask, vertical=True)
    xs = sorted({row[0] for row in vertical})
    candidates = []
    for left, right in combinations(xs, 2):
        if right - left < 12:
            continue
        # Only rules spanning most of these side coordinates can be top/bottom
        # edges. This excludes thousands of short glyph/figure strokes.
        ys = sorted(
            {
                position
                for position, start, end in horizontal
                if end - start >= (right - left) * 0.3
                and start <= left + (right - left) * 0.7
                and end >= right - (right - left) * 0.7
            }
        )
        horizontal_edges = [y for y in ys if _support(horizontal, y, left, right) >= 0.4]
        for top, bottom in combinations(horizontal_edges, 2):
            if bottom - top < 24:
                continue
            corner_span = max(12, (bottom - top) * 0.05)
            sides = [
                segment for segment in vertical if min(abs(segment[0] - left), abs(segment[0] - right)) <= 3
            ]
            if not any(start <= top + 4 and end >= top + corner_span for _, start, end in sides):
                continue
            if not any(end >= bottom - 4 and start <= bottom - corner_span for _, start, end in sides):
                continue
            edges = [_support(horizontal, y, left, right) for y in (top, bottom)] + [
                _support(vertical, x, top, bottom) for x in (left, right)
            ]
            if min(edges) >= 0.4 and sum(edges) / 4 >= 0.7 and sum(edge >= 0.9 for edge in edges) >= 2:
                candidates.append(
                    {
                        "type": "rect",
                        "x": left,
                        "y": top,
                        "w": right - left,
                        "h": bottom - top,
                        "confidence": round(min(edges), 3),
                    }
                )
    result = []
    for box in sorted(candidates, key=lambda box: box["w"] * box["h"], reverse=outer):
        # Adjacent parallel antialiased ridges describe the same rectangle.
        if not any(
            _overlap(box, other) > 0.65 and (outer or box["w"] * box["h"] < other["w"] * other["h"] * 3)
            for other in result
        ):
            result.append(box)
    return result if outer else [box for box in result if not _spans_faces(box, result)]


def _spans_faces(box: dict, boxes: list[dict]) -> bool:
    children = [
        other
        for other in boxes
        if other is not box
        and box["x"] <= other["x"] + 4
        and box["y"] <= other["y"] + 4
        and box["x"] + box["w"] >= other["x"] + other["w"] - 4
        and box["y"] + box["h"] >= other["y"] + other["h"] - 4
    ]
    return any(
        _overlap(a, b) < 0.1 and a["w"] * a["h"] + b["w"] * b["h"] > box["w"] * box["h"] * 0.5
        for a, b in combinations(children, 2)
    )


def _overlap(a: dict, b: dict) -> float:
    area = max(0, min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"])) * max(
        0, min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"])
    )
    return area / max(1, min(a["w"] * a["h"], b["w"] * b["h"]))


def extract_colors(image: Image.Image, order: Callable) -> dict | None:
    reduced = image.convert("RGB")
    reduced.thumbnail((1024, 1536), Image.Resampling.LANCZOS)
    masks = color_masks(reduced)
    cyan = color_rectangles(masks["cyan"])
    if not cyan:
        return None
    sx, sy = image.width / reduced.width, image.height / reduced.height

    def scaled(box: dict) -> dict:
        return {
            "type": "rect",
            "x": round(box["x"] * sx, 2),
            "y": round(box["y"] * sy, 2),
            "w": round(box["w"] * sx, 2),
            "h": round(box["h"] * sy, 2),
        }

    panels = [
        {"shape": scaled(box), "confidence": min(0.95, box["confidence"]), "color": "cyan"}
        for box in cyan
        if box["w"] * box["h"] > reduced.width * reduced.height * 0.015
    ]
    texts = [
        {"bbox": scaled(box), "text": "", "kind": "narration", "color": "green"}
        for box in color_rectangles(masks["green"])
    ]
    titles, protagonists = [], []
    for box in color_rectangles(masks["red"], outer=True):
        if box["w"] * box["h"] > reduced.width * reduced.height * 0.12 and box["h"] > reduced.height * 0.35:
            protagonists.append(
                {"shape": scaled(box), "confidence": 0.85, "color": "red", "role": "protagonist"}
            )
        elif box["w"] / box["h"] > 2 and box["y"] < reduced.height * 0.2:
            titles.append({"bbox": scaled(box), "text": "", "kind": "title", "color": "red"})
        elif box["w"] >= reduced.width * 0.035:
            texts.append({"bbox": scaled(box), "text": "", "kind": "caption_tag", "color": "red"})
    return {
        "panels": order(panels + protagonists),
        "texts": texts,
        "titles": titles,
        "cyan_panel_count": len(panels),
        "protagonist_count": len(protagonists),
        "mode": "color",
    }
