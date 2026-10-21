# ruff: noqa: RUF001
from __future__ import annotations

from itertools import pairwise
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

from soda_storyboard.compiler import compile_geometry_map, compile_page
from soda_storyboard.figures import draw_figure
from soda_storyboard.lettering import estimate_text_size, vertical_columns
from soda_storyboard.models import Character, Figure, Page, Panel, RectShape, Text
from soda_storyboard.preview import PANEL_COLOR, _draw_text_box, label_position, render_preview
from soda_storyboard.production.lettering import _draw_text


def test_vertical_punctuation_and_balanced_columns() -> None:
    assert vertical_columns("……——，。！？「」『』（）：；", 40) == [list("︙︙︱︱︐︒︕︖﹁﹂﹃﹄︵︶︓︔")]
    columns = vertical_columns("……你在吃什么？", 7)
    assert list(map(len, columns)) == [4, 4]
    assert vertical_columns("你好呀！今天好吗？", 6)[0][-1] == "︕"
    assert vertical_columns("第12话ABC", 10) == [["第", "12", "话", "ABC"]]
    page = Page(text_max_chars=7)
    assert estimate_text_size(Text("t", "……你在吃什么？"), page) == (2 * 42 * 1.3, 4 * 42 * 1.15)


def test_speaker_uses_short_name_and_role_roundtrip() -> None:
    character = Character.from_dict(
        {
            "id": "s",
            "display_name": "Sylvia",
            "age": "14-year-old",
            "appearance_en": "a petite girl",
            "role_en": "the older sister",
        }
    )
    assert Character.from_dict(character.to_dict()).role_en == "the older sister"
    page = Page(texts=[Text("t", "你好", speaker_id="s")])
    caption = compile_page(page, [character])["items"][-1]["caption"]
    assert "next to the older sister" in caption
    assert "petite" not in caption
    assert "14-year-old" not in caption
    character.role_en = None
    assert "next to Sylvia" in compile_page(page, [character])["items"][-1]["caption"]


def test_geometry_pixel_coordinates_round_half_up() -> None:
    page = Page(
        panels=[Panel("p", 1, RectShape(10.5, 20.2, 100.5, 200.8))],
        texts=[Text("t", "你好", bbox=RectShape(12.5, 24.2, 20.5, 60.8))],
    )
    mapping = compile_geometry_map(page)
    panel = mapping["panels"][0]
    assert panel["shape"] == {"type": "rect", "x": 11, "y": 20, "w": 101, "h": 201}
    assert all(type(v) is int for v in panel["generation_rect"].values())
    assert mapping["texts"][0]["bbox"]["x"] == 13


@pytest.mark.parametrize("figures_only", [False, True])
def test_sketch_title_and_name_avoid_text(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, figures_only: bool
) -> None:
    occupied = (10, 10, 180, 200)
    assert label_position((0, 0, 200, 300), (190, 20), [occupied]) is None
    assert label_position((0, 0, 200, 300), (16, 20), [occupied]) is not None
    labels = []
    original = ImageDraw.ImageDraw.text

    def record(draw: ImageDraw.ImageDraw, xy: tuple, text: str, *args: object, **kwargs: object) -> None:
        if kwargs.get("fill") == PANEL_COLOR:
            labels.append((text, draw.textbbox(xy, text, font=kwargs.get("font"), stroke_width=1)))
        original(draw, xy, text, *args, **kwargs)

    monkeypatch.setattr(ImageDraw.ImageDraw, "text", record)
    page = Page(
        panels=[
            Panel(
                "p",
                1,
                RectShape(0, 0, 200, 300),
                description="A very long panel title",
                character_ids=[] if figures_only else ["s"],
                figures=[Figure("s")] if figures_only else [],
            )
        ],
        texts=[Text("t", "你好", bbox=RectShape(10, 10, 170, 190))],
    )
    render_preview(page, tmp_path / "preview.png", [Character("s", "Sylvia")])
    assert labels
    assert any(text.startswith("1") for text, _ in labels)
    assert any(text == "Sylvia" for text, _ in labels)
    for _, box in labels:
        assert min(box[2], occupied[2]) <= max(box[0], occupied[0]) or min(box[3], occupied[3]) <= max(
            box[1], occupied[1]
        )


@pytest.mark.parametrize("pose", ["point", "hand_on_chin", "hands_clasped"])
def test_arms_do_not_cross_torso(pose: str, monkeypatch: pytest.MonkeyPatch) -> None:
    lines = []
    original = ImageDraw.ImageDraw.line

    def record(draw: ImageDraw.ImageDraw, xy: list, *args: object, **kwargs: object) -> None:
        lines.append(xy)
        original(draw, xy, *args, **kwargs)

    monkeypatch.setattr(ImageDraw.ImageDraw, "line", record)
    draw_figure(
        Image.new("RGB", (400, 600), "white"),
        Figure("s", pose=pose),
        None,
        shot="full",
        color="red",
        font=ImageFont.load_default(),
        show_name=False,
    )
    # Recover local mannequin coordinates from the drawn shoulder polylines.
    arms = [
        line
        for line in lines
        if isinstance(line, list) and len(line) in {3, 4} and line[0][1] == pytest.approx(96 + 0.23 * 504)
    ]
    assert len(arms) == 2
    for arm in arms:
        for a, b in pairwise(arm):
            for i in range(1, 20):
                x = (a[0] + (b[0] - a[0]) * i / 20 - 200) / 504
                y = (a[1] + (b[1] - a[1]) * i / 20 - 96) / 504
                if 0.23 < y < 0.49:
                    half_width = 0.085 - (y - 0.22) / 0.27 * 0.015
                    assert abs(x) >= half_width - 0.002


def test_both_renderers_use_vertical_glyphs_and_same_columns(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = []
    original = ImageDraw.ImageDraw.text

    def record(draw: ImageDraw.ImageDraw, xy: tuple, text: str, *args: object, **kwargs: object) -> None:
        calls.append((text, xy))
        original(draw, xy, text, *args, **kwargs)

    monkeypatch.setattr(ImageDraw.ImageDraw, "text", record)
    page = Page(text_max_chars=7)
    text = Text("t", "……你在吃什么？\n12ABC", bbox=RectShape(10, 10, 300, 400))
    expected = [cell for column in vertical_columns(text.text, 7) for cell in column]
    _draw_text(Image.new("RGB", (400, 500)), text, page, None)
    assert [glyph for glyph, _ in calls] == expected
    assert calls[0][1][0] > calls[4][1][0]  # First column on the right.
    calls.clear()
    _draw_text_box(Image.new("RGB", (400, 500)), text, page, None, 1)
    # Preview paints columns in screen order; their contents and lengths agree.
    columns = {}
    for glyph, (x, _) in calls:
        columns.setdefault(x, []).append(glyph)
    assert [columns[x] for x in sorted(columns, reverse=True)] == vertical_columns(text.text, 7)
