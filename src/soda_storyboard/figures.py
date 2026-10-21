"""Deterministic Pillow mannequins, drawn into a clipped local image."""

from __future__ import annotations

from math import cos, radians, sin
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


class _Primitives:
    def __init__(self) -> None:
        self.items: list[dict] = []

    def line(self, points: list | tuple, *, fill: str, width: int) -> None:  # noqa: ARG002 -- Pillow-compatible recorder
        if points and isinstance(points[0], (int, float)):
            points = list(zip(points[::2], points[1::2], strict=True))
        self.items.append({"type": "line", "points": [list(p) for p in points], "width": width})

    def ellipse(
        self,
        box: tuple,
        *,
        outline: str | None = None,
        fill: str | None = None,
        width: int = 1,
    ) -> None:
        x, y, right, bottom = box
        self.items.append(
            {
                "type": "circle",
                "cx": (x + right) / 2,
                "cy": (y + bottom) / 2,
                "r": (right - x) / 2,
                "width": width if outline else 0,
                "fill": fill,
            }
        )

    def arc(self, box: tuple, start: float, end: float, *, fill: str, width: int) -> None:
        x, y, right, bottom = box
        points = [
            (
                (x + right) / 2 + (right - x) / 2 * cos(radians(start + (end - start) * i / 24)),
                (y + bottom) / 2 + (bottom - y) / 2 * sin(radians(start + (end - start) * i / 24)),
            )
            for i in range(25)
        ]
        self.line(points, fill=fill, width=width)


def figure_geometry(  # noqa: C901, PLR0913 -- shared deterministic pose construction
    size: tuple[int, int],
    figure: Figure,
    character: Character | None,
    *,
    shot: str,
    color: str,
    origin: tuple[int, int] = (0, 0),
) -> dict:
    """Return JSON primitives in page coordinates, shared by PNG and editor."""
    width, height = size
    draw = _Primitives()
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
    name = character.display_name if character else figure.character_id
    ox, oy = origin
    for item in draw.items:
        if item["type"] == "circle":
            item["cx"] += ox
            item["cy"] += oy
        else:
            item["points"] = [[x + ox, y + oy] for x, y in item["points"]]
    return {
        "character_id": figure.character_id,
        "label": name,
        "color": color,
        "primitives": draw.items,
        "label_at": [ox + cx, oy + max(2, height * 0.02)],
    }


def draw_figure(  # noqa: PLR0913 -- compatibility drawing API
    image: Image.Image,
    figure: Figure,
    character: Character | None,
    *,
    shot: str,
    color: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    show_name: bool = True,
) -> None:
    geometry = figure_geometry(image.size, figure, character, shot=shot, color=color)
    draw_primitives(image, geometry, font=font, show_name=show_name)


def draw_primitives(
    image: Image.Image,
    geometry: dict,
    *,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    show_name: bool = True,
) -> None:
    draw = ImageDraw.Draw(image)
    color = geometry["color"]
    for item in geometry["primitives"]:
        if item["type"] == "circle":
            x, y, r = item["cx"], item["cy"], item["r"]
            draw.ellipse(
                (x - r, y - r, x + r, y + r),
                outline=color,
                fill=color if item["fill"] else None,
                width=item["width"],
            )
        elif item["type"] == "polygon":
            draw.polygon([tuple(p) for p in item["points"]], outline=color, fill=item.get("fill"))
        else:
            draw.line([tuple(p) for p in item["points"]], fill=color, width=item["width"])
    if show_name and geometry.get("label_visible", True):
        draw.text(
            tuple(geometry["label_at"]),
            geometry["label"],
            fill=color,
            font=font,
            anchor=geometry.get("label_anchor", "mt"),
            stroke_width=1,
            stroke_fill="white",
        )


def panel_figure_geometry(
    panel: Panel,
    page: Page,
    characters: dict[str, Character],
    *,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    scale: float = 1,
) -> dict:
    from .geometry import inscribed_rect, shape_bbox, shape_polygon  # noqa: PLC0415
    from .lettering import layout_texts  # noqa: PLC0415
    from .preview import label_position  # noqa: PLC0415 -- resolved after preview module initialization

    points = [(x * scale, y * scale) for x, y in shape_polygon(panel.shape)]
    left, top = round(min(p[0] for p in points)), round(min(p[1] for p in points))
    right, bottom = round(max(p[0] for p in points)), round(max(p[1] for p in points))
    bounds = tuple(v * scale for v in shape_bbox(inscribed_rect(panel.shape)))
    occupied = [tuple(v * scale for v in shape_bbox(t.bbox)) for t in layout_texts(page) if t.bbox]
    figures = []
    measure = ImageDraw.Draw(Image.new("L", (1, 1)))
    for figure in panel_figures(panel, page):
        data = figure_geometry(
            (max(1, right - left), max(1, bottom - top)),
            figure,
            characters.get(figure.character_id),
            shot=panel.shot,
            color="#00a8c4",
            origin=(left, top),
        )
        box = measure.textbbox((0, 0), data["label"], font=font, stroke_width=1, anchor="lt")
        position = label_position(bounds, (box[2] - box[0], box[3] - box[1]), occupied)
        data["label_visible"] = position is not None
        data["label_anchor"] = "lt"
        if position is not None:
            data["label_at"] = [position[0], position[1]]
            occupied.append(
                (position[0], position[1], position[0] + box[2] - box[0], position[1] + box[3] - box[1])
            )
        figures.append(data)
    return {"panel_id": panel.id, "clip": [list(p) for p in points], "figures": figures}


def sketch_geometry(
    page: Page,
    characters: dict[str, Character],
    *,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont | None = None,
) -> dict:
    """Describe panel clipping and every figure; all coordinates use page pixels."""
    from PIL import ImageFont  # noqa: PLC0415

    from .preview import find_font  # noqa: PLC0415 -- shared preview font selection

    if font is None:
        path = find_font()
        font = ImageFont.truetype(str(path), 22) if path else ImageFont.load_default()
    panels = [
        panel_figure_geometry(p, page, characters, font=font)
        for p in sorted(page.panels, key=lambda p: p.order)
    ]
    return {"canvas": [page.canvas_width, page.canvas_height], "panels": panels}
