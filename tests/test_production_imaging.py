from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image, ImageChops, ImageDraw

from soda_storyboard.models import Figure, Page, Panel, RectShape, Text
from soda_storyboard.production.errors import ProductionError
from soda_storyboard.production.imaging import figure_mask, inset_quad, preserve_text, quad_mask
from soda_storyboard.production.lettering import draw_bubble, find_font, letter_image


def test_mask_margin_feather_and_other_character_protection() -> None:
    panel = Panel(
        "p",
        1,
        RectShape(100, 50, 400, 400),
        figures=[Figure("a", position="left"), Figure("b", position="right")],
    )
    page = Page(panels=[panel])
    tight = figure_mask(panel, page, "a", margin=0, feather=0)
    wide = figure_mask(panel, page, "a", margin=24, feather=0)
    soft = figure_mask(panel, page, "a", margin=24, feather=16)
    assert sum(wide.tobytes()) > sum(tight.tobytes())
    assert any(0 < v < 255 for v in soft.tobytes())
    assert soft.getpixel((92, 200)) > 240
    assert soft.getpixel((308, 200)) == 0
    assert invert_alpha(soft).getpixel((92, 200)) < 15
    with pytest.raises(ProductionError, match="figures"):
        figure_mask(panel, page, "missing")


def invert_alpha(mask: Image.Image) -> Image.Image:
    return mask.point(lambda v: 255 - v)


def test_text_boxes_restored_even_for_page_level_crossing_text() -> None:
    panel = Panel("p", 1, RectShape(100, 100, 200, 200))
    page = Page(
        panels=[panel],
        texts=[
            Text("t", "原文", panel_id="p", bbox=RectShape(110, 110, 50, 40)),
            Text("cross", "title", bbox=RectShape(90, 200, 40, 40)),
        ],
    )
    original = Image.new("RGB", (200, 200), "red")
    new = Image.new("RGB", (200, 200), "blue")
    result = preserve_text(original, new, panel, page)
    assert result.getpixel((20, 20)) == (255, 0, 0)
    assert result.getpixel((10, 120)) == (255, 0, 0)
    assert result.getpixel((150, 150)) == (0, 0, 255)
    page.dialogue_mode = "lettering"
    assert preserve_text(original, new, panel, page).getpixel((20, 20)) == (0, 0, 255)


def test_quad_inset_is_pixel_distance_and_can_reject_collapsed_geometry() -> None:
    points = [[0, 0], [100, 0], [100, 100], [0, 100]]
    assert inset_quad(points, 12) == [(12, 12), (88, 12), (88, 88), (12, 88)]
    assert set(inset_quad(list(reversed(points)), 12)) == set(inset_quad(points, 12))
    with pytest.raises(ProductionError, match="太大"):
        inset_quad(points, 60)
    panel = Panel("p", 1, {"type": "quad", "points": [[0, 30], [100, 0], [100, 100], [0, 100]]})
    raw = quad_mask(panel)
    inset = quad_mask(panel, inset=12)
    assert inset.getpixel((10, 10)) == 0
    assert inset.getpixel((50, 50)) == 255
    assert sum(inset.tobytes()) < sum(raw.tobytes())


@pytest.mark.parametrize("kind", ["speech", "shout", "thought", "box", "none"])
def test_each_bubble_shape(kind: str) -> None:
    image = Image.new("RGB", (200, 200), "grey")
    draw_bubble(ImageDraw.Draw(image), (20, 20, 180, 180), kind)
    assert image.getpixel((100, 100)) == ((128, 128, 128) if kind == "none" else (255, 255, 255))
    if kind in {"box", "none"}:
        assert image.getpixel((20, 20)) == ((0, 0, 0) if kind == "box" else (128, 128, 128))
    else:
        assert image.getpixel((20, 20)) == (128, 128, 128)
    if kind != "none":
        assert (0, 0, 0) in list(image.convert("RGB").get_flattened_data())


@pytest.mark.parametrize("direction", ["horizontal", "vertical"])
@pytest.mark.parametrize("bubble", ["speech", "shout", "thought", "box", "none"])
def test_lettering_fits_explicit_bbox(direction: str, bubble: str) -> None:
    page = Page(
        canvas_width=400,
        canvas_height=400,
        dialogue_mode="lettering",
        text_font_size=30,
        texts=[
            Text("t", "Hello there", direction=direction, bubble=bubble, bbox=RectShape(50, 50, 120, 200))
        ],
    )
    source = Image.new("RGB", (400, 400), "white")
    output = letter_image(source, page)
    difference = ImageChops.difference(output, source)
    bounds = difference.getbbox()
    assert bounds
    assert 50 <= bounds[0] < bounds[2] <= 170
    assert 50 <= bounds[1] < bounds[3] <= 250


def test_only_requested_moss_texts_are_lettered(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    page = Page(texts=[Text("t", "Hello", bbox=RectShape(50, 50, 200, 100))])
    source = Image.new("RGB", (1024, 1536), "grey")
    assert not ImageChops.difference(letter_image(source, page), source).getbbox()
    assert ImageChops.difference(letter_image(source, page, text_ids=["t"]), source).getbbox()
    with pytest.raises(ProductionError, match="字体不存在"):
        find_font(tmp_path / "no-font.ttf")
    monkeypatch.setattr("soda_storyboard.production.lettering.FONT_CANDIDATES", ())
    with pytest.raises(ProductionError, match="找不到中文字体"):
        find_font()
