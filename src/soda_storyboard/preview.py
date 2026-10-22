"""Render a readable wireframe PNG preview with Pillow."""

from __future__ import annotations

import warnings
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import TYPE_CHECKING

from .figures import draw_figure, draw_primitives, panel_figure_geometry
from .geometry import inscribed_rect, shape_bbox
from .lettering import layout_texts, text_lines, vertical_columns
from .models import Character, Figure, Page, Panel

if TYPE_CHECKING:
    from PIL import Image, ImageDraw, ImageFont

    from .models import Overlay, Text


def _draw_overlay(
    draw: ImageDraw.ImageDraw,
    overlay: Overlay,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    scale: float,
) -> None:
    rect = overlay.rect
    left, top, right, bottom = [round(v * scale) for v in (rect.x, rect.y, rect.x + rect.w, rect.y + rect.h)]
    dash = max(4, round(10 * scale))
    for start, end in (
        ((left, top), (right, top)),
        ((right, top), (right, bottom)),
        ((left, bottom), (right, bottom)),
        ((left, top), (left, bottom)),
    ):
        distance = max(abs(end[0] - start[0]), abs(end[1] - start[1]))
        for offset in range(0, distance, dash * 2):
            finish = min(offset + dash, distance)
            a = (
                start[0] + (end[0] - start[0]) * offset / distance,
                start[1] + (end[1] - start[1]) * offset / distance,
            )
            b = (
                start[0] + (end[0] - start[0]) * finish / distance,
                start[1] + (end[1] - start[1]) * finish / distance,
            )
            draw.line((a, b), fill="#059669", width=max(2, round(3 * scale)))
    draw.text(
        (left + 6 * scale, top + 6 * scale),
        f"出格 {overlay.id}",
        fill="#047857",
        font=font,
        stroke_width=2,
        stroke_fill="white",
    )


