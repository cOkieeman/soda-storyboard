"""Offline panel extraction using whitespace, components and straight frame edges.

Implemented from general image-processing principles, with Pillow and stdlib only.
No third-party panel detector or model is used.
"""

from __future__ import annotations

import math
import re
import uuid
from datetime import UTC, datetime
from itertools import combinations, pairwise
from pathlib import Path
from typing import TYPE_CHECKING, Any

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, UnidentifiedImageError

from .color_extract import extract_colors
from .geometry import convex_polygon, polygon_area, shape_bbox, shape_polygon
from .io import write_json

if TYPE_CHECKING:
    from collections.abc import Sequence

# Image/template JSON contains rects and quads with heterogeneous geometry fields.
# ruff: noqa: PLR2004, RUF001

MAX_PIXELS = 32_000_000
MIN_AREA = 0.015
Point = tuple[float, float]
Box = tuple[int, int, int, int]
Segment = tuple[int, int, int]  # perpendicular coordinate, start, end


def _straight_segments(image: Image.Image, *, vertical: bool = False) -> list[Segment]:
    """Trace contrast ridges beside light gutters, retaining pale coloured rules.

    Unlike a page-wide threshold, the perpendicular comparison works when the
    artwork touches the rule. Short gaps allow antialiasing and small occlusions.
    The unfiltered RGB minimum preserves thin blue rules lost by a median filter.
    """
    if vertical:
        image = image.transpose(Image.Transpose.TRANSPOSE)
    width, height = image.size
    pixels = image.tobytes()
    values = [min(rgb) for rgb in zip(pixels[::3], pixels[1::3], pixels[2::3], strict=True)]
    segments = []
    minimum = max(24, round(min(image.size) * 0.075))
    for y in range(3, height - 3):
        hits = []
        for x in range(width):
            index = y * width + x
            value = values[index]
            neighbor = max(values[index - width * 3], values[index + width * 3])
            hits.append(
                value < 240
                and ((neighbor > 245 and neighbor - value > 12) or (value < 110 and neighbor - value > 70))
            )
        segments.extend((y, start, end) for start, end in _ridge_runs(hits, minimum))
    # Thin rules can contribute several adjacent ridges. Keep the longest and
    # retain separate fragments at the same coordinate when a figure occludes it.
    kept: list[Segment] = []
    for segment in sorted(segments, key=lambda s: s[2] - s[1], reverse=True):
        if not any(
            abs(segment[0] - other[0]) <= 3
            and min(segment[2], other[2]) - max(segment[1], other[1]) > 0.7 * (segment[2] - segment[1])
            for other in kept
        ):
            kept.append(segment)
    return sorted(kept)


def _ridge_runs(hits: list[bool], minimum: int) -> list[tuple[int, int]]:
    start = None
    last = 0
    runs = []
    for x, hit in enumerate([*hits, False, False, False, False]):
        if hit:
            if start is None:
                start = x
            last = x
        elif start is not None and x - last > 3:
            if last - start >= minimum:
                runs.append((start, last))
            start = None
    return runs


def _coverage(segments: list[Segment], coordinate: int, start: int, end: int) -> float:
    intervals = sorted(
        (max(start, a), min(end, b))
        for position, a, b in segments
        if abs(position - coordinate) <= 3 and b > start and a < end
    )
    covered = 0
    previous = start
    for a, b in intervals:
        covered += max(0, b - max(a, previous))
        previous = max(previous, b)
    return covered / max(1, end - start)


def _coordinates(segments: list[Segment]) -> list[int]:
    positions: list[int] = []
    for position, _, _ in sorted(segments, key=lambda s: s[2] - s[1], reverse=True):
        if all(abs(position - other) > 3 for other in positions):
            positions.append(position)
    return sorted(positions)


def _box_panel(box: Box, confidence: float) -> dict[str, Any]:
    left, top, right, bottom = box
    return {
        "shape": {"type": "rect", "x": left, "y": top, "w": right - left, "h": bottom - top},
        "confidence": round(confidence, 3),
    }


