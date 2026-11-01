"""Local helper boxes owned by a figure, and the same character drawn twice in one panel."""
# ruff: noqa: RUF001 -- Chinese captions use full-width punctuation

from __future__ import annotations

from soda_storyboard.compiler import compile_page
from soda_storyboard.models import Character, Page
from soda_storyboard.validation import validate_page

CHARACTERS = {"toki": Character.from_dict({"id": "toki", "display_name": "时", "role_en": "Toki"})}


def _page(objects: list[dict], figures: list[dict] | None = None) -> Page:
    panel = {
        "id": "p1",
        "order": 1,
        "shape": {"type": "rect", "x": 0, "y": 0, "w": 1024, "h": 1536},
        "character_ids": ["toki"],
        "figures": figures or [{"id": "fig-a", "character_id": "toki", "position": "center"}],
    }
    return Page.from_dict(
        {"canvas_width": 1024, "canvas_height": 1536, "panels": [panel], "objects": objects}
    )


def _hand(**extra: object) -> dict:
    rect = {"type": "rect", "x": 100, "y": 200, "w": 120, "h": 120}
    return {"id": "hand", "rect": rect, "panel_id": "p1", "caption": "gripping the sleeve", **extra}


def test_part_box_compiles_as_character_detail_of_its_owner() -> None:
    item = compile_page(_page([_hand(owner="fig-a", part="right hand")]), CHARACTERS)["items"][-1]
    assert item["label"] == "character"
    assert item["caption"].startswith("Right hand of Toki, gripping the sleeve.")
    assert "same continuous body as Toki" in item["caption"]
    assert set(item) == {"label", "caption", "bbox"}


def test_part_box_resolves_character_id_and_writes_chinese() -> None:
    page = _page([_hand(owner="toki", part="右手", caption="抓住袖口")], figures=[{"character_id": "toki"}])
    caption = compile_page(page, CHARACTERS, caption_language="zh")["items"][-1]["caption"]
    assert caption == "时的右手，抓住袖口。属于本格时同一个连续的身体，与人物其余部分相连，不是另一个人。"
    assert not {issue.code for issue in validate_page(page, CHARACTERS).warnings} & {"unknown_object_owner"}


def test_plain_objects_keep_their_old_output_and_shape() -> None:
    page = _page([_hand()])
    assert compile_page(page, CHARACTERS)["items"][-1] == {
        "label": "object",
        "caption": "gripping the sleeve",
        "bbox": [-568, -412, -448, -292],
    }
    assert set(page.to_dict()["objects"][0]) == {"id", "rect", "caption", "panel_id", "label"}


def test_part_box_round_trips_and_warns_about_missing_owner_or_part() -> None:
    page = _page([_hand(owner="nobody", caption="")])
    assert Page.from_dict(page.to_dict()).objects[0].owner == "nobody"
    codes = {issue.code for issue in validate_page(page, CHARACTERS).warnings}
    assert {"unknown_object_owner", "empty_object_part"} <= codes


def test_same_character_twice_in_a_panel_is_marked_as_one_person() -> None:
    figures = [
        {"id": "face", "character_id": "toki", "position": "left", "framing": "face"},
        {"id": "body", "character_id": "toki", "position": "right", "framing": "full"},
    ]
    items = compile_page(_page([], figures), CHARACTERS, caption_language="zh")["items"]
    figure_captions = [item["caption"] for item in items if item["label"] == "character"]
    assert len(figure_captions) == 2
    assert all("与本格另一处的时是同一个人" in caption for caption in figure_captions)
    single = compile_page(_page([]), CHARACTERS, caption_language="zh")["items"]
    assert not any("同一个人" in item["caption"] for item in single)


def test_untranslated_chinese_part_falls_back_to_a_chinese_caption() -> None:
    page = _page([_hand(owner="fig-a", part="右手", caption="")])
    caption = compile_page(page, CHARACTERS)["items"][-1]["caption"]
    assert caption.startswith("时的右手。")
