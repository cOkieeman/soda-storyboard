# ruff: noqa: RUF001
# Chinese user-facing diagnostics intentionally use Chinese punctuation.
"""Panel crops, figure masks, text preservation and quad geometry."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

from soda_storyboard.figure_semantics import figure_page_box
from soda_storyboard.figures import panel_figures
from soda_storyboard.geometry import polygon_area, shape_bbox
from soda_storyboard.lettering import layout_texts

from .errors import ProductionError

if TYPE_CHECKING:
    from pathlib import Path

    from soda_storyboard.models import Figure, Page, Panel


EPSILON = 1e-8
PIXEL_TOLERANCE = 1e-6
MOSS_ALIGNMENT = 16


def working_size(width: int, height: int, *, long_side: int = 1024) -> tuple[int, int]:
    """Keep the crop's aspect ratio at a useful, 16-aligned diffusion size."""
    if width <= 0 or height <= 0 or long_side < MOSS_ALIGNMENT:
        msg = "工作尺寸必须为正数，长边至少为 16"
        raise ProductionError(msg)
    scale = long_side / max(width, height)
    return tuple(
        max(MOSS_ALIGNMENT, round(side * scale / MOSS_ALIGNMENT) * MOSS_ALIGNMENT) for side in (width, height)
    )


def open_rgb(path: str | Path, size: tuple[int, int] | None = None) -> Image.Image:
    with Image.open(path) as source:
        image = source.convert("RGB")
    return image.resize(size, Image.Resampling.LANCZOS) if size and image.size != size else image


def panel_box(panel: Panel) -> tuple[int, int, int, int]:
    x, y, right, bottom = shape_bbox(panel.shape)
    box = (math.floor(x), math.floor(y), math.ceil(right), math.ceil(bottom))
    if box[2] <= box[0] or box[3] <= box[1]:
        msg = f"格子 {panel.id} 的尺寸必须大于 0"
        raise ProductionError(msg)
    return box


def panel_size(panel: Panel) -> tuple[int, int]:
    x, y, right, bottom = panel_box(panel)
    return right - x, bottom - y


def inset_quad(points: list[list[float]], inset: float = 12) -> list[tuple[float, float]]:
    """Intersect inward parallel edges: inset is in pixels, not a scale factor."""
    if inset < 0:
        msg = "cut-inset 不能为负"
        raise ProductionError(msg)
    area = sum(
        points[i][0] * points[(i + 1) % 4][1] - points[(i + 1) % 4][0] * points[i][1] for i in range(4)
    )
    orientation = 1 if area > 0 else -1
    edges = []
    for i, (x, y) in enumerate(points):
        end = points[(i + 1) % 4]
        dx, dy = end[0] - x, end[1] - y
        length = math.hypot(dx, dy)
        if not length:
            msg = "斜切格含重复顶点"
            raise ProductionError(msg)
        nx, ny = -dy / length * orientation, dx / length * orientation
        edges.append((x + nx * inset, y + ny * inset, dx, dy, nx, ny))
    result = []
    for i, edge in enumerate(edges):
        x, y, dx, dy, _, _ = edge
        px, py, pdx, pdy, _, _ = edges[i - 1]
        cross = dx * pdy - dy * pdx
        if abs(cross) < EPSILON:
            msg = "斜切格相邻边平行，无法向内裁剪"
            raise ProductionError(msg)
        distance = ((px - x) * pdy - (py - y) * pdx) / cross
        result.append((x + distance * dx, y + distance * dy))
    if (
        abs(polygon_area(result)) <= EPSILON
        or any(
            math.hypot(x - result[i - 1][0], y - result[i - 1][1]) <= EPSILON
            for i, (x, y) in enumerate(result)
        )
        or any(
            (vx - x) * nx + (vy - y) * ny < -PIXEL_TOLERANCE
            for vx, vy in result
            for x, y, _, _, nx, ny in edges
        )
    ):
        msg = "cut-inset 太大，斜切格已没有可用区域"
        raise ProductionError(msg)
    return result


