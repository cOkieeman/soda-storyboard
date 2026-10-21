"""Offline panel extraction using whitespace, components and straight frame edges.

Implemented from general image-processing principles, with Pillow and stdlib only.
No third-party panel detector or model is used.
"""

from __future__ import annotations

import math
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, UnidentifiedImageError

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
    rows: list[list[dict[str, Any]]] = []
    # The shortest bottom in a row prevents a tall spanning panel joining later rows.
    for panel in sorted(panels, key=lambda p: shape_bbox(p["shape"])[1]):
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
        result.extend(sorted(row, key=lambda p: shape_bbox(p["shape"])[0], reverse=direction == "rtl"))
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
    image: Image.Image, *, direction: str = "rtl", source_name: str = "reference.png"
) -> dict[str, Any]:
    if image.format not in {None, "PNG", "JPEG", "WEBP"}:
        msg = "Only PNG, JPG and WebP images are supported"
        raise ValueError(msg)
    if image.width * image.height > MAX_PIXELS:
        msg = "Reference image exceeds 32 million pixels"
        raise ValueError(msg)
    image = ImageOps.exif_transpose(image)
    width, height = image.size
    gray = image.convert("RGBA")
    background = Image.new("RGBA", gray.size, "white")
    background.alpha_composite(gray)
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


def extract_layout(path: str | Path, *, direction: str = "rtl") -> dict[str, Any]:
    try:
        with Image.open(path) as image:
            return extract_image(image, direction=direction, source_name=Path(path).name)
    except (UnidentifiedImageError, Image.DecompressionBombError) as exc:
        msg = "Invalid or oversized reference image"
        raise ValueError(msg) from exc


def draw_extraction_preview(image: Image.Image, result: dict[str, Any], output: str | Path) -> Path:
    preview = ImageOps.exif_transpose(image).convert("RGB")
    draw = ImageDraw.Draw(preview)
    stroke = max(2, round(min(preview.size) / 250))
    font = ImageFont.load_default(size=max(16, stroke * 7))
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
