# ruff: noqa: RUF001
# Chinese user-facing diagnostics intentionally use Chinese punctuation.
"""Pillow lettering with CJK font discovery and deterministic bubble shapes."""

from __future__ import annotations

import math
from pathlib import Path
from typing import TYPE_CHECKING

from PIL import ImageDraw, ImageFont

from soda_storyboard.bubble_geometry import layout_shout_text, shout_bubble_points
from soda_storyboard.lettering import layout_texts, text_lines, vertical_columns

from .errors import ProductionError

if TYPE_CHECKING:
    from PIL import Image

    from soda_storyboard.models import Page, Text

FONT_CANDIDATES = (
    "C:/Windows/Fonts/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "C:/Windows/Fonts/SourceHanSansSC-Regular.otf",
    "/usr/share/fonts/opentype/source-han-sans/SourceHanSansSC-Regular.otf",
    "C:/Windows/Fonts/msyh.ttc",
    "/System/Library/Fonts/PingFang.ttc",
)


def find_font(explicit: str | Path | None = None, *, cjk: bool = True) -> str | None:
    if explicit:
        path = Path(explicit)
        if not path.is_file():
            msg = f"指定字体不存在：{path}"
            raise ProductionError(msg)
        return str(path)
    for candidate in FONT_CANDIDATES:
        if Path(candidate).is_file():
            return candidate
    if cjk:
        msg = "找不到中文字体，请安装 Noto Sans CJK SC / 思源黑体 / 微软雅黑，或用 --font 指定字体文件"
        raise ProductionError(msg)
    return None


def font_size_override(text: Text) -> float | None:
    """Return an explicit page-pixel font size, accepting only bounded finite numbers."""
    value = text.extra.get("font_size")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        size = float(value)
    except OverflowError:
        return None
    if not math.isfinite(size) or size <= 0:
        return None
    return min(512, max(1, size))


def draw_bubble(  # noqa: PLR0913 -- existing drawing API plus optional explicit tail
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    kind: str,
    width: int = 2,
    *,
    outline: str = "black",
    tail_tip: tuple[float, float] | None = None,
) -> None:
    left, top, right, bottom = box
    if kind == "none":
        return
    if kind in {"box", "narration"}:
        draw.rectangle(box, fill="white", outline=outline, width=width)
    elif kind == "speech":
        draw.ellipse(box, fill="white", outline=outline, width=width)
    elif kind == "shout":
        points = [
            (left + x, top + y)
            for x, y in shout_bubble_points(right - left + 1, bottom - top + 1, width, tail_tip)
        ]
        draw.polygon(points, fill="white")
        draw.line([*points, points[0]], fill=outline, width=width, joint="curve")
    elif kind == "thought":
        cx, cy = (left + right) / 2, (top + bottom) / 2
        rx, ry = max(0, (right - left - width) / 2), max(0, (bottom - top - width) / 2)
        count = 160
        points = []
        for i in range(count):
            angle = math.tau * i / count
            radius = 0.94 + 0.06 * math.cos(angle * 10)
            points.append(
                (
                    cx + rx * radius * math.cos(angle),
                    cy + ry * radius * math.sin(angle),
                )
            )
        draw.polygon(points, fill="white")
        draw.line([*points, points[0]], fill=outline, width=width, joint="curve")
    else:
        msg = f"不支持的气泡形状：{kind}"
        raise ProductionError(msg)


