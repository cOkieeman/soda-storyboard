"""Geometry helpers shared by validation, compilation, and preview."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from itertools import combinations, pairwise
from math import cos, hypot, isfinite, radians, tan
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


def shape_polygon(shape: Any) -> list[tuple[float, float]]:
    points = _point_list(shape)
    if points:
        return points
    x1, y1, x2, y2 = shape_bbox(shape)
    return [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]


def polygon_area(points: Sequence[tuple[float, float]]) -> float:
    return sum(a[0] * b[1] - a[1] * b[0] for a, b in zip(points, [*points[1:], points[0]], strict=True)) / 2


def convex_polygon(shape: Any) -> list[tuple[float, float]]:
    points = shape_polygon(shape)
    if len(points) != 4:
        message = "A panel must have exactly four perimeter-ordered vertices"
        raise ValueError(message)
    crosses = []
    for index, a in enumerate(points):
        b, c = points[(index + 1) % len(points)], points[(index + 2) % len(points)]
        crosses.append((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]))
    if not (all(c > 1e-9 for c in crosses) or all(c < -1e-9 for c in crosses)):
        message = "Panel must be a nondegenerate convex polygon with perimeter-ordered vertices"
        raise ValueError(message)
    return points if polygon_area(points) > 0 else list(reversed(points))


def polygons_overlap(first: Any, second: Any, *, tolerance: float = 0) -> bool:
    """Positive-area convex polygon overlap using separating axes."""
    a, b = shape_polygon(first), shape_polygon(second)
    for polygon in (a, b):
        for start, end in zip(polygon, [*polygon[1:], polygon[0]], strict=True):
            nx, ny = end[1] - start[1], start[0] - end[0]
            pa, pb = ([x * nx + y * ny for x, y in points] for points in (a, b))
            if min(max(pa), max(pb)) - max(min(pa), min(pb)) <= tolerance * hypot(nx, ny) + 1e-8:
                return False
    return True


def _point_segment_distance(
    point: tuple[float, float], a: tuple[float, float], b: tuple[float, float]
) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    length_squared = dx * dx + dy * dy
    ratio = (
        0.0
        if length_squared == 0
        else max(0.0, min(1.0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length_squared))
    )
    return hypot(point[0] - a[0] - ratio * dx, point[1] - a[1] - ratio * dy)


def shape_distance(first: Any, second: Any) -> float:
    if polygons_overlap(first, second):
        return 0.0
    a, b = shape_polygon(first), shape_polygon(second)
    return min(
        _point_segment_distance(point, start, end)
        for vertices, edges in ((a, b), (b, a))
        for point in vertices
        for start, end in zip(edges, [*edges[1:], edges[0]], strict=True)
    )


def _row_axis(boxes: list[tuple[float, float, float, float]], axis: str) -> str:
    same_height = all(abs(b[1] - boxes[0][1]) < 1e-7 and abs(b[3] - boxes[0][3]) < 1e-7 for b in boxes)
    same_width = all(abs(b[0] - boxes[0][0]) < 1e-7 and abs(b[2] - boxes[0][2]) < 1e-7 for b in boxes)
    if axis in {"auto", "vertical"} and same_height:
        return "vertical"
    if axis in {"auto", "horizontal"} and same_width:
        return "horizontal"
    message = "Select adjacent rectangles sharing one complete row or column"
    raise ValueError(message)


def _skew_row(
    boxes: list[tuple[float, float, float, float]], angle: float, gap: float
) -> list[list[tuple[float, float]]]:
    top, bottom = boxes[0][1], boxes[0][3]
    shift = tan(radians(angle)) * (bottom - top) / 2
    seams = []
    for first, second in pairwise(boxes):
        separation = second[0] - first[2]
        if separation < gap - 1e-7:
            message = "Selected rectangles overlap or do not have the requested gutter"
            raise ValueError(message)
        seams.append(((first[2] + second[0]) / 2, gap / cos(radians(angle)) / 2))
    result = []
    for index, box in enumerate(boxes):
        left = (
            [box[0], box[0]]
            if index == 0
            else [
                seams[index - 1][0] + seams[index - 1][1] - shift,
                seams[index - 1][0] + seams[index - 1][1] + shift,
            ]
        )
        right = (
            [box[2], box[2]]
            if index == len(boxes) - 1
            else [seams[index][0] - seams[index][1] - shift, seams[index][0] - seams[index][1] + shift]
        )
        points = [(left[0], top), (right[0], top), (right[1], bottom), (left[1], bottom)]
        convex_polygon({"points": points})
        if min(right[0] - left[0], right[1] - left[1]) <= 0:
            message = "Angle is too large for these panel proportions"
            raise ValueError(message)
        result.append(points)
    return result


def skew_rectangles(
    shapes: Sequence[Mapping[str, Any]], *, angle: float = 8, gap: float = 24, axis: str = "auto"
) -> list[dict[str, Any]]:
    """Tilt shared seams, preserving the group's outer boundary and input order.

    Gutters are expanded by sec(angle), so their perpendicular distance remains
    at least ``gap``. Horizontal seams use the transposed vertical construction.
    Invalid angles or nonadjacent/too-thin groups fail without partial changes.
    """
    if not isfinite(angle) or abs(angle) >= 45 or not isfinite(gap) or gap < 0:
        message = "Angle must be finite and between -45 and 45 degrees; gap must be nonnegative"
        raise ValueError(message)
    if len(shapes) < 2 or any(shape.get("type", "rect") != "rect" for shape in shapes):
        message = "Skew requires at least two rectangular panels"
        raise ValueError(message)
    boxes = [shape_bbox(shape) for shape in shapes]
    chosen_axis = _row_axis(boxes, axis)
    if angle == 0:
        return [dict(shape) for shape in shapes]
    transposed = chosen_axis == "horizontal"
    boxes = [(y1, x1, y2, x2) for x1, y1, x2, y2 in boxes] if transposed else boxes
    indices = sorted(range(len(boxes)), key=lambda index: boxes[index][0])
    polygons = _skew_row([boxes[index] for index in indices], angle, gap)
    result: list[dict[str, Any]] = [{} for _ in shapes]
    for index, points in zip(indices, polygons, strict=True):
        output_points = [(points[i][1], points[i][0]) for i in (0, 3, 2, 1)] if transposed else points
        result[index] = {"type": "quad", "points": [[round(x, 2), round(y, 2)] for x, y in output_points]}
    return result


def midline_rect(shape: Any) -> dict[str, Any]:
    """Rectangular generation region bounded by the midpoints of quad edges."""
    points = convex_polygon(shape)
    centers = [
        ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in zip(points, [*points[1:], points[0]], strict=True)
    ]
    edges = list(zip(points, [*points[1:], points[0]], strict=True))
    horizontal = [i for i, (a, b) in enumerate(edges) if abs(a[1] - b[1]) < 1e-8]
    vertical = [i for i, (a, b) in enumerate(edges) if abs(a[0] - b[0]) < 1e-8]
    # Identify corresponding edges, rather than extreme midpoint coordinates:
    # in thin slanted bands a side midpoint can lie above a top-edge midpoint.
    x_centers = [c for i, c in enumerate(centers) if i not in horizontal] if len(horizontal) == 2 else centers
    y_centers = [c for i, c in enumerate(centers) if i not in vertical] if len(vertical) == 2 else centers
    x1, y1 = min(x for x, _ in x_centers), min(y for _, y in y_centers)
    x2, y2 = max(x for x, _ in x_centers), max(y for _, y in y_centers)
    return {"type": "rect", "x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1}


def _solve_linear(rows: Sequence[Sequence[float]]) -> list[float] | None:
    """Small Gaussian elimination for a four-variable polytope vertex."""
    matrix = [list(row) for row in rows]
    count = len(matrix)
    for column in range(count):
        pivot = max(range(column, count), key=lambda index: abs(matrix[index][column]))
        if abs(matrix[pivot][column]) < 1e-9:
            return None
        matrix[column], matrix[pivot] = matrix[pivot], matrix[column]
        divisor = matrix[column][column]
        matrix[column] = [value / divisor for value in matrix[column]]
        for index in range(count):
            if index != column:
                factor = matrix[index][column]
                matrix[index] = [v - factor * p for v, p in zip(matrix[index], matrix[column], strict=True)]
    return [row[-1] for row in matrix]


def _rectangle_constraints(shape: Any) -> list[list[float]]:
    points = convex_polygon(shape)
    constraints = []
    for start, end in zip(points, [*points[1:], points[0]], strict=True):
        a, b = end[1] - start[1], start[0] - end[0]
        length = hypot(a, b)
        a, b = a / length, b / length
        constraints.append([a, b, abs(a), abs(b), a * start[0] + b * start[1]])
    return [*constraints, [0, 0, -1, 0, 0], [0, 0, 0, -1, 0]]


def inscribed_rect(shape: Any) -> dict[str, Any]:
    """Maximum-area axis-aligned rectangle in any convex quadrilateral.

    Project the (center_x, center_y, half_width, half_height) constraint polytope
    into width/height space. Its vertices and edges contain the area maximum;
    optimize the quadratic area on every pair of projected vertices. No sampling
    or external optimizer is needed, including for diamonds and trapezoids.
    """
    constraints = _rectangle_constraints(shape)
    vertices = []
    for active in combinations(constraints, 4):
        vertex = _solve_linear(active)
        if vertex is not None and all(
            sum(a * v for a, v in zip(row[:-1], vertex, strict=True)) <= row[-1] + 1e-7 for row in constraints
        ):
            vertices.append(vertex)
    if not vertices:
        message = "No axis-aligned rectangle fits inside this panel"
        raise ValueError(message)
    candidates = list(vertices)
    for first, second in combinations(vertices, 2):
        delta = [b - a for a, b in zip(first, second, strict=True)]
        quadratic = delta[2] * delta[3]
        if quadratic < -1e-12:
            ratio = max(0.0, min(1.0, -(delta[2] * first[3] + delta[3] * first[2]) / (2 * quadratic)))
            candidates.append([a + ratio * d for a, d in zip(first, delta, strict=True)])
    cx, cy, half_w, half_h = max(candidates, key=lambda v: v[2] * v[3])
    return {"type": "rect", "x": cx - half_w, "y": cy - half_h, "w": 2 * half_w, "h": 2 * half_h}


__all__ = [
    "bbox_overlap",
    "bbox_xywh",
    "convex_polygon",
    "from_moss_bbox",
    "inscribed_rect",
    "midline_rect",
    "panel_to_moss_bbox",
    "polygon_area",
    "polygons_overlap",
    "quad_bbox",
    "shape_bbox",
    "shape_distance",
    "shape_polygon",
    "skew_rectangles",
    "to_moss_bbox",
]
