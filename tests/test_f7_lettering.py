from __future__ import annotations

import pytest
from PIL import Image, ImageDraw

from soda_storyboard.figure_semantics import figure_page_box
from soda_storyboard.lettering import horizontal_lines, text_lines
from soda_storyboard.models import Figure, Page, Panel, RectShape, Text
from soda_storyboard.production.lettering import _draw_text, find_font, fit_horizontal_text
from soda_storyboard.validation import validate_page

# ruff: noqa: RUF001 -- Chinese punctuation is the subject of these regressions.


def test_horizontal_breaks_do_not_isolate_chinese_punctuation() -> None:
    for value in ("放学后，天台。", "她说：「明天，再来！」", "你好，世界！又见面。"):
        lines = text_lines(value, 3)
        assert "".join(lines) == value
        assert all(line[0] not in "。，、？！」』”’）" for line in lines)
        assert all(line[-1] not in "「『“‘（" for line in lines)


def test_wrapping_uses_glyph_width_and_preserves_explicit_newlines() -> None:
    def measure(value: str) -> float:
        return sum(14 if char == "W" else 3 for char in value)

    assert horizontal_lines("WWiiiiW", 40, measure) == ["WWiiii", "W"]
    assert text_lines("你好\n\n世界", 2) == ["你好", "", "世界"]
    # A punctuation pair stays indivisible; the caller must shrink its font.
    assert horizontal_lines("好！", 1, len) == ["好！"]


def test_long_horizontal_passage_wraps_at_measured_width() -> None:
    draw = ImageDraw.Draw(Image.new("RGB", (150, 160)))
    content = "Wide words, small letters. A long passage needs several rows."
    layout = fit_horizontal_text(draw, content, None, 28, width=140, height=150)
    assert len(layout.lines) > 1
    assert "".join(layout.lines) == content
    assert layout.width <= 140
    assert layout.height <= 150


def test_rooftop_narration_shrinks_before_wrapping(monkeypatch: pytest.MonkeyPatch) -> None:
    font_path = find_font(cjk=False)
    if font_path is None:
        pytest.skip("CJK font is optional on CI")
    calls = []
    original = ImageDraw.ImageDraw.text

    def record(draw: ImageDraw.ImageDraw, xy: tuple, text: str, *args: object, **kwargs: object) -> None:
        calls.append((text, kwargs["font"].size))
        original(draw, xy, text, *args, **kwargs)

    monkeypatch.setattr(ImageDraw.ImageDraw, "text", record)
    page = Page(text_font_size=42, text_max_chars=10)
    text = Text(
        "t1",
        "放学后，天台。",
        kind="narration",
        direction="horizontal",
        bubble="box",
        bbox=RectShape(0, 0, 250, 52),
    )
    _draw_text(Image.new("RGB", (250, 52), "white"), text, page, font_path)
    assert [value for value, _ in calls] == [text.text]
    assert 27 <= calls[0][1] < 42


def test_rooftop_p6_foreign_speaker_overlap_is_only_a_warning() -> None:
    page = Page(
        panels=[
            Panel(
                "p6",
                1,
                RectShape(46, 1085.3623188405795, 454, 404.63768115942025),
                figures=[Figure("sylvia", position="left"), Figure("whale", position="right")],
            )
        ],
        texts=[
            Text(
                "t6",
                "这是……我？",
                panel_id="p6",
                speaker_id="sylvia",
                bbox=RectShape(400, 1110, 72, 260),
            )
        ],
    )
    report = validate_page(page)
    warnings = [issue for issue in report.warnings if issue.code == "text_overlaps_figure"]
    assert report.valid
    assert len(warnings) == 1
    assert "第 1 格文字可能遮挡人物" in warnings[0].message
    assert "sylvia" in warnings[0].message
    assert "whale" in warnings[0].message
    assert warnings[0].details["speaker_mismatch"] is True


@pytest.mark.parametrize(("kind", "warns"), [("dialogue", True), ("narration", True), ("sfx", False)])
def test_editor_geometry_controls_overlap_warning(kind: str, *, warns: bool) -> None:
    figure = Figure("girl", extra={"editor": {"x": 180, "y": 250, "size": 200}})
    panel = Panel("p", 1, RectShape(100, 100, 300, 400), figures=[figure])
    left, top, right, bottom = figure_page_box(figure, panel)
    page = Page(
        panels=[panel],
        texts=[
            Text(
                "t",
                "你好",
                kind=kind,
                speaker_id="girl",
                panel_id="p",
                bbox=RectShape(left, top, right - left, bottom - top),
            )
        ],
    )
    original = page.to_dict()
    warnings = [issue for issue in validate_page(page).warnings if issue.code == "text_overlaps_figure"]
    assert bool(warnings) is warns
    assert page.to_dict() == original
    if warns:
        assert warnings[0].details["speaker_mismatch"] is False
        assert warnings[0].details["overlap_ratio"] == pytest.approx(1)
    # Keep the text in place and move only the persisted editor rig.
    figure.extra["editor"]["x"] = 20
    assert not any(issue.code == "text_overlaps_figure" for issue in validate_page(page).warnings)


def test_overlap_threshold_ignores_small_contacts_and_dict_input_works() -> None:
    figure = Figure("girl", extra={"bbox": {"x": 100, "y": 100, "w": 100, "h": 200}})
    page = Page(
        panels=[Panel("p", 1, RectShape(0, 0, 400, 400), figures=[figure])],
        texts=[Text("t", "你好", panel_id="p", bbox=RectShape(190, 100, 100, 100))],
    )
    assert not any(issue.code == "text_overlaps_figure" for issue in validate_page(page).warnings)
    page.texts[0].bbox.x = 170
    report = validate_page(page.to_dict())
    assert report.valid
    assert any(issue.code == "text_overlaps_figure" for issue in report.warnings)
