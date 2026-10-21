"""Deterministic Pillow mannequins, drawn into a clipped local image."""

from __future__ import annotations

from typing import TYPE_CHECKING

from PIL import Image, ImageDraw

from .models import POSES, Figure

if TYPE_CHECKING:
    from PIL import ImageFont

    from .models import Character, Page, Panel

FRAMINGS = {
    "extreme_long": "full",
    "long": "full",
    "full": "full",
    "medium": "waist",
    "close_up": "bust",
    "extreme_close_up": "face",
}
POSITIONS = {"left": 0.23, "center": 0.5, "right": 0.77}


def panel_figures(panel: Panel, page: Page) -> list[Figure]:
    if panel.figures:
        return panel.figures
    count = len(panel.character_ids)
    return [
        Figure(
            identifier,
            position=1 - (i + 0.5) / count if page.reading_direction == "rtl" else (i + 0.5) / count,
        )
        for i, identifier in enumerate(panel.character_ids)
    ]


def figure_framing(figure: Figure, shot: str) -> str:
    return figure.framing or FRAMINGS.get(shot, "waist")


def draw_figure(  # noqa: C901, PLR0913 -- explicit pose drawing and rendering options
    image: Image.Image,
    figure: Figure,
    character: Character | None,
    *,
    shot: str,
    color: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    show_name: bool = True,
) -> None:
    """All strokes and the name are clipped by the supplied local image."""
    width, height = image.size
    draw = ImageDraw.Draw(image)
    framing = figure_framing(figure, shot)
    visible = {"full": 1, "waist": 0.59, "bust": 0.43, "face": 0.23}.get(framing, 1)
    unit = min(height * 0.84 / visible, width * 2.8)
    position = POSITIONS.get(figure.position, 0.5) if isinstance(figure.position, str) else figure.position
    cx, top = width * position, height * 0.16
    pose = figure.pose if figure.pose in POSES else "stand"
    mirror = -1 if figure.facing == "left" else 1

    def point(x: float, y: float) -> tuple[float, float]:
        if pose == "lie":
            return width * 0.12 + y * width * 0.76, height * 0.52 + x * height * 0.7
        return cx + x * unit * mirror, top + y * unit

    stroke = max(3, round(min(width, height) * 0.015))

    def line(points: list[tuple[float, float]], *, thin: bool = False) -> None:
        draw.line([point(x, y) for x, y in points], fill=color, width=max(2, stroke // 2) if thin else stroke)

    # A circular head and a directional cross: the offset meridian is the face side.
    hx, hy = point(0, 0.10)
    radius = min(unit * 0.085, width * 0.24)
    draw.ellipse((hx - radius, hy - radius, hx + radius, hy + radius), outline=color, width=stroke)
    back = figure.facing == "back" or pose == "back_view"
    face_offset = 0 if figure.facing in {"front", "back"} else radius * 0.45 * mirror
    draw.line((hx - radius * 0.9, hy, hx + radius * 0.9, hy), fill=color, width=max(2, stroke // 2))
    draw.line(
        (hx + face_offset, hy - radius * 0.9, hx + face_offset, hy + radius * 0.9),
        fill=color,
        width=max(2, stroke // 2),
    )
    if back:
        draw.arc(
            (hx - radius * 0.7, hy - radius * 0.8, hx + radius * 0.7, hy + radius * 0.7),
            185,
            355,
            fill=color,
            width=stroke,
        )
    elif figure.facing in {"left", "right"}:
        nose_x = hx + radius * mirror
        draw.line((nose_x, hy, nose_x + radius * 0.27 * mirror, hy + radius * 0.2), fill=color, width=stroke)
    else:
        for dx in (-0.35, 0.35):
            draw.ellipse((hx + radius * dx - 2, hy - 3, hx + radius * dx + 2, hy + 1), fill=color)

    torso = [(-0.085, 0.22), (0.085, 0.22), (0.07, 0.49), (-0.07, 0.49), (-0.085, 0.22)]
    if pose == "crouch":
        torso = [(-0.10, 0.27), (0.06, 0.22), (0.16, 0.44), (0.02, 0.49), (-0.10, 0.27)]
    line(torso)
    line([(0, 0.18), (0, 0.22)])
    arms = {
        "wave": [[(-0.085, 0.23), (-0.18, 0.36), (-0.19, 0.52)], [(0.085, 0.23), (0.20, 0.28), (0.19, 0.04)]],
        "point": [
            [(-0.085, 0.23), (-0.16, 0.40), (-0.14, 0.54)],
            [(0.085, 0.23), (0.23, 0.24), (0.38, 0.22)],
        ],
        "arms_up": [
            [(-0.085, 0.23), (-0.19, 0.13), (-0.24, 0.01)],
            [(0.085, 0.23), (0.19, 0.13), (0.24, 0.01)],
        ],
        "hands_clasped": [
            [(-0.085, 0.23), (-0.16, 0.44), (0, 0.54)],
            [(0.085, 0.23), (0.16, 0.44), (0, 0.54)],
        ],
        "hand_on_chin": [
            [(-0.085, 0.23), (-0.17, 0.40), (-0.14, 0.53)],
            [(0.085, 0.23), (0.20, 0.31), (0.13, 0.19), (0.02, 0.19)],
        ],
        "run": [[(-0.085, 0.23), (-0.23, 0.38), (-0.31, 0.24)], [(0.085, 0.23), (0.24, 0.12), (0.32, 0.23)]],
    }.get(pose, [[(-0.085, 0.23), (-0.14, 0.39), (-0.17, 0.56)], [(0.085, 0.23), (0.14, 0.39), (0.17, 0.56)]])
    for arm in arms:
        line(arm)
    legs = {
        "walk": [[(-0.04, 0.49), (-0.13, 0.70), (-0.24, 0.94)], [(0.04, 0.49), (0.12, 0.74), (0.25, 0.86)]],
        "run": [[(-0.04, 0.49), (-0.23, 0.69), (-0.35, 0.60)], [(0.04, 0.49), (0.24, 0.73), (0.30, 0.96)]],
        "sit": [[(-0.04, 0.49), (-0.24, 0.58), (-0.23, 0.86)], [(0.04, 0.49), (0.23, 0.58), (0.24, 0.86)]],
        "crouch": [[(0.03, 0.48), (-0.17, 0.62), (0.04, 0.75)], [(0.10, 0.46), (0.27, 0.62), (0.13, 0.75)]],
    }.get(pose, [[(-0.04, 0.49), (-0.07, 0.72), (-0.10, 0.96)], [(0.04, 0.49), (0.07, 0.72), (0.10, 0.96)]])
    if character and character.figure_hint == "skirt":
        line([(-0.07, 0.42), (0.07, 0.42), (0.15, 0.65), (-0.15, 0.65), (-0.07, 0.42)])
    for leg in legs:
        line(leg)
    if pose == "sit":
        line([(-0.27, 0.59), (0.27, 0.59), (0.27, 0.88)], thin=True)
    if not show_name:
        return
    name = character.display_name if character else figure.character_id
    text_width = draw.textlength(name, font=font)
    name_height = draw.textbbox((0, 0), name, font=font)[3]
    draw.text(
        (max(2, min(width - text_width - 2, cx - text_width / 2)), max(2, hy - radius - name_height - 4)),
        name,
        fill=color,
        font=font,
        stroke_width=1,
        stroke_fill="white",
    )
