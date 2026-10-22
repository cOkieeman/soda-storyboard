from __future__ import annotations

import json
from pathlib import Path

import pytest
from PIL import Image, ImageChops, ImageDraw

from soda_storyboard.cli import main
from soda_storyboard.compiler import compile_page
from soda_storyboard.figures import draw_figure, figure_framing, panel_figures
from soda_storyboard.io import load_characters, load_page, read_json, write_json
from soda_storyboard.lettering import estimate_text_size, layout_texts, page_texts
from soda_storyboard.models import (
    POSES,
    Character,
    Dialogue,
    Figure,
    Lora,
    Overlay,
    Page,
    Panel,
    Project,
    RectShape,
    Text,
)
from soda_storyboard.preview import PANEL_COLOR, find_font, render_preview
from soda_storyboard.validation import validate_page


def test_new_fields_roundtrip_and_legacy_conversion() -> None:
    page = Page(
        panels=[
            Panel(
                "p",
                1,
                RectShape(20, 20, 500, 900),
                dialogue=[Dialogue("girl", "你好", "narration")],
                sfx=["砰"],
                figures=[Figure("girl", "sit", 0.3, "left", "full")],
                caption_en="A kitchen scene",
            )
        ],
        texts=[Text("t", "原文\n保留", bbox=RectShape(30, 30, 70, 300))],
        style_prompt="Soft cel shading.",
        tags=["kitchen"],
    )
    assert Page.from_dict(page.to_dict()) == page
    texts = page_texts(page)
    assert [text.text for text in texts] == ["原文\n保留", "你好", "砰"]
    assert texts[1].bubble == "box"
    assert texts[1].kind == "narration"
    assert texts[1].panel_id == "p"
    compiled = compile_page(page)
    assert [item["text"] for item in compiled["items"] if item["label"] == "text"] == [t.text for t in texts]
    assert all("你好" not in item["caption"] for item in compiled["items"])
    assert Page.from_dict(page.to_dict()) == page  # Conversion must not mutate source.
    character = Character("girl", "女孩", age="20-year-old", figure_hint="skirt")
    assert Character.from_dict(character.to_dict()) == character
    project = Project(style_prompt="Painterly.", tags=["2girls"])
    assert Project.from_dict(project.to_dict()) == project


@pytest.mark.parametrize("direction", ["vertical", "horizontal"])
def test_measurement_wraps_and_keeps_orientation(direction: str) -> None:
    page = Page(text_direction=direction)
    w, h = estimate_text_size(Text("a", "一" * 11), page)
    if direction == "vertical":
        assert w == pytest.approx(2 * 42 * 1.3)
        assert h == pytest.approx(6 * 42 * 1.15)
    else:
        assert w == pytest.approx(10 * 42 * 1.15)
        assert h == pytest.approx(2 * 42 * 1.3)
    # Explicit newlines remain intentional column boundaries.
    explicit = estimate_text_size(Text("a", "一" * 10 + "\n一"), page)
    if direction == "vertical":
        assert explicit == pytest.approx((w, 10 * 42 * 1.15))
    else:
        assert explicit == (w, h)
    page.text_max_chars = 5
    assert estimate_text_size(Text("a", "一" * 11), page) != (w, h)
    page.text_font_size = 21
    small = estimate_text_size(Text("a", "一" * 11), page)
    page.text_font_size = 42
    assert estimate_text_size(Text("a", "一" * 11), page) == pytest.approx(tuple(2 * v for v in small))


def test_automatic_boxes_fit_panel_and_explicit_boxes_warn() -> None:
    page = Page(
        panels=[Panel("p", 1, RectShape(10, 10, 180, 140))], texts=[Text("t", "很长的台词" * 5, panel_id="p")]
    )
    rect = layout_texts(page)[0].bbox
    assert rect is not None
    assert 10 <= rect.x < rect.x + rect.w <= 190
    assert 10 <= rect.y < rect.y + rect.h <= 150
    page.texts[0].bbox = RectShape(20, 20, 160, 40)
    assert "text_direction_bbox_mismatch" in {i.code for i in validate_page(page).warnings}
    page.texts[0].direction = "horizontal"
    assert "text_direction_bbox_mismatch" not in {i.code for i in validate_page(page).warnings}
    page.texts[0].bbox = RectShape(20, 20, 40, 160)
    assert "text_direction_bbox_mismatch" in {i.code for i in validate_page(page).warnings}


