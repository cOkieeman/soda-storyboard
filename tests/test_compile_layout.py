from __future__ import annotations

from soda_storyboard.compiler import compile_page
from soda_storyboard.models import Page
from soda_storyboard.templates import suggest_layouts


def test_compile_uses_centered_yxyx_and_dialogue_mode() -> None:
    page = Page.from_dict(
        {
            "id": "p",
            "canvas_width": 1600,
            "canvas_height": 900,
            "dialogue_mode": "moss_text",
            "panels": [
                {
                    "id": "a",
                    "order": 1,
                    "shape": {"type": "rect", "x": 100, "y": 50, "w": 400, "h": 300},
                    "dialogue": [{"text": "你好", "bubble": "speech"}],
                }
            ],
        }
    )
    result = compile_page(page)
    assert result["bbox_coord_space"] == "abs_centralized"
    assert result["bbox_format"] == "yxyx"
    assert result["items"][0]["bbox"] == [-400.0, -700.0, -100.0, -300.0]
    assert result["items"][1]["label"] == "text"
    page.dialogue_mode = "lettering"
    assert len(compile_page(page)["items"]) == 1


def test_layout_suggest_returns_three_in_bounds_candidates() -> None:
    results = suggest_layouts(5, width=1024, height=1536)
    assert len(results) >= 3
    for result in results[:3]:
        assert len(result["panels"]) == 5
        for panel in result["panels"]:
            assert 0 <= panel["x"] < 1024
            assert 0 <= panel["y"] < 1536
            assert panel["x"] + panel["w"] <= 1024
            assert panel["y"] + panel["h"] <= 1536
