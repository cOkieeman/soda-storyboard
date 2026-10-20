from __future__ import annotations

from soda_storyboard.models import Character, Page, Panel


def test_page_round_trip_preserves_canonical_shape() -> None:
    page = Page.from_dict(
        {
            "format": "soda-storyboard-page-v1",
            "id": "p1",
            "canvas_width": 1600,
            "canvas_height": 900,
            "panels": [
                {
                    "id": "a",
                    "order": 1,
                    "shape": {"type": "quad", "points": [[0, 0], [100, 10], [110, 200], [0, 190]]},
                }
            ],
        }
    )
    data = page.to_dict()
    assert data["format"] == "soda-storyboard-page-v1"
    assert data["panels"][0]["shape"]["type"] == "quad"
    assert Page.from_dict(data).to_dict() == data


def test_character_aliases_and_lora() -> None:
    character = Character.from_dict(
        {"id": "a", "name": "A", "triggers": ["hero"], "lora_path": "a.safetensors", "lora_strength": 0.8}
    )
    assert character.display_name == "A"
    assert character.trigger_words == ["hero"]
    assert character.lora is not None and character.lora.strength == 0.8


def test_panel_bbox_is_xywh() -> None:
    panel = Panel.from_dict(
        {"id": "a", "order": 1, "shape": {"type": "quad", "points": [[10, 20], [50, 20], [40, 90], [10, 80]]}}
    )
    assert panel.bbox == (10.0, 20.0, 40.0, 70.0)
