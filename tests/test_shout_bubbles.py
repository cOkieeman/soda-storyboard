# ruff: noqa: RUF001 -- CJK punctuation tests the actual manga text layout
from __future__ import annotations

import math

import pytest
from PIL import Image, ImageChops, ImageDraw

from soda_storyboard.bubble_geometry import layout_shout_text, shout_bubble_points
from soda_storyboard.models import Page, RectShape, Text
from soda_storyboard.preview import _draw_text_box
from soda_storyboard.production.lettering import _draw_text, draw_bubble, shout_tail_tip


@pytest.mark.parametrize(("width", "height"), [(110, 200), (200, 150), (70, 300), (300, 70)])
def test_shout_spikes_keep_pixel_depth_and_even_perimeter_spacing(width: int, height: int) -> None:
    points = shout_bubble_points(width, height)
    peaks = points[::2]
    gaps = [math.dist(point, peaks[(index + 1) % len(peaks)]) for index, point in enumerate(peaks)]
    assert max(gaps) / min(gaps) < 1.45
    assert all(0 <= x <= width and 0 <= y <= height for x, y in points)
    assert points[0] == pytest.approx((width / 2, 1))
    tailed = shout_bubble_points(width, height, tail_tip=(width / 2, 5000))
    assert max(y for _, y in tailed) <= height + min(40, width * 0.25, height * 0.25)
    assert shout_bubble_points(width, height, tail_tip=(width / 2, height / 2)) == points


def test_portrait_shout_centers_three_characters_without_reducing_readability() -> None:
    layout = layout_shout_text(110, 200, "新台词", "vertical", 20)
    assert layout.font_size == 20
    assert layout.columns == [["新", "台", "词"]]
    assert layout.content_x + layout.cell_width / 2 == 55
    assert layout.content_y + len(layout.columns[0]) * layout.cell_height / 2 == 100
    long = layout_shout_text(110, 200, "这一句很长的喊话也应该留在气泡里面！", "vertical", 28)
    assert long.cell_width * len(long.columns) <= long.area[2]
    assert long.cell_height * max(map(len, long.columns)) <= long.area[3]
    assert (
        "".join(glyph for column in long.columns for glyph in column)
        == "这一句很长的喊话也应该留在气泡里面︕"
    )


@pytest.mark.parametrize("value", [None, False, [1], ["3", 4], [False, 2], [10**1000, 1], [float("nan"), 1]])
def test_shout_ignores_malformed_optional_tail(value: object) -> None:
    assert shout_tail_tip(Text("t", "shout", extra={"tail_tip": value})) is None


@pytest.mark.parametrize("direction", ["vertical", "horizontal"])
def test_preview_and_lettering_place_shout_text_in_same_centered_area(
    direction: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("soda_storyboard.preview.TEXT_COLOR", "black")
    text = Text(
        "shout",
        "ABC\nDEF" if direction == "horizontal" else "ABC",
        bubble="shout",
        direction=direction,
        bbox=RectShape(
            20, 20, 110 if direction == "vertical" else 200, 200 if direction == "vertical" else 150
        ),
        extra={"font_size": 20},
    )
    page = Page()
    preview = Image.new("RGB", (260, 260), "#aaaaaa")
    production = preview.copy()
    _draw_text_box(preview, text, page, None, 1)
    _draw_text(production, text, page, None)
    assert text.bbox is not None
    b = text.bbox
    blank = Image.new("RGB", preview.size, "#aaaaaa")
    draw_bubble(ImageDraw.Draw(blank), (20, 20, round(20 + b.w - 1), round(20 + b.h - 1)), "shout")
    # Crop away the border: identical glyph pixels prove both renderers use the same layout.
    area = layout_shout_text(b.w, b.h, text.text, direction, 20).area
    crop = (
        round(20 + area[0]),
        round(20 + area[1]),
        round(20 + area[0] + area[2]),
        round(20 + area[1] + area[3]),
    )
    assert ImageChops.difference(production.crop(crop), blank.crop(crop)).getbbox()
    assert preview.crop(crop).tobytes() == production.crop(crop).tobytes()
