from __future__ import annotations

from pathlib import Path

from soda_storyboard.geometry import from_moss_bbox, quad_bbox, shape_bbox, to_moss_bbox
from soda_storyboard.io import load_model, load_page, save_page
from soda_storyboard.models import Character, Dialogue, Lora, Page, Panel


def test_centered_moss_bbox_round_trip_for_non_square_canvas() -> None:
    page_bbox = (16.0, 32.0, 496.0, 768.0)
    moss_bbox = to_moss_bbox(page_bbox, 1024, 1536)
    assert moss_bbox == [-736.0, -496.0, 0.0, -16.0]
    assert from_moss_bbox(moss_bbox, 1024, 1536) == page_bbox


def test_quad_uses_axis_aligned_enclosing_rectangle() -> None:
    points = [[100, 20], [300, 0], [280, 400], [20, 350]]
    assert quad_bbox(points) == (20.0, 0.0, 300.0, 400.0)
    assert shape_bbox({"type": "quad", "points": points}) == (20.0, 0.0, 300.0, 400.0)


def test_page_json_round_trip(tmp_path: Path) -> None:
    page = Page(
        page_id="station-01",
        canvas_width=1024,
        canvas_height=1536,
        panels=[
            Panel(
                id="p1",
                order=1,
                shape={"type": "rect", "x": 0, "y": 0, "w": 1024, "h": 300},
                dialogue=[Dialogue(speaker_id="girl", text="那个……")],
            )
        ],
    )
    path = save_page(page, tmp_path / "page.json")
    loaded = load_page(path)
    assert loaded.to_dict() == page.to_dict()
    assert load_model(path).to_dict() == page.to_dict()


def test_character_lora_round_trip() -> None:
    character = Character(
        id="girl",
        display_name="Girl",
        trigger_words=["girl, long black hair"],
        lora=Lora("characters/girl.safetensors", 0.8),
        appearance_zh="黑色长发",
    )
    result = Character.from_dict(character.to_dict())
    assert result.lora_path == "characters/girl.safetensors"
    assert result.lora_strength == 0.8
    assert result.appearance_text() == "黑色长发"