def find_font(font: str | Path | None = None) -> Path | None:
    candidates = [
        Path(font) if font else None,
        Path(r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\msyhbd.ttc"),
        Path(r"C:\Windows\Fonts\simhei.ttf"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    return next((candidate for candidate in candidates if candidate and candidate.exists()), None)


def _character_names(panel: Panel, characters: Mapping[str, Character] | None) -> str:
    identifiers = list(
        dict.fromkeys([*panel.character_ids, *(figure.character_id for figure in panel.figures)])
    )
    if not identifiers:
        return ""
    if not characters:
        return ", ".join(identifiers)
    return ", ".join(
        characters.get(identifier, Character(identifier, identifier)).display_name
        for identifier in identifiers
    )


def _draw_dialogue(
    draw: ImageDraw.ImageDraw,
    panel: Panel,
    origin: tuple[int, int],
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    scale: float,
) -> None:
    left, top = origin

    def s(value: float) -> int:
        return round(value * scale)

    for index, dialogue in enumerate(panel.dialogue):
        bubble_left = left + s(12)
        bubble_top = top + s(60 + index * 48)
        bubble_right = bubble_left + max(s(120), s(min(260, 16 + len(dialogue.text) * 16)))
        bubble_bottom = bubble_top + s(34)
        draw.rounded_rectangle(
            (bubble_left, bubble_top, bubble_right, bubble_bottom),
            radius=max(3, s(8)),
            outline="#dc2626",
            width=max(1, s(2)),
        )
        draw.text((bubble_left + s(6), bubble_top + s(5)), dialogue.text[:18], fill="#991b1b", font=font)


def render_preview(  # noqa: PLR0912, PLR0913 -- retain existing keyword API and boxes renderer
    page: Page,
    output: str | Path,
    characters: Mapping[str, Character] | Iterable[Character] | None = None,
    *,
    font: str | Path | None = None,
    scale: float = 1.0,
    style: str = "sketch",
) -> Path:
    """Render ``page`` to ``output`` and return the resulting path."""

    try:
        from PIL import Image, ImageDraw, ImageFont  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - exercised only without optional dependency
        raise RuntimeError("preview 需要 Pillow，请先安装 Pillow") from exc

    if style not in {"sketch", "boxes"} or scale <= 0:
        raise ValueError("style must be sketch/boxes and scale must be positive")
    if style == "sketch":
        return _render_sketch(page, output, characters, font=font, scale=scale)

    character_map = (
        {character.id: character for character in characters}
        if characters is not None and not isinstance(characters, Mapping)
        else dict(characters or {})
    )
    width = max(1, int(page.canvas_width * scale))
    height = max(1, int(page.canvas_height * scale))
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    font_path = find_font(font)
    if font and font_path is None:
        raise FileNotFoundError(f"找不到字体文件：{font}")
    if font_path is None:
        warnings.warn(
            "未找到中文字体，将使用 Pillow 默认字体；可通过 --font 指定字体文件", RuntimeWarning, stacklevel=2
        )
    if font_path:
        label_font = ImageFont.truetype(str(font_path), max(12, int(18 * scale)))
        small_font = ImageFont.truetype(str(font_path), max(10, int(13 * scale)))
    else:
        label_font = ImageFont.load_default()
        small_font = label_font

    def s(value: float) -> int:
        return round(value * scale)

    for panel in sorted(page.panels, key=lambda item: item.order):
        shape = panel.shape
        shape_type = shape.get("type", "rect") if isinstance(shape, Mapping) else "rect"
        if shape_type == "quad":
            raw_points = shape.get("points", [])
            points = [(s(float(point[0])), s(float(point[1]))) for point in raw_points]
            if len(points) == 4:
                draw.polygon(points, outline="#1d4ed8", width=max(2, s(4)))
                left = min(point[0] for point in points)
                top = min(point[1] for point in points)
            else:
                continue
        else:
            x = float(shape.get("x", 0))
            y = float(shape.get("y", 0))
            w = float(shape.get("w", shape.get("width", 0)))
            h = float(shape.get("h", shape.get("height", 0)))
            left, top = s(x), s(y)
            draw.rectangle((left, top, s(x + w), s(y + h)), outline="#1d4ed8", width=max(2, s(4)))
        title = f"{panel.order}  {panel.shot} / {panel.angle}"
        names = _character_names(panel, character_map)
        detail = " · ".join(part for part in (names, panel.description[:28]) if part)
        draw.text((left + s(8), top + s(8)), title, fill="#111827", font=label_font)
        if detail:
            draw.text((left + s(8), top + s(32)), detail, fill="#374151", font=small_font)
        _draw_dialogue(draw, panel, (left, top), small_font, scale)
    for overlay in sorted(page.overlays, key=lambda overlay: overlay.z_index):
        _draw_overlay(draw, overlay, label_font, scale)
    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)
    return output_path


__all__ = ["find_font", "render_preview"]


PANEL_COLOR = "#00a8c4"
CHARACTER_COLOR = "#dc302a"
TEXT_COLOR = "#229646"


def _paste_panel_figures(  # noqa: PLR0913 -- explicit local drawing context
    image: Image.Image,
    panel: Panel,
    page: Page,
    characters: Mapping[str, Character],
    *,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    scale: float,
) -> None:
    from PIL import Image, ImageChops, ImageDraw  # noqa: PLC0415

    layer = Image.new("RGBA", image.size)
    data = panel_figure_geometry(panel, page, characters, font=font, scale=scale)
    for geometry in data["figures"]:
        if not geometry.get("break_frame", False):
            draw_primitives(layer, geometry, font=font)
    mask = Image.new("L", layer.size)
    md = ImageDraw.Draw(mask)
    points = [tuple(p) for p in data["clip"]]
    md.polygon(points, fill=255)
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    image.paste(layer, (0, 0), layer)


def _draw_text_box(image: Image.Image, text: Text, page: Page, font_path: Path | None, scale: float) -> None:
    from PIL import Image, ImageDraw, ImageFont  # noqa: PLC0415

    from .production.lettering import (  # noqa: PLC0415
        draw_bubble,
        draw_shout_text,
        font_size_override,
        shout_tail_tip,
    )

    rect = text.bbox
    if rect is None:
        return
    width, height = max(1, round(rect.w * scale)), max(1, round(rect.h * scale))
    if text.bubble == "shout":
        # Draw directly on the page so an explicit short tail is not clipped by the text bbox.
        left, top = round(rect.x * scale), round(rect.y * scale)
        box = (left, top, left + width - 1, top + height - 1)
        draw = ImageDraw.Draw(image)
        draw_bubble(
            draw,
            box,
            "shout",
            max(1, round(2 * scale)),
            outline=TEXT_COLOR,
            tail_tip=shout_tail_tip(text, scale),
        )
        draw_shout_text(
            draw,
            text,
            box,
            str(font_path) if font_path else None,
            (font_size_override(text) or page.text_font_size * page.canvas_width / 1024) * scale,
            direction=text.direction or page.text_direction,
            color=TEXT_COLOR,
            reading_direction=page.reading_direction,
        )
        return
    layer = Image.new("RGBA", (width, height))
    draw = ImageDraw.Draw(layer)
    color = CHARACTER_COLOR if text.kind == "title" else TEXT_COLOR
    draw_bubble(
        draw,
        (0, 0, width - 1, height - 1),
        text.bubble,
        max(2, round(3 * scale)),
        outline=color,
    )
    vertical = (text.direction or page.text_direction) == "vertical"
    lines = (
        vertical_columns(text.text, page.text_max_chars)
        if vertical
        else text_lines(text.text, page.text_max_chars)
    )
    longest = max(1, *map(len, lines))
    pad_x, pad_y = (
        (width * 0.17, height * 0.17)
        if text.bubble in {"speech", "thought", "shout"}
        else (4 * scale, 4 * scale)
    )
    available_w, available_h = max(1, width - pad_x * 2), max(1, height - pad_y * 2)
    cell_w = available_w / (len(lines) if vertical else longest)
    cell_h = available_h / (longest if vertical else len(lines))
    size = max(1, int(min(cell_w, cell_h) * 0.88))
    explicit_size = font_size_override(text)
    if explicit_size is not None:
        size = max(1, min(size, round(explicit_size * scale)))
    font = ImageFont.truetype(str(font_path), size) if font_path else ImageFont.load_default(size=size)
    if vertical:
        ordered = list(reversed(lines)) if page.reading_direction == "rtl" else lines
        for column, line in enumerate(ordered):
            for row, glyph in enumerate(line):
                glyph_size = max(
                    1, int(size * min(1, cell_w * 0.88 / max(1, draw.textlength(glyph, font=font))))
                )
                glyph_font = (
                    ImageFont.truetype(str(font_path), glyph_size)
                    if font_path
                    else ImageFont.load_default(size=glyph_size)
                )
                draw.text(
                    (pad_x + (column + 0.5) * cell_w, pad_y + (row + 0.5) * cell_h),
                    glyph,
                    fill=color,
                    font=glyph_font,
                    anchor="mm",
                )
    else:
        for row, line in enumerate(lines):
            draw.text((pad_x, pad_y + (row + 0.5) * cell_h), line, fill=color, font=font, anchor="lm")
    image.paste(layer, (round(rect.x * scale), round(rect.y * scale)), layer)


def _render_sketch(  # noqa: PLR0912 -- labels, figures, overlays and lettering passes
    page: Page,
    output: str | Path,
    characters: Mapping[str, Character] | Iterable[Character] | None,
    *,
    font: str | Path | None,
    scale: float,
) -> Path:
    from PIL import Image, ImageDraw, ImageFont  # noqa: PLC0415

    character_map = (
        dict(characters or {})
        if isinstance(characters, Mapping) or characters is None
        else {c.id: c for c in characters}
    )
    font_path = find_font(font)
    if font and not Path(font).exists():
        raise FileNotFoundError(f"找不到字体文件：{font}")
    if font_path is None:
        warnings.warn("未找到中文字体，可通过 --font 指定字体文件", RuntimeWarning, stacklevel=2)
    label_font = (
        ImageFont.truetype(str(font_path), max(12, round(22 * scale)))
        if font_path
        else ImageFont.load_default()
    )
    image = Image.new(
        "RGB", (max(1, round(page.canvas_width * scale)), max(1, round(page.canvas_height * scale))), "white"
    )
    for panel in sorted(page.panels, key=lambda p: p.order):
        _paste_panel_figures(image, panel, page, character_map, font=label_font, scale=scale)
        draw = ImageDraw.Draw(image)
        x, y, x2, y2 = [round(v * scale) for v in shape_bbox(panel.shape)]
        if panel.shape_type == "quad":
            draw.polygon(
                [(round(px * scale), round(py * scale)) for px, py in panel.shape["points"]],
                outline=PANEL_COLOR,
                width=max(3, round(4 * scale)),
            )
        else:
            draw.rectangle((x, y, x2, y2), outline=PANEL_COLOR, width=max(3, round(4 * scale)))
    # Figures explicitly marked to cross a frame must sit above every panel border.
    for panel in sorted(page.panels, key=lambda p: p.order):
        data = panel_figure_geometry(panel, page, character_map, font=label_font, scale=scale)
        for geometry in data["figures"]:
            if geometry.get("break_frame", False):
                draw_primitives(image, geometry, font=label_font)
    for overlay in sorted(page.overlays, key=lambda o: o.z_index):
        rect = overlay.rect
        x, y, x2, y2 = [round(v * scale) for v in (rect.x, rect.y, rect.x + rect.w, rect.y + rect.h)]
        if overlay.mode == "moss":
            layer = Image.new("RGBA", (max(1, x2 - x), max(1, y2 - y)))
            draw_figure(
                layer,
                Figure(overlay.character_id, pose="arms_up"),
                character_map.get(overlay.character_id),
                shot="full",
                color=CHARACTER_COLOR,
                font=label_font,
                show_name=False,
            )
            image.paste(layer, (x, y), layer)
            ImageDraw.Draw(image).rectangle(
                (x, y, x2, y2), outline=CHARACTER_COLOR, width=max(3, round(4 * scale))
            )
        else:
            _draw_overlay(ImageDraw.Draw(image), overlay, label_font, scale)
    for text in layout_texts(page):
        _draw_text_box(image, text, page, font_path, scale)
    draw = ImageDraw.Draw(image)
    occupied = [tuple(v * scale for v in shape_bbox(t.bbox)) for t in layout_texts(page) if t.bbox]
    for panel in page.panels:
        occupied.extend(
            draw.textbbox(
                tuple(figure["label_at"]),
                figure["label"],
                font=label_font,
                anchor="lt",
                stroke_width=1,
            )
            for figure in panel_figure_geometry(panel, page, character_map, font=label_font, scale=scale)[
                "figures"
            ]
            if figure["label_visible"]
        )
    for panel in sorted(page.panels, key=lambda p: p.order):
        label_shape = inscribed_rect(panel.shape) if panel.shape_type == "quad" else panel.shape
        bounds = tuple(v * scale for v in shape_bbox(label_shape))
        labels = [
            (f"{panel.order}  {panel.description[:16]}", str(panel.order)),
        ]
        for full, fallback in labels:
            for label in dict.fromkeys((full, fallback)):
                if not label:
                    continue
                box = draw.textbbox((0, 0), label, font=label_font, stroke_width=1)
                position = label_position(bounds, (box[2] - box[0], box[3] - box[1]), occupied)
                if position is not None:
                    left, top = position
                    draw.text(
                        (left - box[0], top - box[1]),
                        label,
                        font=label_font,
                        fill=PANEL_COLOR,
                        stroke_width=1,
                        stroke_fill="white",
                    )
                    occupied.append((left, top, left + box[2] - box[0], top + box[3] - box[1]))
                    break
    output_path = Path(output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)
    return output_path


def label_position(
    bounds: tuple[float, ...], size: tuple[float, float], occupied: list[tuple[float, ...]]
) -> tuple[float, float] | None:
    """Find a free label rectangle; callers can retry with just a panel number."""
    x, y, right, bottom = bounds
    width, height = size
    step = max(4, round(height + 4))
    for top in range(round(y + 8), round(bottom - height - 4), step):
        for left in (x + 8, right - width - 8):
            if left < x + 4 or left + width > right - 4:
                continue
            candidate = (left - 2, top - 2, left + width + 2, top + height + 2)
            if all(
                min(candidate[2], b[2]) <= max(candidate[0], b[0])
                or min(candidate[3], b[3]) <= max(candidate[1], b[1])
                for b in occupied
            ):
                return left, float(top)
    return None
