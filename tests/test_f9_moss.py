from __future__ import annotations

import pytest

from soda_storyboard.compiler import compile_page
from soda_storyboard.importers import import_moss
from soda_storyboard.models import Page


@pytest.mark.parametrize("with_ids", [False, True])
@pytest.mark.parametrize("edited", [False, True])
def test_moss_lettering_filters_original_edited_and_passthrough_text(*, with_ids: bool, edited: bool) -> None:
    source = {
        "canvas_width": 1000,
        "canvas_height": 1000,
        "bbox_coord_space": "top_left_pixels",
        "bbox_format": "xywh",
        "summary": {"caption": "A comic page"},
        "items": [
            {"label": "object", "caption": "A panel", "bbox": [0, 0, 1000, 1000]},
            {"label": "text", "caption": "speech", "text": "first", "bbox": [20, 20, 50, 100]},
            {"label": "text", "caption": "speech", "text": "second", "bbox": [80, 20, 50, 100]},
            {"label": "text", "caption": "source passthrough", "text": "outside", "bbox": [2000, 0, 10, 10]},
            {"label": "unknown", "caption": "keep passthrough", "bbox": [100, 200, 20, 30]},
        ],
    }
    page, _ = import_moss(source)
    assert len(page.texts) == 2
    if edited:
        page.texts[1].text = "edited"
    assert len([item for item in compile_page(page)["items"] if item["label"] == "text"]) == 3
    page.dialogue_mode = "lettering"
    compiled = compile_page(Page.from_dict(page.to_dict()), with_ids=with_ids)
    assert not any(item.get("label") == "text" for item in compiled["items"])
    assert any(item.get("label") == "unknown" for item in compiled["items"])
    page.dialogue_mode = "moss_text"
    assert len([item for item in compile_page(page)["items"] if item["label"] == "text"]) == 3
