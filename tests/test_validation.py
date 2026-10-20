from __future__ import annotations

from soda_storyboard.models import Character, Page
from soda_storyboard.validation import validate_page


def test_validation_catches_overlap_and_order() -> None:
    page = Page.from_dict(
        {
            "id": "p",
            "canvas_width": 1600,
            "canvas_height": 900,
            "panels": [
                {"id": "a", "order": 2, "shape": {"type": "rect", "x": 0, "y": 0, "w": 800, "h": 500}},
                {"id": "b", "order": 2, "shape": {"type": "rect", "x": 400, "y": 0, "w": 800, "h": 500}},
            ],
        }
    )
    report = validate_page(page)
    codes = {issue.code for issue in report.errors}
    assert "panel_overlap" in codes
    assert "order_not_contiguous" in codes


def test_validation_unknown_character_and_lora_warning() -> None:
    page = Page.from_dict(
        {
            "id": "p",
            "canvas_width": 1600,
            "canvas_height": 900,
            "panels": [
                {
                    "id": "a",
                    "order": 1,
                    "shape": {"type": "rect", "x": 0, "y": 0, "w": 700, "h": 500},
                    "character_ids": ["a", "missing"],
                },
                {
                    "id": "b",
                    "order": 2,
                    "shape": {"type": "rect", "x": 900, "y": 0, "w": 700, "h": 500},
                    "character_ids": ["a", "b"],
                },
            ],
        }
    )
    characters = {
        "a": Character.from_dict({"id": "a", "name": "A", "lora": {"path": "a"}}),
        "b": Character.from_dict({"id": "b", "name": "B", "lora": {"path": "b"}}),
    }
    report = validate_page(page, characters)
    assert any(issue.code == "unknown_character" for issue in report.errors)
    assert any(issue.code == "multiple_lora_characters_page" for issue in report.warnings)


def test_validation_dialogue_limit_is_warning() -> None:
    page = Page.from_dict(
        {
            "id": "p",
            "canvas_width": 1600,
            "canvas_height": 900,
            "panels": [
                {
                    "id": "a",
                    "order": 1,
                    "shape": {"type": "rect", "x": 0, "y": 0, "w": 500, "h": 500},
                    "dialogue": [{"text": "这是一个非常非常非常非常非常长的句子", "bubble": "speech"}],
                }
            ],
        }
    )
    report = validate_page(page, max_dialogue_chars=10)
    assert any(issue.code == "dialogue_too_long" for issue in report.warnings)