def _rectangle_frames(
    horizontal: list[Segment], vertical: list[Segment], image: Image.Image
) -> list[dict[str, Any]]:
    """Find locally closed rectangles, independent of the connected artwork."""
    size = image.size
    xs, ys = _coordinates(vertical), _coordinates(horizontal)
    light = image.convert("L").tobytes()
    candidates = []
    minimum_area = size[0] * size[1] * MIN_AREA
    for i, left in enumerate(xs):
        for right in xs[i + 1 :]:
            if right - left < size[0] * 0.09:
                continue
            supported = [(y, _coverage(horizontal, y, left, right)) for y in ys]
            supported = [(y, support) for y, support in supported if support >= 0.55]
            for j, (top, top_support) in enumerate(supported):
                for bottom, bottom_support in supported[j + 1 :]:
                    if (right - left) * (bottom - top) < minimum_area or bottom - top < size[1] * 0.06:
                        continue
                    sides = [
                        top_support,
                        bottom_support,
                        _coverage(vertical, left, top, bottom),
                        _coverage(vertical, right, top, bottom),
                    ]
                    box = (left, top, right, bottom)
                    if min(sides[:2]) < 0.55 or min(sides[2:]) < 0.90:
                        continue
                    outside = _outside_light(box, light, size)
                    if min(outside) >= 0.50 and sum(outside) / 4 >= 0.80:
                        confidence = 0.6 * min(sides) + 0.4 * sum(outside) / 4
                        candidates.append(
                            _box_panel(box, min(0.65, confidence) if min(sides) < 0.7 else confidence)
                        )
    # A large box spanning multiple separated panels also has four outer sides.
    # Prefer the small closed faces, but keep genuine inset panels: their parent
    # is not tiled by multiple children that stretch from one outer edge to another.
    return _minimal_faces(candidates)