def _font(path: str | None, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype(path, size) if path else ImageFont.load_default(size=size)
    except OSError as exc:
        msg = f"无法加载字体：{path}；{exc}"
        raise ProductionError(msg) from exc


def shout_tail_tip(text: Text, scale: float = 1) -> tuple[float, float] | None:
    value = text.extra.get("tail_tip")
    if not isinstance(value, (list, tuple)) or len(value) != 2:  # noqa: PLR2004 -- a coordinate pair
        return None
    if not all(isinstance(v, (float, int)) and not isinstance(v, bool) for v in value):
        return None
    try:
        point = float(value[0]) * scale, float(value[1]) * scale
    except OverflowError:
        return None
    return point if all(math.isfinite(v) for v in point) else None


def draw_shout_text(  # noqa: PLR0913 -- shared render context and lettering options
    draw: ImageDraw.ImageDraw,
    text: Text,
    box: tuple[int, int, int, int],
    font_path: str | None,
    font_size: float,
    *,
    direction: str,
    color: str = "black",
    reading_direction: str = "rtl",
) -> None:
    left, top, right, bottom = box
    layout = layout_shout_text(right - left + 1, bottom - top + 1, text.text, direction, font_size)
    font = _font(font_path, layout.font_size)
    if direction == "vertical":
        for index, column in enumerate(layout.columns):
            column_index = len(layout.columns) - 1 - index if reading_direction == "rtl" else index
            x = left + layout.content_x + (column_index + 0.5) * layout.cell_width
            for row, glyph in enumerate(column):
                size = max(
                    1,
                    int(
                        layout.font_size
                        * min(1, layout.cell_width / max(1, draw.textlength(glyph, font=font)))
                    ),
                )
                draw.text(
                    (x, top + layout.content_y + (row + 0.5) * layout.cell_height),
                    glyph,
                    fill=color,
                    font=_font(font_path, size),
                    anchor="mm",
                )
    else:
        for row, line in enumerate(layout.lines):
            draw.text(
                ((left + right + 1) / 2, top + layout.content_y + (row + 0.5) * layout.cell_height),
                line,
                fill=color,
                font=font,
                anchor="mm",
            )


def _draw_text(  # noqa: C901, PLR0912 -- fitting horizontal rows and vertical columns
    image: Image.Image, text: Text, page: Page, font_path: str | None
) -> None:
    if text.bbox is None:
        return
    b = text.bbox
    left, top, right, bottom = round(b.x), round(b.y), round(b.x + b.w), round(b.y + b.h)
    if right <= left or bottom <= top:
        msg = f"文字 {text.id} 的 bbox 必须有正面积"
        raise ProductionError(msg)
    draw = ImageDraw.Draw(image)
    draw_bubble(draw, (left, top, right - 1, bottom - 1), text.bubble, tail_tip=shout_tail_tip(text))
    if text.bubble == "shout":
        draw_shout_text(
            draw,
            text,
            (left, top, right - 1, bottom - 1),
            font_path,
            font_size_override(text) or page.text_font_size * page.canvas_width / 1024,
            direction=text.direction or page.text_direction,
            reading_direction=page.reading_direction,
        )
        return
    padding = 0.17 if text.bubble in {"speech", "thought", "shout"} else 0.06
    usable_w, usable_h = (
        max(1, (right - left) * (1 - padding * 2)),
        max(1, (bottom - top) * (1 - padding * 2)),
    )
    vertical = (text.direction or page.text_direction) == "vertical"
    # Reflow within the declared box, respecting explicit newlines and column order.
    limit = max(
        1,
        min(
            page.text_max_chars,
            round(math.sqrt(len(text.text) * (usable_h / usable_w if vertical else usable_w / usable_h))),
        ),
    )
    lines = vertical_columns(text.text, page.text_max_chars) if vertical else text_lines(text.text, limit)
    initial_size = font_size_override(text)
    if initial_size is None:
        initial_size = page.text_font_size * page.canvas_width / 1024
    for size in range(max(1, round(initial_size)), 0, -1):
        font = _font(font_path, size)
        if vertical:
            cell_w = cell_h = size
            total_w, total_h = len(lines) * cell_w * 1.2, max(map(len, lines)) * cell_h * 1.1
        else:
            cell_h = max(size, *(draw.textbbox((0, 0), line, font=font)[3] for line in lines)) * 1.2
            total_w, total_h = max(draw.textlength(line, font=font) for line in lines), len(lines) * cell_h
        if total_w <= usable_w and total_h <= usable_h:
            break
    if total_w > usable_w or total_h > usable_h:
        msg = f"文字 {text.id} 的框过小，无法排入原文，请扩大 bbox"
        raise ProductionError(msg)
    x, y = (left + right - total_w) / 2, (top + bottom - total_h) / 2
    if vertical:
        for index, line in enumerate(lines):
            column = len(lines) - 1 - index if page.reading_direction == "rtl" else index
            column_x = x + column * cell_w * 1.2
            for row, char in enumerate(line):
                glyph_font = _font(
                    font_path, max(1, int(size * min(1, cell_w / max(1, draw.textlength(char, font=font)))))
                )
                draw.text(
                    (column_x + cell_w / 2, y + (row + 0.5) * cell_h * 1.1),
                    char,
                    font=glyph_font,
                    fill="black",
                    anchor="mm",
                )
    else:
        for index, line in enumerate(lines):
            draw.text(
                ((left + right - draw.textlength(line, font=font)) / 2, y + index * cell_h),
                line,
                font=font,
                fill="black",
            )


def letter_image(
    image: Image.Image, page: Page, *, font: str | Path | None = None, text_ids: list[str] | None = None
) -> Image.Image:
    texts = [
        t
        for t in layout_texts(page)
        if page.dialogue_mode == "lettering"
        or t.extra.get("render_mode") == "lettering"
        or t.id in (text_ids or [])
    ]
    result = image.copy()
    if not texts:
        return result
    path = find_font(font, cjk=any(not c.isascii() for t in texts for c in t.text))
    for text in texts:
        _draw_text(result, text, page, path)
    return result