def quad_mask(panel: Panel, *, inset: float = 0) -> Image.Image:
    mask = Image.new("L", panel_size(panel), 255 if panel.shape_type != "quad" else 0)
    if panel.shape_type == "quad":
        x, y, _, _ = panel_box(panel)
        points = inset_quad(panel.shape["points"], inset)
        ImageDraw.Draw(mask).polygon([(px - x, py - y) for px, py in points], fill=255)
    return mask


def _figure_box(figure: Figure, panel: Panel) -> tuple[int, int, int, int]:
    # Keep the mask in panel-local coordinates while the compiler consumes
    # the same integer footprint in page coordinates.
    px, py, _, _ = panel_box(panel)
    try:
        left, top, right, bottom = figure_page_box(figure, panel)
    except ValueError as exc:
        raise ProductionError(str(exc)) from exc
    return left - px, top - py, right - px, bottom - py


def figure_mask(
    panel: Panel, page: Page, character_id: str, *, margin: int = 24, feather: int = 16
) -> Image.Image:
    if margin < 0 or feather < 0:
        msg = "遮罩余量和羽化不能为负"
        raise ProductionError(msg)
    figures = panel_figures(panel, page)
    targets = [f for f in figures if f.character_id == character_id]
    if not targets:
        msg = f"格子 {panel.id} 没有角色 {character_id} 的 figures 位置"
        raise ProductionError(msg)
    mask = Image.new("L", panel_size(panel))
    draw = ImageDraw.Draw(mask)
    for figure in targets:
        left, top, right, bottom = _figure_box(figure, panel)
        if right <= left or bottom <= top:
            continue
        # Editor bounds are half-open; Pillow rectangles include their final
        # pixel. Legacy masks retain their original inclusive endpoint rule.
        end = 1 if figure.extra.get("editor") is not None else 0
        draw.rectangle((left - margin, top - margin, right + margin - end, bottom + margin - end), fill=255)
    if feather:
        mask = mask.filter(ImageFilter.GaussianBlur(feather))
    # Protect others AFTER feathering so blur can never spill onto their silhouettes.
    draw = ImageDraw.Draw(mask)
    for figure in figures:
        if figure.character_id != character_id:
            left, top, right, bottom = _figure_box(figure, panel)
            if right > left and bottom > top:
                end = 1 if figure.extra.get("editor") is not None else 0
                draw.rectangle((left, top, right - end, bottom - end), fill=0)
    mask = ImageChops.multiply(mask, quad_mask(panel))
    if not mask.getbbox():
        msg = "人物遮罩为空或被另一角色完全遮住，请调整 figures/bbox"
        raise ProductionError(msg)
    return mask


def preserve_text(original: Image.Image, redrawn: Image.Image, panel: Panel, page: Page) -> Image.Image:
    result = redrawn.resize(original.size, Image.Resampling.LANCZOS).convert("RGB")
    if page.dialogue_mode != "moss_text":
        return result
    px, py, _, _ = panel_box(panel)
    for text in layout_texts(page):
        if text.bbox is None or text.extra.get("render_mode") == "lettering":
            continue
        b = text.bbox
        box = (
            max(0, math.floor(b.x - px)),
            max(0, math.floor(b.y - py)),
            min(original.width, math.ceil(b.x + b.w - px)),
            min(original.height, math.ceil(b.y + b.h - py)),
        )
        if box[2] > box[0] and box[3] > box[1]:
            result.paste(original.crop(box), box[:2])
    return result


def candidate_sheet(paths: list[Path], seeds: list[int], destination: Path) -> None:
    thumbs = []
    for path in paths:
        image = open_rgb(path)
        image.thumbnail((320, 480))
        thumbs.append(image)
    sheet = Image.new("RGB", (sum(im.width for im in thumbs), max(im.height for im in thumbs) + 32), "white")
    draw = ImageDraw.Draw(sheet)
    x = 0
    for im, seed in zip(thumbs, seeds, strict=True):
        sheet.paste(im, (x, 32))
        draw.text((x + 5, 6), f"seed {seed}", fill="black", font=ImageFont.load_default())
        x += im.width
    sheet.save(destination)