def _partial_frames(
    horizontal: list[Segment],
    vertical: list[Segment],
    image: Image.Image,
    confirmed: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Recover one obscured side only when three other sides have evidence."""
    xs, ys = _coordinates(vertical), _coordinates(horizontal)
    # Missing horizontal edges must align with a neighbouring confirmed panel.
    aligned = {round(y) for panel in confirmed for y in shape_bbox(panel["shape"])[1::2]}
    light = image.convert("L")
    candidates = []
    for left, right in combinations(xs, 2):
        if right - left < image.width * 0.12:
            continue
        hs = [(y, _coverage(horizontal, y, left, right)) for y in ys]
        for (top, top_support), (bottom, bottom_support) in combinations(hs, 2):
            if top_support < 0.85 or (bottom_support < 0.70 and bottom not in aligned):
                continue
            if (right - left) * (
                bottom - top
            ) < image.width * image.height * MIN_AREA or bottom - top < image.height * 0.06:
                continue
            box = (left, top, right, bottom)
            if any(_overlap_fraction(box, shape_bbox(p["shape"])) > 0.10 for p in confirmed):
                continue
            confidence = _partial_support(box, horizontal, vertical, light)
            if confidence:
                candidates.append(_box_panel(box, confidence))
    result: list[dict[str, Any]] = []
    for panel in sorted(
        candidates,
        key=lambda p: (
            _corner_matches(shape_bbox(p["shape"]), vertical),
            polygon_area(shape_polygon(p["shape"])),
        ),
        reverse=True,
    ):
        if not any(
            _overlap_fraction(shape_bbox(panel["shape"]), shape_bbox(p["shape"])) > 0.25 for p in result
        ):
            result.append(panel)
    return result


def _partial_support(
    box: Box, horizontal: list[Segment], vertical: list[Segment], image: Image.Image
) -> float:
    left, top, right, bottom = box
    sides = [
        _coverage(horizontal, top, left, right),
        _coverage(horizontal, bottom, left, right),
        _coverage(vertical, left, top, bottom),
        _coverage(vertical, right, top, bottom),
    ]
    if sum(s >= 0.70 for s in sides) < 3:
        return 0
    outside = _outside_light(box, image.tobytes(), image.size)
    return min(0.69, sum(sides) / 4 * 0.75) if sum(s >= 0.70 for s in outside) >= 3 else 0


def _corner_matches(box: Sequence[float], vertical: list[Segment]) -> int:
    left, top, right, bottom = box
    return sum(
        any(
            abs(position - x) <= 3 and abs(endpoint - y) <= 4
            for position, start, end in vertical
            for endpoint in ([start] if y == top else [end])
        )
        for x in (left, right)
        for y in (top, bottom)
    )


def _overlap_fraction(a: Sequence[float], b: Sequence[float]) -> float:
    intersection = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
    return intersection / max(1, min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])))


def _occluded_bands(
    horizontal: list[Segment], vertical: list[Segment], size: tuple[int, int]
) -> list[dict[str, Any]]:
    """Infer repeated bilateral rows whose central rules are entirely occluded.

    This is deliberately low confidence: the pixels cannot prove where a fully
    covered central rule lies. Require repeated rows and evidence at both ends.
    """
    width, height = size
    bands = []
    for left, top, bottom in vertical:
        if left > width * 0.08 or bottom - top < height * 0.15:
            continue
        for right, other_top, other_bottom in vertical:
            if right < width * 0.92 or abs(top - other_top) > 5 or abs(bottom - other_bottom) > 5:
                continue
            top_y = min(_coordinates(horizontal), key=lambda y: abs(y - top))
            bottom_y = min(_coordinates(horizontal), key=lambda y: abs(y - bottom))
            if abs(top_y - top) > 5 or abs(bottom_y - bottom) > 5:
                continue
            center = (left + right) // 2
            if all(
                _coverage(horizontal, y, left, left + (right - left) // 4) > 0.75
                and _coverage(horizontal, y, right - (right - left) // 4, right) > 0.75
                and _coverage(horizontal, y, center - 8, center + 8) < 0.15
                for y in (top_y, bottom_y)
            ):
                bands.append((left, top_y, right, bottom_y))
    unique = []
    for box in bands:
        if not any(_box_iou(box, other) > 0.8 for other in unique):
            unique.append(box)
    if len(unique) < 2:
        return []
    # Estimate hidden gutter width from the visible spacing between row bands.
    unique.sort(key=lambda box: box[1])
    gap = max(2, min(12, round(min(b[1] - a[3] for a, b in pairwise(unique)) / 2)))
    return [
        _box_panel(part, 0.45)
        for left, top, right, bottom in unique
        for part in (
            (left, top, (left + right) // 2 - gap, bottom),
            ((left + right) // 2 + gap, top, right, bottom),
        )
    ]


def _suspended_frames(
    horizontal: list[Segment], vertical: list[Segment], panels: list[dict[str, Any]], size: tuple[int, int]
) -> list[dict[str, Any]]:
    """A bottom rule and two short side stubs can survive behind overlapping panels."""
    result = []
    for bottom, left, right in horizontal:
        if right - left < size[0] * 0.25:
            continue
        stubs = [
            (position, start, end)
            for position, start, end in vertical
            if abs(end - bottom) <= 4 and min(abs(position - left), abs(position - right)) <= 4
        ]
        if len(stubs) < 2:
            continue
        if not any(abs(x - left) <= 4 for x, _, _ in stubs) or not any(
            abs(x - right) <= 4 for x, _, _ in stubs
        ):
            continue
        stub_top = min(start for _, start, _ in stubs)
        neighbours = [
            shape_bbox(p["shape"]) for p in panels if abs(shape_bbox(p["shape"])[3] - stub_top) <= 5
        ]
        if len(neighbours) < 2:
            continue
        top = round(min(box[1] for box in neighbours))
        box = (left, top, right, bottom)
        if not any(_box_iou(box, shape_bbox(p["shape"])) > 0.8 for p in panels):
            result.append(_box_panel(box, 0.45))
    return _minimal_faces(result)


def _bleed_frame(
    horizontal: list[Segment], panels: list[dict[str, Any]], image: Image.Image
) -> list[dict[str, Any]]:
    """Recognize a lower bleed region bounded by a rule reaching both page edges."""
    width, height = image.size
    light = image.convert("L").tobytes()
    for y in _coordinates(horizontal):
        if not height * 0.25 < y < height * 0.80:
            continue
        if (
            _coverage(horizontal, y, 0, width // 6) < 0.8
            or _coverage(horizontal, y, width * 5 // 6, width) < 0.8
        ):
            continue
        if not any(abs(shape_bbox(p["shape"])[3] - y) < height * 0.04 for p in panels):
            continue
        box = (0, y, width - 1, height - 1)
        if any(_overlap_fraction(box, shape_bbox(p["shape"])) > 0.3 for p in panels):
            continue
        if sum(value < 235 for value in light[-width * 5 :]) / (width * 5) > 0.4:
            return [_box_panel(box, 0.55)]
    return []


def _inset_frames(
    horizontal: list[Segment],
    vertical: list[Segment],
    image: Image.Image,
    panels: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    xs, ys = _coordinates(vertical), _coordinates(horizontal)
    light = image.convert("L")
    result = []
    for parent in panels:
        left, top, right, bottom = shape_bbox(parent["shape"])
        pxs = [x for x in xs if left + 5 < x < right - 5]
        pys = [y for y in ys if top + 5 < y < bottom - 5]
        for i, x in enumerate(pxs):
            for r in pxs[i + 1 :]:
                hs = [y for y in pys if _coverage(horizontal, y, x, r) >= 0.96]
                for j, y in enumerate(hs):
                    for b in hs[j + 1 :]:
                        if (r - x) * (b - y) < image.width * image.height * MIN_AREA:
                            continue
                        if min(_coverage(vertical, x, y, b), _coverage(vertical, r, y, b)) < 0.96:
                            continue
                        # Rectangular narration boxes are predominantly paper-white;
                        # keep picture insets, rather than promoting text to panels.
                        histogram = light.crop((x + 3, y + 3, r - 3, b - 3)).histogram()
                        if sum(histogram[242:]) / max(1, sum(histogram)) < 0.55:
                            result.append(_box_panel((x, y, r, b), 0.90))
    return _minimal_faces(result)


def _line_frames(image: Image.Image) -> list[dict[str, Any]]:
    horizontal = _straight_segments(image)
    vertical = _straight_segments(image, vertical=True)
    if not horizontal or not vertical:
        return []
    bands = _occluded_bands(horizontal, vertical, image.size)
    if bands:
        return bands
    panels = _rectangle_frames(horizontal, vertical, image)
    panels += _partial_frames(horizontal, vertical, image, panels)
    panels += _suspended_frames(horizontal, vertical, panels, image.size)
    panels += _bleed_frame(horizontal, panels, image)
    panels += _inset_frames(horizontal, vertical, image, panels)
    return panels


def _outside_light(box: Box, light: bytes, size: tuple[int, int]) -> list[float]:
    width, height = size
    left, top, right, bottom = box
    sides = [
        [[(x, top - distance) for distance in range(1, 5)] for x in range(left, right)],
        [[(x, bottom + distance) for distance in range(1, 5)] for x in range(left, right)],
        [[(left - distance, y) for distance in range(1, 5)] for y in range(top, bottom)],
        [[(right + distance, y) for distance in range(1, 5)] for y in range(top, bottom)],
    ]
    return [
        sum(
            any(not (0 <= x < width and 0 <= y < height) or light[y * width + x] >= 242 for x, y in band)
            for band in side
        )
        / max(1, len(side))
        for side in sides
    ]


def _minimal_faces(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    faces = []
    for panel in candidates:
        box = shape_bbox(panel["shape"])
        area = (box[2] - box[0]) * (box[3] - box[1])
        children = [
            shape_bbox(child["shape"]) for child in candidates if _contains(panel["shape"], child["shape"])
        ]
        if any(
            _box_iou(a, b) < 0.02
            and (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) > area * 0.40
            for i, a in enumerate(children)
            for b in children[i + 1 :]
        ):
            continue
        faces.append(panel)
    result: list[dict[str, Any]] = []
    for panel in sorted(
        faces,
        key=lambda p: (p["confidence"], polygon_area(shape_polygon(p["shape"]))),
        reverse=True,
    ):
        box = shape_bbox(panel["shape"])
        if any(
            _box_iou(box, shape_bbox(other["shape"])) > 0.80
            or (
                _contains(other["shape"], panel["shape"])
                and any(abs(a - b) <= 4 for a, b in zip(box, shape_bbox(other["shape"]), strict=True))
            )
            or (
                _overlap_fraction(box, shape_bbox(other["shape"])) > 0.75
                and not _contains(other["shape"], panel["shape"])
            )
            for other in result
        ):
            continue
        result.append(panel)
    return result


def _box_iou(a: Sequence[float], b: Sequence[float]) -> float:
    intersection = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
    area = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1])
    return intersection / max(1, area - intersection)


def _threshold(gray: Image.Image) -> int:
    histogram = gray.histogram()
    total = sum(histogram)
    mean = sum(i * count for i, count in enumerate(histogram))
    weight = moment = 0
    best, threshold = -1.0, 128
    for level, count in enumerate(histogram):
        weight += count
        moment += level * count
        if not weight or weight == total:
            continue
        variance = (mean * weight - moment * total) ** 2 / (weight * (total - weight))
        if variance > best:
            best, threshold = variance, level
    # Keep antialiased frame cores, without interpreting pale gutters as ink.
    return min(220, max(80, threshold))


def _xy_regions(ink: bytes, size: tuple[int, int], box: Box, depth: int = 0) -> list[Box]:  # noqa: C901 -- two projection axes and recursive splitting
    """Split on internal near-empty projection runs, ignoring isolated specks."""
    width, _ = size
    left, top, right, bottom = box
    if depth >= 16:
        return [box]
    columns = [0] * (right - left)
    rows = [0] * (bottom - top)
    for y in range(top, bottom):
        for x in range(left, right):
            if ink[y * width + x]:
                columns[x - left] += 1
                rows[y - top] += 1
    choices = []
    for axis, projection, span in ((0, columns, bottom - top), (1, rows, right - left)):
        start = None
        for index, count in enumerate([*projection, span]):
            if count <= int(span * 0.002):
                if start is None:
                    start = index
            elif start is not None:
                if index - start >= 3 and start > 2 and index < len(projection) - 2:
                    choices.append((index - start, axis, (start + index) // 2))
                start = None
    if not choices:
        return [box]
    _, axis, split = max(choices)
    first, second = (
        ((left, top, left + split, bottom), (left + split, top, right, bottom))
        if axis == 0
        else ((left, top, right, top + split), (left, top + split, right, bottom))
    )
    return _xy_regions(ink, size, first, depth + 1) + _xy_regions(ink, size, second, depth + 1)


def _components(ink: bytes, width: int, box: Box) -> list[list[Point]]:
    left, top, right, bottom = box
    seen: set[int] = set()
    result = []
    for y in range(top, bottom):
        for x in range(left, right):
            seed = y * width + x
            if not ink[seed] or seed in seen:
                continue
            stack, points = [seed], []
            seen.add(seed)
            while stack:
                index = stack.pop()
                py, px = divmod(index, width)
                points.append((float(px), float(py)))
                for ny in range(max(top, py - 1), min(bottom, py + 2)):
                    for nx in range(max(left, px - 1), min(right, px + 2)):
                        neighbor = ny * width + nx
                        if ink[neighbor] and neighbor not in seen:
                            seen.add(neighbor)
                            stack.append(neighbor)
            if len(points) >= 24:
                result.append(points)
    return result


def _cross(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _hull(points: Sequence[Point]) -> list[Point]:
    ordered = sorted(set(points))
    lower: list[Point] = []
    upper: list[Point] = []
    for source, half in ((ordered, lower), (list(reversed(ordered)), upper)):
        for point in source:
            while len(half) >= 2 and _cross(half[-2], half[-1], point) <= 0:
                half.pop()
            half.append(point)
    return lower[:-1] + upper[:-1]


def _edge_support(quad: list[Point], ink: bytes, size: tuple[int, int]) -> float:
    width, height = size
    scores = []
    for a, b in zip(quad, [*quad[1:], quad[0]], strict=True):
        samples = max(8, round(math.dist(a, b)))
        hits = 0
        for step in range(samples + 1):
            x = round(a[0] + (b[0] - a[0]) * step / samples)
            y = round(a[1] + (b[1] - a[1]) * step / samples)
            hits += any(
                ink[ny * width + nx]
                for ny in range(max(0, y - 2), min(height, y + 3))
                for nx in range(max(0, x - 2), min(width, x + 3))
            )
        scores.append(hits / (samples + 1))
    return sum(scores) / len(scores)


def _frame(points: list[Point], ink: bytes, size: tuple[int, int]) -> dict[str, Any] | None:
    hull = _hull(points)
    area = abs(polygon_area(hull))
    if len(hull) < 4 or area < size[0] * size[1] * MIN_AREA:
        return None
    quad = list(hull)
    while len(quad) > 4:
        index = min(
            range(len(quad)), key=lambda i: abs(_cross(quad[i - 1], quad[i], quad[(i + 1) % len(quad)]))
        )
        quad.pop(index)
    fit = abs(polygon_area(quad)) / area
    support = _edge_support(quad, ink, size)
    # Ellipses, dialogue balloons and title glyphs have curved/broken hull edges.
    if fit < 0.86 or support < 0.55:
        return None
    left, top = min(x for x, _ in hull), min(y for _, y in hull)
    right, bottom = max(x for x, _ in hull), max(y for _, y in hull)
    if min(right - left, bottom - top) < min(size) * 0.06:
        return None
    reliable = fit >= 0.94 and support >= 0.92
    aligned = all(
        min(abs(a[0] - b[0]), abs(a[1] - b[1])) <= 2 for a, b in zip(quad, [*quad[1:], quad[0]], strict=True)
    )
    if reliable and not aligned:
        shape = {"type": "quad", "points": [list(p) for p in quad]}
    else:
        shape = {"type": "rect", "x": left, "y": top, "w": right - left, "h": bottom - top}
    return {"shape": shape, "confidence": round(min(fit, support), 3) if reliable else 0.45}


def reading_order(panels: list[dict[str, Any]], direction: str = "rtl") -> list[dict[str, Any]]:
    if direction not in {"rtl", "ltr"}:
        msg = "direction must be rtl or ltr"
        raise ValueError(msg)
    nested = [p for p in panels if any(p is not q and _contains(q["shape"], p["shape"]) for q in panels)]
    roots = [p for p in panels if p not in nested]
    rows: list[list[dict[str, Any]]] = []
    # The shortest bottom in a row prevents a tall spanning panel joining later rows.
    for panel in sorted(roots, key=lambda p: shape_bbox(p["shape"])[1]):
        box = shape_bbox(panel["shape"])
        row = next(
            (
                r
                for r in rows
                if box[1] < min(shape_bbox(p["shape"])[3] for p in r)
                and box[3] > max(shape_bbox(p["shape"])[1] for p in r)
            ),
            None,
        )
        if row is None:
            rows.append([panel])
        else:
            row.append(panel)
    result = []
    for row in rows:
        for panel in sorted(row, key=lambda p: shape_bbox(p["shape"])[0], reverse=direction == "rtl"):
            result.append(panel)
            children = [p for p in nested if _contains(panel["shape"], p["shape"])]
            if children:
                result.extend(reading_order(children, direction))
    return [{**panel, "order": index} for index, panel in enumerate(result, 1)]


def _scale_shape(shape: dict[str, Any], sx: float, sy: float) -> dict[str, Any]:
    if shape["type"] == "quad":
        return {"type": "quad", "points": [[round(x * sx, 6), round(y * sy, 6)] for x, y in shape["points"]]}
    return {
        "type": "rect",
        "x": round(shape["x"] * sx, 6),
        "y": round(shape["y"] * sy, 6),
        "w": round(shape["w"] * sx, 6),
        "h": round(shape["h"] * sy, 6),
    }


def extract_image(
    image: Image.Image, *, direction: str = "rtl", source_name: str = "reference.png", mode: str = "auto"
) -> dict[str, Any]:
    if image.format not in {None, "PNG", "JPEG", "WEBP"}:
        msg = "Only PNG, JPG and WebP images are supported"
        raise ValueError(msg)
    if image.width * image.height > MAX_PIXELS:
        msg = "Reference image exceeds 32 million pixels"
        raise ValueError(msg)
    image = ImageOps.exif_transpose(image)
    width, height = image.size
    if mode not in {"auto", "color", "standard"}:
        msg = "mode must be auto, color or standard"
        raise ValueError(msg)
    if mode != "standard":
        colored = extract_colors(image, lambda panels: reading_order(panels, direction))
        if colored is not None:
            return {
                **colored,
                "source_image": Path(source_name.replace("\\", "/")).name,
                "canvas": [width, height],
                "direction": direction,
                "panel_count": len(colored["panels"]),
                "threshold": None,
                "reliable": all(panel["confidence"] >= 0.7 for panel in colored["panels"]),
                "warnings": [
                    (
                        "按颜色分类；未做 OCR。红色窄框暂作角色说明，遮挡边界带置信度，"
                        "内容请由 AI 看图后填写并核对。"
                    )
                ],
            }
        if mode == "color":
            return {
                "mode": "color",
                "canvas": [width, height],
                "panels": [],
                "texts": [],
                "titles": [],
                "panel_count": 0,
                "reliable": False,
                "warnings": ["未找到可确认的青色格框，请核对颜色模式。"],
            }
    gray = image.convert("RGBA")
    background = Image.new("RGBA", gray.size, "white")
    background.alpha_composite(gray)
    reduced = background.convert("RGB")
    reduced.thumbnail((800, 800), Image.Resampling.LANCZOS)
    gray = background.convert("L")
    gray.thumbnail((800, 800), Image.Resampling.LANCZOS)
    gray = gray.filter(ImageFilter.MedianFilter(3))
    threshold = _threshold(gray)
    ink = gray.point(lambda v: 255 if v <= threshold else 0).tobytes()
    regions = _xy_regions(ink, gray.size, (0, 0, *gray.size))
    frames = [
        frame
        for region in regions
        for points in _components(ink, gray.width, region)
        if (frame := _frame(points, ink, gray.size)) is not None
    ]
    # A balloon wholly inside a larger detected frame is never a separate panel.
    frames = [p for p in frames if not any(p is not q and _contains(q["shape"], p["shape"]) for q in frames)]
    detected = _line_frames(reduced)
    # Connected clean contours remain useful for rotated and slanted frames.
    # Dense artwork and pale rules use the independent straight-edge evidence.
    clean = frames and all(p["confidence"] >= 0.7 for p in frames)
    if detected and not (
        any(p["shape"]["type"] == "quad" for p in frames) or (clean and len(frames) >= len(detected))
    ):
        frames = detected
    ordered = reading_order(frames, direction)
    panels = []
    for panel in ordered:
        shape = _scale_shape(panel["shape"], width / gray.width, height / gray.height)
        panels.append({**panel, "shape": shape, "normalized": _scale_shape(shape, 1 / width, 1 / height)})
    return {
        "source_image": Path(source_name.replace("\\", "/")).name,
        "canvas": [width, height],
        "direction": direction,
        "panel_count": len(panels),
        "panels": panels,
        "threshold": threshold,
        "reliable": bool(panels) and all(p["confidence"] >= 0.7 for p in panels),
        "warnings": (
            ["识别不可靠，建议手动调整；被遮挡或出血的边界可能为估计值。"]
            if not panels or any(p["confidence"] < 0.7 for p in panels)
            else []
        ),
    }


def _contains(outer: dict[str, Any], inner: dict[str, Any]) -> bool:
    a, b = shape_bbox(outer), shape_bbox(inner)
    return (
        a[0] <= b[0]
        and a[1] <= b[1]
        and a[2] >= b[2]
        and a[3] >= b[3]
        and (a[2] - a[0]) * (a[3] - a[1]) > (b[2] - b[0]) * (b[3] - b[1]) * 1.05
    )


def extract_layout(path: str | Path, *, direction: str = "rtl", mode: str = "auto") -> dict[str, Any]:
    try:
        with Image.open(path) as image:
            return extract_image(image, direction=direction, source_name=Path(path).name, mode=mode)
    except (UnidentifiedImageError, Image.DecompressionBombError) as exc:
        msg = "Invalid or oversized reference image"
        raise ValueError(msg) from exc


def draw_extraction_preview(image: Image.Image, result: dict[str, Any], output: str | Path) -> Path:
    preview = ImageOps.exif_transpose(image).convert("RGB")
    draw = ImageDraw.Draw(preview)
    stroke = max(2, round(min(preview.size) / 250))
    font = ImageFont.load_default(size=max(16, stroke * 7))
    for item in [*result.get("texts", []), *result.get("titles", [])]:
        x, y, right, bottom = shape_bbox(item["bbox"])
        draw.rectangle(
            (x, y, right, bottom),
            outline="#168b45" if item.get("color") == "green" else "#cc3424",
            width=stroke,
        )
    for panel in result["panels"]:
        polygon = shape_polygon(panel["shape"])
        color = "#0b916b" if panel["confidence"] >= 0.7 else "#d96614"
        for a, b in zip(polygon, [*polygon[1:], polygon[0]], strict=True):
            length = max(1, math.dist(a, b))
            dash = 10 if panel["confidence"] < 0.7 else math.ceil(length)
            for start in range(0, math.ceil(length), dash * 2):
                end = min(length, start + dash)
                draw.line(
                    [
                        (a[0] + (b[0] - a[0]) * t / length, a[1] + (b[1] - a[1]) * t / length)
                        for t in (start, end)
                    ],
                    fill=color,
                    width=stroke,
                )
        x, y, _, _ = shape_bbox(panel["shape"])
        draw.text(
            (x + stroke * 2, y + stroke * 2),
            str(panel["order"]),
            font=font,
            fill=color,
            stroke_width=2,
            stroke_fill="white",
        )
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    preview.save(path, format="PNG")
    return path


def save_template(result: dict[str, Any], directory: str | Path, *, name: str | None = None) -> Path:
    """Save only validated geometry and source basename, never source pixels."""
    panels = result["panels"]
    if not 1 <= len(panels) <= 100 or result.get("direction", "rtl") not in {"rtl", "ltr"}:
        msg = "A template requires 1 to 100 panels and a valid reading direction"
        raise ValueError(msg)
    normalized = []
    for order, panel in enumerate(panels, 1):
        raw = panel["normalized"]
        shape = _scale_shape(raw, 1, 1)
        polygon = convex_polygon(shape)
        if any(not math.isfinite(v) or not 0 <= v <= 1 for point in polygon for v in point):
            msg = "Template coordinates must be finite and normalized to [0, 1]"
            raise ValueError(msg)
        normalized.append({**shape, "order": order})
    title = name or "Reference layout"
    slug = re.sub(r"[^\w-]", "-", title).strip("-")[:60] or "reference"
    template_id = f"reference-{slug}-{uuid.uuid4().hex[:10]}"
    source = str(result.get("source_image", "reference.png")).replace("\\", "/").split("/")[-1]
    template = {
        "id": template_id,
        "name": title,
        "family": template_id,
        "panel_count": len(normalized),
        "panels": normalized,
        "source": "reference",
        "source_label": "来自参考页",
        "source_image": source,
        "extracted_at": datetime.now(UTC).isoformat(),
        "reading_direction": result.get("direction", "rtl"),
        "description": "来自参考页；只保存格子几何，不保存原图",
    }
    path = Path(directory) / f"{template_id}.json"
    write_json(path, template)
    return path
