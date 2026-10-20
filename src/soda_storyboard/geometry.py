"""Geometry helpers shared by validation, compilation, and preview."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


def _point_list(shape: Any) -> list[tuple[float, float]]:
    raw = (
        shape.get("points", shape.get("corners", shape.get("vertices", [])))
        if isinstance(shape, Mapping)
        else getattr(shape, "points", [])
    )
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes, bytearray)):
        return []
    points: list[tuple[float, float]] = []
    for point in raw:
        if isinstance(point, Mapping):
            x, y = point.get("x"), point.get("y")
        elif isinstance(point, Sequence) and len(point) >= 2:
            x, y = point[0], point[1]
        else:
            x, y = getattr(point, "x", None), getattr(point, "y", None)
        if x is not None and y is not None:
            points.append((float(x), float(y)))
    return points


def shape_bbox(shape: Any) -> tuple[float, float, float, float]:
    """Return ``(x_min, y_min, x_max, y_max)`` for a panel shape."""

    if isinstance(shape, Mapping):
        x = shape.get("x")
        y = shape.get("y")
        w = shape.get("w", shape.get("width"))
        h = shape.get("h", shape.get("height"))
    else:
        x, y = getattr(shape, "x", None), getattr(shape, "y", None)
        w = getattr(shape, "w", getattr(shape, "width", None))
        h = getattr(shape, "h", getattr(shape, "height", None))
    if None not in (x, y, w, h):
        x1, y1 = float(x), float(y)
        x2, y2 = x1 + float(w), y1 + float(h)
        return min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)
    points = _point_list(shape)
    if not points:
        return 0.0, 0.0, 0.0, 0.0
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return min(xs), min(ys), max(xs), max(ys)


def quad_bbox(points: Any) -> tuple[float, float, float, float]:
    """Return the axis-aligned bbox for a quad point list."""

    return shape_bbox({"type": "quad", "points": points})


def bbox_xywh(shape: Any) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = shape_bbox(shape)
    return x1, y1, max(0.0, x2 - x1), max(0.0, y2 - y1)


def bbox_overlap(first: tuple[float, float, float, float], second: tuple[float, float, float, float]) -> bool:
    """Return whether two ``(x, y, w, h)`` boxes have positive-area overlap."""

    x1, y1, w1, h1 = first
    x2, y2, w2, h2 = second
    return min(x1 + w1, x2 + w2) > max(x1, x2) and min(y1 + h1, y2 + h2) > max(y1, y2)


def panel_to_moss_bbox(shape: Any, canvas_width: float, canvas_height: float) -> list[float]:
    """Convert a top-left-origin shape to centered MOSS ``[y1, x1, y2, x2]``."""

    x1, y1, x2, y2 = shape_bbox(shape)
    return [y1 - canvas_height / 2, x1 - canvas_width / 2, y2 - canvas_height / 2, x2 - canvas_width / 2]


def to_moss_bbox(
    page_bbox: tuple[float, float, float, float], canvas_width: float, canvas_height: float
) -> list[float]:
    """Convert an ``(x_min, y_min, x_max, y_max)`` page box to MOSS."""

    x1, y1, x2, y2 = page_bbox
    return [y1 - canvas_height / 2, x1 - canvas_width / 2, y2 - canvas_height / 2, x2 - canvas_width / 2]


def from_moss_bbox(
    moss_bbox: list[float] | tuple[float, float, float, float], canvas_width: float, canvas_height: float
) -> tuple[float, float, float, float]:
    """Convert a centered MOSS ``[y1, x1, y2, x2]`` box to page coordinates."""

    y1, x1, y2, x2 = (float(value) for value in moss_bbox[:4])
    return x1 + canvas_width / 2, y1 + canvas_height / 2, x2 + canvas_width / 2, y2 + canvas_height / 2


__all__ = [
    "bbox_overlap",
    "bbox_xywh",
    "from_moss_bbox",
    "panel_to_moss_bbox",
    "quad_bbox",
    "shape_bbox",
    "to_moss_bbox",
]
