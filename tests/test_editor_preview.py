from __future__ import annotations

import json
from pathlib import Path

import pytest
from PIL import Image, ImageChops

from soda_storyboard.models import Figure, Page, Panel, RectShape, Text
from soda_storyboard.preview import _draw_text_box, render_preview
from soda_storyboard.production.lettering import _draw_text, font_size_override


def _text(**updates: object) -> Text:
    return Text.from_dict(
        {
            "id": "test-text",
            "text": "ABC",
            "bubble": "none",
            "direction": "horizontal",
            "bbox": {"type": "rect", "x": 20, "y": 30, "w": 180, "h": 100},
            **updates,
        }
    )


def test_transparent_preview_text_preserves_underlying_pixels() -> None:
    image = Image.new("RGB", (240, 180), "#a6485c")
    source = image.copy()
    _draw_text_box(image, _text(font_size=24), Page(), None, 1)
    assert image.getpixel((21, 31)) == source.getpixel((21, 31))
    assert image.getpixel((190, 120)) == source.getpixel((190, 120))
    assert ImageChops.difference(image, source).getbbox()
    assert (255, 255, 255) not in image.get_flattened_data()


@pytest.mark.parametrize("bubble", ["speech", "thought", "shout", "box", "none"])
def test_preview_uses_actual_bubble_shape_without_opaque_corners(bubble: str) -> None:
    image = Image.new("RGB", (240, 180), "#a6485c")
    source_color = image.getpixel((0, 0))
    _draw_text_box(image, _text(bubble=bubble), Page(), None, 1)
    if bubble != "box":
        assert image.getpixel((20, 30)) == source_color
    else:
        assert image.getpixel((30, 40)) == (255, 255, 255)
    if bubble not in {"none", "box"}:
        assert image.getpixel((110, 55)) == (255, 255, 255)


def test_break_frame_figure_is_drawn_outside_panel_after_save(tmp_path: Path) -> None:
    figure = Figure.from_dict(
        {
            "character_id": "girl",
            "id": "freely-placed",
            "editor": {
                "version": 1,
                "x": 60,
                "y": 210,
                "size": 100,
                "style": "stick",
                "break_frame": True,
            },
        }
    )
    page = Page(
        canvas_width=320,
        canvas_height=360,
        panels=[
            Panel("p1", 1, RectShape(80, 80, 120, 160), figures=[figure]),
        ],
    )
    saved = Page.from_dict(json.loads(json.dumps(page.to_dict())))
    broken = Image.open(render_preview(saved, tmp_path / "break.png"))
    assert broken.getpixel((130, 289)) == (0, 168, 196)
    half = Image.open(render_preview(saved, tmp_path / "half.png", scale=0.5))
    assert half.getpixel((65, 144)) == (0, 168, 196)
    saved.panels[0].figures[0].extra["editor"]["break_frame"] = False
    ordinary = Image.open(render_preview(saved, tmp_path / "clipped.png"))
    assert ordinary.getpixel((130, 289)) == (255, 255, 255)
    assert saved.panels[0].figures[0].extra["id"] == "freely-placed"


def test_font_override_is_used_in_both_preview_and_production() -> None:
    page = Page(canvas_width=400, canvas_height=400)
    for renderer in (
        lambda image, text: _draw_text_box(image, text, page, None, 1),
        lambda image, text: _draw_text(image, text, page, None),
    ):
        small = Image.new("RGB", (240, 180), "white")
        large = small.copy()
        renderer(small, _text(font_size=20))
        renderer(large, _text(font_size=32))
        assert sum(pixel != (255, 255, 255) for pixel in large.get_flattened_data()) > sum(
            pixel != (255, 255, 255) for pixel in small.get_flattened_data()
        )


@pytest.mark.parametrize("value", [None, False, -1, 0, "24", float("inf"), float("nan"), 10**1000])
def test_font_override_rejects_invalid_numbers(value: object) -> None:
    assert font_size_override(_text(font_size=value)) is None


def test_font_extension_metadata_roundtrips_without_migration() -> None:
    original = _text(font_size=24, tail_tip=[145.5, 201], render_mode="lettering").to_dict()
    saved = Text.from_dict(json.loads(json.dumps(original)))
    assert saved.to_dict() == original
    assert font_size_override(saved) == 24
    assert font_size_override(_text(font_size=10000)) == 512
