from __future__ import annotations

import copy

import pytest

from soda_storyboard.compiler import compile_page
from soda_storyboard.importers import import_moss, import_storyboard
from soda_storyboard.models import ObjectBox, Page, RectShape
from soda_storyboard.validation import validate_page


def sample(*, panels: bool) -> dict:
    return {
        "summary": {"caption": "Two scenes" if panels else "A phone interface", "custom": 17},
        "bbox_format": "yxyx",
        "bbox_coord_space": "abs_centralized",
        "extra_source": {"retain": True},
        "items": [
            {
                "label": "object",
                "caption": "Upper panel" if panels else "A small avatar",
                "bbox": [-740, -490, -30, 490] if panels else [-740, -500, -680, -440],
            },
            {
                "label": "text",
                "text": "你好\n世界",
                "caption": "Vertical narration",
                "bbox": [-700, -300, -500, -200],
                "unknown": [1, 2],
            },
            {
                "label": "object",
                "caption": "Lower panel" if panels else "A lantern",
                "bbox": [30, -490, 740, 490] if panels else [200, 400, 500, 500],
            },
            {"label": "character", "caption": "A girl", "bbox": [-300, -200, 600, 200]},
            {"label": "unrecognized", "bbox": [0, 0, 10, 10], "alien": {"keep": True}},
        ],
    }


@pytest.mark.parametrize("panels", [True, False])
def test_moss_roundtrip_is_lossless_and_inference_is_reported(*, panels: bool) -> None:
    source = sample(panels=panels)
    original = copy.deepcopy(source)
    page, report = import_moss(source)
    assert (page.width, page.height) == (1024, 1536)
    assert len(page.panels) == (2 if panels else 0)
    assert report["guesses"]
    assert report["unrecognized_items"][0]["index"] == 4
    assert compile_page(Page.from_dict(page.to_dict())) == source
    assert source == original


def test_only_edited_import_item_changes_and_unknown_fields_survive() -> None:
    source = sample(panels=False)
    page, _ = import_moss(source)
    page.objects[0].rect.x += 10
    compiled = compile_page(page)
    assert compiled["items"][0]["bbox"] == [-740, -490, -680, -430]
    assert compiled["items"][1:] == source["items"][1:]
    page.texts[0].text = "新的文字"
    compiled = compile_page(page)
    assert compiled["items"][1]["text"] == "新的文字"
    assert compiled["items"][1]["unknown"] == [1, 2]


@pytest.mark.parametrize(
    ("fmt", "box"),
    [("xyxy", [0.1, 0.2, 0.8, 0.9]), ("xywh", [0.1, 0.2, 0.7, 0.7]), ("yxyx", [0.2, 0.1, 0.9, 0.8])],
)
def test_loose_aliases_and_normalized_coordinates(fmt: str, box: list[float]) -> None:
    page, report = import_storyboard(
        {"shots": [{"prompt": "A tree", "bbox": box, "bbox_format": fmt, "lines": ["你好"]}]}
    )
    x, y, w, h = page.panels[0].bbox
    assert (x, y, w, h) == pytest.approx((102.4, 307.2, 716.8, 1075.2))
    assert page.texts[0].text == "你好"
    assert any("normalized" in guess for guess in report["guesses"])


def test_markdown_table_and_list_use_existing_layouts() -> None:
    table = "| 格 | 画面描述 | 台词 |\n| --- | --- | --- |\n| 1 | 女孩开门 | 你好 |\n| 2 | 天空放晴 | 晴了 |"
    page, report = import_storyboard(table)
    assert len(page.panels) == 2
    assert page.panels[1].description == "天空放晴"
    assert page.texts[0].text == "你好"
    assert any("模板" in guess for guess in report["guesses"])
    listed, _ = import_storyboard("1. 女孩开门\n2. 天空放晴")
    assert len(listed.panels) == 2


def test_standalone_objects_compile_without_any_panels() -> None:
    page = Page(objects=[ObjectBox("cup", RectShape(100, 200, 50, 80), "A cup")])
    assert compile_page(page)["items"] == [
        {"label": "object", "caption": "A cup", "bbox": [-568, -412, -488, -362]}
    ]


@pytest.mark.parametrize(
    ("space", "box", "expected"),
    [
        ("top_left_pixels", [100, 200, 300, 400], [110, 200, 300, 400]),
        ("normalized", [0.1, 0.2, 0.3, 0.4], [0.11, 0.2, 0.3, 0.4]),
        ("normalized_1000", [100, 200, 300, 400], [110, 200, 300, 400]),
    ],
)
def test_imported_coordinates_retain_original_contract_after_edit(
    space: str, box: list, expected: list
) -> None:
    source = {
        "canvas_width": 1000,
        "canvas_height": 1000,
        "bbox_format": "xyxy",
        "bbox_coord_space": space,
        "items": [{"label": "object", "caption": "Cup", "bbox": box}],
    }
    page, _ = import_moss(source)
    assert compile_page(page) == source
    page.objects[0].rect.x += 10
    page.objects[0].rect.w -= 10
    assert compile_page(page)["items"][0]["bbox"] == pytest.approx(expected)


def test_single_canvas_summary_and_object_validation() -> None:
    page = Page(
        objects=[{"id": "cup", "rect": {"x": 10, "y": 20, "w": 40, "h": 50}}], extra={"canvas_mode": "single"}
    )
    result = compile_page(page)
    assert result["summary"]["canvas"] == "single"
    assert "single_canvas" not in result["summary"]["meta"]
    assert "gutters" not in result["summary"]["caption"]
    page.objects.append(ObjectBox("cup", RectShape(10, 20, 40, 50), panel_id="missing"))
    assert {issue.code for issue in validate_page(page).errors} >= {
        "duplicate_object_id",
        "unknown_object_panel",
    }


def test_unrelated_documents_are_rejected_and_unsupported_geometry_is_reported() -> None:
    with pytest.raises(ValueError, match="No panels"):
        import_storyboard({"workflow": {"nodes": []}})
    source = sample(panels=False)
    source["bbox_format"] = "invalid"
    page, report = import_moss(source)
    assert len(report["unrecognized_items"]) == len(source["items"])
    assert compile_page(page) == source