def test_overlay_modes_and_clean_size_diagnostics(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    overlay = Overlay("hero", "girl", RectShape(50, 50, 200, 600))
    assert overlay.mode == "moss"
    page = Page(overlays=[overlay], style_prompt="Painterly manga.")
    assert compile_page(page)["items"][0]["label"] == "character"
    overlay.mode = "layer"
    assert compile_page(page)["items"] == []
    legacy = overlay.to_dict()
    legacy.pop("mode")
    assert Overlay.from_dict(legacy).mode == "layer"
    page.overlays = []
    path = write_json(tmp_path / "pages/p.json", page)
    output = tmp_path / "output.json"
    assert (
        main(
            ["compile", str(path), "--output", str(output), "--size-check", "512x768", "--with-ids", "--json"]
        )
        == 0
    )
    report = json.loads(capsys.readouterr().out)
    assert report["size_check"]["matches"] is False
    assert "size_check" not in read_json(output)
    assert read_json(output.with_suffix(".map.json"))["size_check"] == report["size_check"]
    assert "size_check" not in compile_page(page, size_check=(1024, 1536))


def test_pudding_matches_reference_contract() -> None:
    page = load_page("examples/pudding/pages/pudding.json")
    characters = load_characters("examples/pudding/characters")
    assert validate_page(page, characters).valid
    result = compile_page(page, characters, with_ids=True)
    reference = read_json("tests/fixtures/pudding-example-style.moss.json")
    assert set(result) == {"summary", "items", "bbox_coord_space", "bbox_format"}
    assert result["summary"]["caption"].startswith(page.style_prompt)
    assert result["summary"]["meta"] == reference["summary"]["meta"]
    assert result["summary"]["canvas"] == "multi_panel"
    # Figure entries are additive: existing panels, overlays and text retain the
    # reference's geometry and emission order.
    original_items = [item for item in result["items"] if "figure_index" not in item]
    assert [(i["label"], i["bbox"], i.get("text")) for i in original_items] == [
        (i["label"], i["bbox"], i.get("text")) for i in reference["items"]
    ]
    figure_items = [item for item in result["items"] if "figure_index" in item]
    assert len(figure_items) == 6
    assert all(item["label"] == "character" for item in figure_items)
    assert [(item["panel_id"], item["character_id"], item["figure_index"]) for item in figure_items] == [
        (panel.id, figure.character_id, index)
        for panel in sorted(page.panels, key=lambda panel: panel.order)
        for index, figure in enumerate(panel_figures(panel, page))
    ]
    assert all("editor" not in figure.extra for panel in page.panels for figure in panel.figures)
    # No editor geometry: the first legacy position still produces its original
    # production footprint (x=659..861, y=53..490 on the 1024x1536 page).
    assert figure_items[0]["bbox"] == [-715, 147, -278, 349]
    for text in page.texts:
        if text.direction == "vertical":
            assert text.bbox.h > text.bbox.w
    assert all(panel_figures(panel, page) for panel in page.panels)


@pytest.mark.parametrize(
    ("shot", "expected"),
    [
        ("long", "full"),
        ("extreme_long", "full"),
        ("full", "full"),
        ("medium", "waist"),
        ("close_up", "bust"),
        ("extreme_close_up", "face"),
    ],
)
def test_figures_infer_framing_and_rtl_positions(shot: str, expected: str) -> None:
    panel = Panel("p", 1, RectShape(20, 20, 300, 500), shot=shot, character_ids=["a", "b"])
    page = Page(panels=[panel])
    figures = panel_figures(panel, page)
    assert figures[0].position > figures[1].position
    assert figure_framing(figures[0], shot) == expected
    figures[0].framing = "face"
    assert figure_framing(figures[0], shot) == "face"
    page.reading_direction = "ltr"
    assert panel_figures(panel, page)[0].position < panel_figures(panel, page)[1].position


@pytest.mark.parametrize("pose", POSES)
@pytest.mark.parametrize("framing", ["full", "waist", "bust", "face"])
@pytest.mark.parametrize(
    "shape",
    [
        RectShape(40, 40, 280, 350).to_dict(),
        {"type": "quad", "points": [[40, 40], [320, 80], [280, 390], [60, 360]]},
    ],
)
def test_every_pose_renders_without_bleeding(tmp_path: Path, pose: str, framing: str, shape: dict) -> None:
    figure = Figure("a", pose, "right", "left", framing)
    panel = Panel("p", 1, shape, shot="full", figures=[figure])
    page = Page(canvas_width=400, canvas_height=450, panels=[panel])
    before = render_preview(page, tmp_path / "figure.png")
    panel.figures = []
    after = render_preview(page, tmp_path / "empty.png")
    with Image.open(before) as a, Image.open(after) as b:
        diff = ImageChops.difference(a, b).convert("L")
        assert diff.getbbox() is not None
        mask = Image.new("L", a.size)
        draw = ImageDraw.Draw(mask)
        if shape["type"] == "quad":
            draw.polygon([tuple(p) for p in shape["points"]], fill=255)
        else:
            draw.rectangle((40, 40, 320, 390), fill=255)
        assert ImageChops.multiply(diff, ImageChops.invert(mask)).getbbox() is None


def test_unknown_pose_falls_back_and_boxes_remain_available(tmp_path: Path) -> None:
    panel = Panel("p", 1, RectShape(20, 20, 300, 500), figures=[Figure("a", "unknown")])
    page = Page(panels=[panel])
    assert "unknown_figure_pose" in {i.code for i in validate_page(page).warnings}
    unknown = render_preview(page, tmp_path / "unknown.png")
    panel.figures[0].pose = "stand"
    stand = render_preview(page, tmp_path / "stand.png")
    assert unknown.read_bytes() == stand.read_bytes()
    boxes = render_preview(page, tmp_path / "boxes.png", style="boxes")
    assert boxes.read_bytes() != stand.read_bytes()


def test_sketch_text_content_and_stable_colors(tmp_path: Path) -> None:
    page = Page(
        panels=[Panel("p", 1, RectShape(20, 20, 300, 700))],
        texts=[Text("t", "原文\n换列", bbox=RectShape(30, 100, 110, 300))],
    )
    text_path = render_preview(page, tmp_path / "text.png")
    page.texts.clear()
    empty_path = render_preview(page, tmp_path / "empty.png")
    with Image.open(text_path) as text, Image.open(empty_path) as empty:
        assert text.getpixel((20, 20)) == tuple(bytes.fromhex(PANEL_COLOR[1:]))
        assert ImageChops.difference(text, empty).crop((40, 110, 130, 390)).getbbox() is not None


def test_project_style_and_tags_inherit_in_cli(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    write_json(tmp_path / "project.json", Project(style_prompt="Warm cel shading.", tags=["sisters"]))
    path = write_json(tmp_path / "pages/p.json", {"id": "p", "panels": []})
    assert main(["compile", str(path), "--json"]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["summary"]["caption"].startswith("Warm cel shading.")
    assert "sisters" in result["summary"]["caption"]


def test_pose_presets_are_visually_distinct() -> None:
    from PIL import ImageFont  # noqa: PLC0415

    path = find_font()
    font = ImageFont.truetype(str(path), 18) if path else ImageFont.load_default()
    images = []
    for pose in POSES:
        image = Image.new("RGBA", (400, 600))
        draw_figure(image, Figure("girl", pose), None, shot="full", color=PANEL_COLOR, font=font)
        images.append(image.tobytes())
    assert len(set(images)) == len(POSES)


def test_figures_and_overlays_participate_in_lora_warnings() -> None:
    characters = {
        identifier: Character(identifier, identifier, lora=Lora(f"{identifier}.safetensors"))
        for identifier in ("a", "b")
    }
    panel = Panel("p", 1, RectShape(20, 20, 500, 900), figures=[Figure("a"), Figure("b")])
    page = Page(panels=[panel], texts=[Text("long", "台词" * 20, panel_id="p")])
    codes = {issue.code for issue in validate_page(page, characters).warnings}
    assert {"multiple_lora_characters_panel", "multiple_lora_characters_page", "dialogue_too_long"} <= codes
    panel.figures.pop()
    page.overlays = [Overlay("hero", "b", RectShape(100, 100, 200, 500))]
    codes = {issue.code for issue in validate_page(page, characters).warnings}
    assert "multiple_lora_characters_page" in codes


def test_page_style_overrides_project_and_new_page_copies_defaults(
    tmp_path: Path,
    capsys: pytest.CaptureFixture,
) -> None:
    write_json(tmp_path / "project.json", Project(style_prompt="Warm cel shading.", tags=["sisters"]))
    assert main(["page", "new", "--project", str(tmp_path), "--id", "p", "--json"]) == 0
    capsys.readouterr()
    path = tmp_path / "pages/p.json"
    page = load_page(path)
    assert page.style_prompt == "Warm cel shading."
    assert page.tags == ["sisters"]
    page.style_prompt, page.tags = "Cool ink wash.", ["kitchen"]
    write_json(path, page)
    assert main(["compile", str(path), "--json"]) == 0
    caption = json.loads(capsys.readouterr().out)["summary"]["caption"]
    assert caption.startswith("Cool ink wash.")
    assert "kitchen" in caption
    assert "sisters" not in caption


def test_caption_language_and_explicit_custom_override() -> None:
    character = Character(
        "girl", "女孩", appearance_zh="黑发", appearance_en="short black hair", age="20-year-old"
    )
    panel = Panel("p", 1, RectShape(600, 20, 400, 500), character_ids=["girl"])
    page = Page(panels=[panel])
    chinese = compile_page(page, {"girl": character})["items"][0]["caption"]
    assert chinese.startswith("第1格，中景，平视")  # noqa: RUF001 -- compiled Chinese punctuation
    assert "黑发" in chinese
    assert "20-year-old" in chinese
    assert "short black hair" not in chinese
    caption = compile_page(page, {"girl": character}, caption_language="en")["items"][0]["caption"]
    assert "short black hair" in caption
    assert "20-year-old" in caption
    assert "Top-right panel" in caption
    assert "黑发" not in caption
    panel.caption_en = "The older sister enters the kitchen."
    assert compile_page(page, {"girl": character})["items"][0]["caption"] == chinese
    panel.use_custom_caption = True
    assert compile_page(page, {"girl": character})["items"][0]["caption"] == panel.caption_en
    panel.use_custom_caption = False
    assert compile_page(page, {"girl": character})["items"][0]["caption"] == chinese
