# ruff: noqa: RUF001 -- verify the public Chinese diagnostic text verbatim.
from __future__ import annotations

from pathlib import Path

import pytest

from soda_storyboard.bundle import BUNDLE_FORMAT, compile_bundle, export_bundle
from soda_storyboard.cli import _page_for, main
from soda_storyboard.clothing import clothing_phrases
from soda_storyboard.io import write_json
from soda_storyboard.models import Character, Figure, Lora, Page, Panel, Project, RectShape
from soda_storyboard.server.store import Store
from soda_storyboard.validation import validate_page


def _page(*identifiers: str) -> Page:
    return Page(
        page_id="page",
        caption_language="zh",
        panels=[Panel("p1", 1, RectShape(24, 24, 976, 1488), figures=[Figure(c) for c in identifiers])],
    )


def test_missing_clothing_ignores_nonappearing_character() -> None:
    characters = {
        "a": Character("a", "A", appearance_en="blue hair and green eyes"),
        "b": Character("b", "B"),
    }
    report = validate_page(_page("a"), characters)
    issues = [issue for issue in report.warnings if issue.code == "character_clothing_missing"]
    assert len(issues) == 1
    assert issues[0].details == {"character_id": "a"}


@pytest.mark.parametrize(
    ("appearance_zh", "appearance_en"),
    [
        ("深色长发，荷边连衣裙", ""),
        ("", "long dark hair, a frilled dress"),
        ("", "long blue hair wearing a dress"),
        ("深色长发穿着荷边连衣裙", ""),
    ],
)
def test_clothing_color_does_not_use_hair_color(appearance_zh: str, appearance_en: str) -> None:
    character = Character("a", "鲸鱼娘", appearance_zh=appearance_zh, appearance_en=appearance_en)
    report = validate_page(_page("a"), {"a": character})
    codes = {issue.code for issue in report.warnings}
    assert "character_clothing_color_missing" in codes
    assert "character_clothing_missing" not in codes


@pytest.mark.parametrize(
    "character",
    [
        Character("a", "A", appearance_zh="黑色长发，蓝色荷边连衣裙"),
        Character("a", "A", appearance_en="black hair, an ivory blouse"),
        Character("a", "A", clothing=["a red jacket"]),
        Character("a", "A", clothing=["深蓝色长袍"]),
        Character("a", "A", appearance_en="long blue hair wearing a white dress with red trim"),
    ],
)
def test_bilingual_clothing_and_colors(character: Character) -> None:
    assert not any(
        issue.code.startswith("character_clothing_")
        for issue in validate_page(_page("a"), {"a": character}).warnings
    )


@pytest.mark.parametrize(
    ("first", "second"),
    [
        ("a blue dress", "a red dress"),
        ("a dress", "a green jacket"),
        ("a blue skirt", "a blue blouse"),
        ("白色连衣裙", "白色衬衫"),
    ],
)
def test_similar_clothing_warns_for_category_missing_or_shared_color(first: str, second: str) -> None:
    cards = {"a": Character("a", "A", clothing=[first]), "b": Character("b", "B", clothing=[second])}
    report = validate_page(_page("a", "b"), cards)
    assert any(
        issue.code == "character_clothing_similar" and "写明不同的服装和颜色" in issue.message
        for issue in report.warnings
    )


def test_distinct_clothes_do_not_warn_and_word_matching_is_bounded() -> None:
    cards = {
        "a": Character("a", "A", clothing=["a blue dress"]),
        "b": Character("b", "B", clothing=["a red jacket"]),
    }
    assert not any(
        issue.code == "character_clothing_similar" for issue in validate_page(_page("a", "b"), cards).warnings
    )
    assert clothing_phrases(Character("c", "C", appearance_en="standing on a rooftop"), "en") == []


def test_lora_information_replaces_old_warnings_in_validate_bundle_and_export(tmp_path: Path) -> None:
    cards = {
        "sylvia": Character("sylvia", "Sylvia", lora=Lora("sylvia.safetensors", 0.8)),
        "whale": Character("whale", "鲸鱼娘", lora=Lora("whale.safetensors", 0.8)),
    }
    page = _page(*cards)
    report = validate_page(page, cards)
    message = "本页 LoRA：Sylvia（0.8）；鲸鱼娘按角色描述出图"
    assert report.infos[0].message == message
    assert report.infos[0].severity == "info"
    assert not any(issue.code.startswith("multiple_lora") for issue in report.warnings)
    assert report.to_dict()["infos"][0]["message"] == message
    envelope = {
        "format": BUNDLE_FORMAT,
        "page": page.to_dict(),
        "project": {"caption_language": "zh"},
        "characters": {key: card.to_dict() for key, card in cards.items()},
    }
    compiled = compile_bundle(envelope)
    assert message in compiled["warnings"]
    assert not any(
        old in warning
        for old in ("本页出现多个带 LoRA 的角色", "同时包含多个带 LoRA 的角色", "建议一次只加载")
        for warning in compiled["warnings"]
    )
    path = write_json(tmp_path / "pages/page.json", page)
    write_json(tmp_path / "project.json", Project(caption_language="zh"))
    for key, card in cards.items():
        write_json(tmp_path / f"characters/{key}.json", card)
    exported = export_bundle(path, no_sketch=True)
    assert exported["lora_info"] == message
    assert message in exported["warnings"]
    page.lora_policy = "none"
    assert validate_page(page, cards).infos[0].message == "本页不使用 LoRA"


def test_project_policy_inherits_in_cli_editor_and_bundle(tmp_path: Path) -> None:
    card = Character("a", "A", lora=Lora("a.safetensors", 0.8))
    page = _page("a")
    path = write_json(tmp_path / "pages/page.json", page)
    write_json(tmp_path / "characters/a.json", card)
    write_json(tmp_path / "project.json", Project(lora_policy="none", caption_language="zh"))
    assert _page_for(path).lora_policy == "none"
    assert Store(tmp_path).render_page("page").lora_policy == "none"
    assert Store(tmp_path).checked(page.to_dict())[1]["infos"][0]["message"] == "本页不使用 LoRA"
    result = compile_bundle(
        {
            "format": BUNDLE_FORMAT,
            "page": page.to_dict(),
            "project": {"lora_policy": "none"},
            "characters": {"a": card.to_dict()},
        }
    )
    assert result["lora"] is None
    assert "本页不使用 LoRA" in result["warnings"]


def test_init_and_character_creation_need_no_lora(tmp_path: Path) -> None:
    root = tmp_path / "story"
    assert main(["init", str(root), "--json"]) == 0
    assert main(["character", "new", "--project", str(root), "--id", "a", "--name", "A", "--json"]) == 0


def test_invalid_page_lora_selection_is_validation_error() -> None:
    page = _page("a")
    page.lora_character = "missing"
    report = validate_page(page, {"a": Character("a", "A")})
    assert any(issue.code == "invalid_lora_character" for issue in report.errors)
