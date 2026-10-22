from __future__ import annotations

import json
from pathlib import Path

import pytest

from soda_storyboard.cli import main
from soda_storyboard.io import write_json
from soda_storyboard.lora import lora_info, select_lora
from soda_storyboard.models import Character, Figure, Lora, Overlay, Page, Panel, Project, RectShape
from soda_storyboard.production.errors import ProductionError
from soda_storyboard.production.state import PageState


@pytest.fixture
def characters() -> dict[str, Character]:
    return {
        "a": Character("a", "Sylvia", lora=Lora("a.safetensors", 0.8)),
        "b": Character("b", "Whale girl", lora=Lora("b.safetensors", 0.7)),
        "plain": Character("plain", "Plain"),
    }


def test_project_policy_and_page_choice_round_trip() -> None:
    assert Project.from_dict({}).lora_policy == "single"
    assert Project().to_dict()["lora_policy"] == "single"
    assert Project.from_dict({"lora_policy": "none"}).to_dict()["lora_policy"] == "none"
    assert Page.from_dict({}).lora_character is None
    for choice in (None, "none", "a"):
        page = Page.from_dict({"lora_character": choice})
        assert Page.from_dict(page.to_dict()).lora_character == choice
    assert "lora_policy" not in Page(lora_policy="none").to_dict()
    assert "lora" not in Character("plain", "Plain").to_dict()


@pytest.mark.parametrize("policy", ["multi", "", None, 4])
def test_project_rejects_unknown_policy(policy: object) -> None:
    with pytest.raises(ValueError, match="lora_policy"):
        Project.from_dict({"lora_policy": policy})


@pytest.mark.parametrize(
    ("policy", "choice", "selection", "expected"),
    [
        ("single", None, "auto", "b"),
        ("single", "a", "auto", "a"),
        ("single", "none", "auto", None),
        ("none", "a", "auto", None),
        ("none", None, "auto", None),
        ("none", "none", "a", "a"),
        ("single", "a", "none", None),
    ],
)
def test_auto_resolves_project_policy_and_page_selection(
    characters: dict[str, Character], policy: str, choice: str | None, selection: str, expected: str | None
) -> None:
    page = Page(
        lora_policy=policy,
        lora_character=choice,
        panels=[
            Panel("p1", 1, RectShape(0, 0, 100, 100), character_ids=["a"]),
            Panel("p2", 2, RectShape(100, 0, 300, 100), character_ids=["b"]),
        ],
    )
    result = select_lora(page, characters, selection)
    assert (result or {}).get("character_id") == expected


def test_area_weighting_beats_counts_and_uses_actual_quad_area(characters: dict[str, Character]) -> None:
    page = Page(
        panels=[
            Panel("small1", 1, RectShape(0, 0, 20, 20), character_ids=["a", "a"]),
            Panel("small2", 2, RectShape(0, 20, 20, 20), figures=[Figure("a"), Figure("a")]),
            Panel("large", 3, RectShape(20, 0, 100, 100), character_ids=["b"]),
        ]
    )
    assert select_lora(page, characters)["character_id"] == "b"
    page.panels = [
        Panel("rect", 1, RectShape(0, 0, 80, 100), character_ids=["a"]),
        Panel(
            "quad",
            2,
            {"type": "quad", "points": [[0, 0], [100, 0], [100, 20], [0, 100]]},
            character_ids=["b"],
        ),
    ]
    # The quad bbox is 10,000, but its visible area is only 6,000.
    assert select_lora(page, characters)["character_id"] == "a"


def test_moss_overlay_area_counts_but_layer_does_not(characters: dict[str, Character]) -> None:
    page = Page(
        panels=[Panel("p", 1, RectShape(0, 0, 100, 100), character_ids=["a"])],
        overlays=[Overlay("b", "b", RectShape(0, 0, 200, 100), mode="layer")],
    )
    assert select_lora(page, characters)["character_id"] == "a"
    page.overlays[0].mode = "moss"
    assert select_lora(page, characters)["character_id"] == "b"


def test_selection_validates_card_and_appearance_and_handles_no_lora(
    characters: dict[str, Character],
) -> None:
    page = Page(panels=[Panel("p", 1, RectShape(0, 0, 100, 100), character_ids=["plain"])])
    assert select_lora(page, characters) is None
    with pytest.raises(ProductionError, match="没有 LoRA"):
        select_lora(page, characters, "plain")
    with pytest.raises(ProductionError, match="没有在此页出场"):
        select_lora(page, characters, "a")
    page.lora_character = "missing"
    with pytest.raises(ProductionError, match="不存在或没有 LoRA"):
        select_lora(page, characters)


def test_lora_info_explains_selected_and_description_driven_cast(characters: dict[str, Character]) -> None:
    page = Page(
        lora_character="a",
        panels=[Panel("p", 1, RectShape(0, 0, 100, 100), character_ids=["a", "b"])],
    )
    assert lora_info(page, characters) == "本页 LoRA：Sylvia（0.8）；Whale girl按角色描述出图"  # noqa: RUF001
    page.lora_character = "none"
    assert lora_info(page, characters) == "本页不使用 LoRA"


def test_production_inherits_authoritative_project_policy(tmp_path: Path) -> None:
    write_json(tmp_path / "project.json", Project(lora_policy="none"))
    write_json(tmp_path / "pages" / "p.json", {"id": "p", "lora_policy": "single", "panels": []})
    state = PageState(tmp_path, "p")
    assert state.page.lora_policy == "none"
    assert "lora_policy" not in state.page.to_dict()


def test_schema_copies_document_optional_lora_policy_and_page_choice() -> None:
    root = Path(__file__).resolve().parents[1]
    canonical = root / "schema/storyboard-v1.schema.json"
    assert (
        canonical.read_bytes()
        == (root / "skill/skills/soda-storyboard/assets/storyboard-v1.schema.json").read_bytes()
    )
    definitions = json.loads(canonical.read_text(encoding="utf-8"))["$defs"]
    assert definitions["project"]["properties"]["lora_policy"]["enum"] == ["single", "none"]
    assert "lora_character" in definitions["page"]["properties"]
    assert "lora" not in definitions["character"]["required"]
    assert "Optional" in definitions["character"]["properties"]["lora"]["description"]


def test_redraw_help_keeps_swap_as_manual_advanced_choice(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        main(["redraw", "--help"])
    assert exc.value.code == 0
    help_text = capsys.readouterr().out
    assert "不推荐用于换 LoRA 角色" in help_text
