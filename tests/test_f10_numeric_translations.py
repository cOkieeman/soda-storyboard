"""F10 numeric boundaries and translation-cache preservation regressions."""

from __future__ import annotations

from copy import deepcopy

import pytest

from soda_storyboard.bundle import load_bundle
from soda_storyboard.captions import source_hash, translation_state
from soda_storyboard.models import Page, Project
from soda_storyboard.translations import apply_translations
from soda_storyboard.validation import validate_page


def page_data() -> dict:
    return {
        "id": "p",
        "canvas_width": 101,
        "canvas_height": 101,
        "panel_gap": 0,
        "panels": [
            {
                "id": "a",
                "order": 1,
                "importance": 1,
                "description": "A bird flies.",
                "shape": {"type": "rect", "x": 0, "y": 0, "w": 101, "h": 101},
            }
        ],
    }


@pytest.mark.parametrize("value", [0, -1, 4, 1.9, True, "1", None])
def test_panel_importance_obeys_integer_range_in_raw_and_model(value: object) -> None:
    raw = page_data()
    raw["panels"][0]["importance"] = value
    assert any(issue.field == "importance" for issue in validate_page(raw).errors)
    try:
        page = Page.from_dict(raw)
    except (TypeError, ValueError):
        return
    assert any(issue.field == "importance" for issue in validate_page(page).errors)


@pytest.mark.parametrize(
    "field", ["order", "importance", "canvas_width", "canvas_height", "text_max_chars", "z_index"]
)
@pytest.mark.parametrize("value", [1.9, True, "1", None])
def test_integer_fields_reject_lossy_json_coercion(field: str, value: object) -> None:
    raw = page_data()
    if field in {"order", "importance"}:
        raw["panels"][0][field] = value
    elif field == "z_index":
        raw["overlays"] = [
            {"id": "l", "character_id": "", "rect": {"x": 0, "y": 0, "w": 1, "h": 1}, field: value}
        ]
    else:
        raw[field] = value
    assert any(issue.field == field for issue in validate_page(raw).errors)
    with pytest.raises((TypeError, ValueError), match=field):
        Page.from_dict(raw)


@pytest.mark.parametrize("field", ["default_canvas_width", "default_canvas_height"])
@pytest.mark.parametrize("value", [1.9, True, "101", None, 0, -1])
def test_project_canvas_rejects_invalid_integer_dimensions(field: str, value: object) -> None:
    with pytest.raises((TypeError, ValueError), match=field):
        Project.from_dict({field: value})


@pytest.mark.parametrize(
    ("field", "value"),
    [
        (field, value)
        for field in ("canvas_width", "canvas_height", "text_max_chars", "panel_gap", "text_font_size")
        for value in (0, -1, True, "1")
        if field != "panel_gap" or value != 0
    ],
)
def test_page_numeric_constraints_apply_to_mutated_models(field: str, value: object) -> None:
    page = Page.from_dict(page_data())
    setattr(page, field, value)
    assert validate_page(page).errors


@pytest.mark.parametrize("field", ["order", "importance"])
@pytest.mark.parametrize("value", [0, -1, 1.9, True, "1"])
def test_bundle_rejects_invalid_panel_numbers(field: str, value: object) -> None:
    raw = page_data()
    raw["panels"][0][field] = value
    with pytest.raises((TypeError, ValueError)):
        load_bundle(raw)


@pytest.mark.parametrize("importance", [1.0, 3.0])
def test_integral_numbers_and_fractional_panel_gap_roundtrip(importance: float) -> None:
    raw = page_data()
    raw["canvas_width"] = 101.0
    raw["canvas_height"] = 101.0
    raw["panel_gap"] = 1.5
    raw["text_max_chars"] = 10.0
    raw["panels"][0]["order"] = 1.0
    raw["panels"][0]["importance"] = importance
    page = Page.from_dict(raw)
    assert page.panel_gap == 1.5
    assert not validate_page(page).errors
    assert Page.from_dict(page.to_dict()).to_dict() == page.to_dict()
    assert load_bundle(raw)[0].panel_gap == 1.5


@pytest.mark.parametrize("text", ["!!!", " ,;.! ", "Panel 1: !!!", "第1格，！！！", "\n\t"])  # noqa: RUF001
def test_empty_cleaned_translation_preserves_existing_fresh_cache(text: str) -> None:
    page = Page.from_dict(page_data())
    panel = page.panels[0]
    digest = source_hash(panel, page, {})
    apply_translations(page, {}, [{"panel_id": "a", "source_hash": digest, "text": "A bird flies."}])
    original = deepcopy(panel.caption_auto_en)

    result = apply_translations(page, {}, [{"panel_id": "a", "source_hash": digest, "text": text}])

    assert result == {"applied": [], "rejected": [{"panel_id": "a", "reason": "empty_translation"}]}
    assert panel.caption_auto_en == original
    assert translation_state(panel, page, {}) == "fresh"


def test_empty_cleaned_translation_does_not_block_later_valid_entry() -> None:
    page = Page.from_dict(page_data())
    digest = source_hash(page.panels[0], page, {})
    result = apply_translations(
        page,
        {},
        [
            {"panel_id": "a", "source_hash": digest, "text": "!!!"},
            {"panel_id": "a", "source_hash": digest, "text": "Panel 1: A bird flies.!"},
        ],
    )
    assert result == {"applied": ["a"], "rejected": [{"panel_id": "a", "reason": "empty_translation"}]}
    assert page.panels[0].caption_auto_en["text"] == "A bird flies."
