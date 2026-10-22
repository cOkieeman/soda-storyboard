"""F8: scene-only translations and canonical character-card appearance."""

from __future__ import annotations

import copy

import pytest

from soda_storyboard.captions import character_caption, panel_caption, source_hash, translation_state
from soda_storyboard.compiler import compile_page
from soda_storyboard.models import Character, Figure, Page, Panel, RectShape
from soda_storyboard.translations import apply_translations, translation_todo
from soda_storyboard.validation import validate_page

# ruff: noqa: RUF001 -- inspect bilingual generated captions and migration guidance.


def _fixture(*, panels: int = 1) -> tuple[Page, dict[str, Character]]:
    characters = {
        "sylvia": Character(
            "sylvia",
            "Sylvia",
            appearance_zh="浅金长发，白色衬衫外搭深灰背心裙，戴手表",
            appearance_en=(
                "long pale blonde hair, a white blouse under a dark grey pinafore dress, a wristwatch"
            ),
        ),
        "whale": Character(
            "whale",
            "鲸鱼娘",
            appearance_zh="深蓝长发，蓝色荷边连衣裙，鲸鱼头饰和尾巴",
            appearance_en="long navy hair, a blue frilled dress, a whale-shaped hair ornament and tail",
            role_en="the whale girl",
        ),
    }
    page = Page(
        panels=[
            Panel(
                f"p{i}",
                i,
                RectShape(20, i * 200, 600, 180),
                character_ids=["sylvia", "whale"],
                figures=[Figure("sylvia", pose="stand"), Figure("whale", pose="hands_clasped")],
                description="天台栏杆旁，Sylvia拿着画稿，鲸鱼娘抱着剩下的稿纸，两人尴尬对视。",
            )
            for i in range(1, panels + 1)
        ]
    )
    return page, characters


def _translate(page: Page, characters: dict[str, Character]) -> None:
    result = apply_translations(
        page,
        characters,
        [
            {
                "panel_id": panel.id,
                "source_hash": source_hash(panel, page, characters),
                "text": (
                    "Beside the rooftop railing, Sylvia holds a drawing and the whale girl holds the "
                    "remaining sheets. They exchange an awkward stare."
                ),
            }
            for panel in page.panels
        ],
    )
    assert result["applied"] == [panel.id for panel in page.panels]
    assert result["rejected"] == []


def test_todo_excludes_card_appearance_pose_and_camera_from_translation() -> None:
    page, characters = _fixture()
    panel = page.panels[0]
    panel.extra.update(props="飞起的画纸", atmosphere="放学后的大风")
    todo = translation_todo(page, characters, {})
    entry = todo["panels"][0]
    assert "只翻译" in todo["instructions"]
    assert "人物外观和服装" in todo["instructions"]
    assert entry["source_zh"] == {
        "description": panel.description,
        "props": "飞起的画纸",
        "atmosphere": "放学后的大风",
    }
    assert all(character.appearance_zh not in entry["caption_zh"] for character in characters.values())
    assert all(character.appearance_en not in str(todo) for character in characters.values())
    assert "appearances_en" not in entry
    assert "pose_templates_en" not in entry
    assert all("不翻译" in character["appearance"] for character in entry["characters"])


def test_appearance_is_inserted_verbatim_in_six_panels_and_updates_without_retranslation() -> None:
    page, characters = _fixture(panels=6)
    _translate(page, characters)
    caches = [copy.deepcopy(panel.caption_auto_en) for panel in page.panels]
    old = characters["whale"].appearance_en
    before = compile_page(page, characters, with_ids=True)
    assert all(old in item["caption"] for item in before["items"] if item["label"] == "object")
    new = "short silver hair; a turquoise coat, a coral-red skirt，a gold whale ornament."
    characters["whale"].appearance_en = new
    characters["whale"].appearance_zh = "银色短发，青绿色外套配珊瑚红半裙，金色鲸鱼头饰"
    after = compile_page(page, characters, with_ids=True)
    captions = [item["caption"] for item in after["items"] if item["label"] == "object"]
    assert len(captions) == 6
    assert all(new in caption and old not in caption for caption in captions)
    assert [panel.caption_auto_en for panel in page.panels] == caches
    assert all(translation_state(panel, page, characters) == "fresh" for panel in page.panels)
    assert translation_todo(page, characters, {})["panels"] == []


def test_compiler_orders_position_camera_character_pose_then_scene() -> None:
    page, characters = _fixture()
    _translate(page, characters)
    caption = panel_caption(page.panels[0], page, characters)
    assert caption.index("panel:") < caption.index("Medium shot, eye-level.")
    assert caption.index("Medium shot, eye-level.") < caption.index(characters["sylvia"].appearance_en)
    assert caption.index(characters["sylvia"].appearance_en) < caption.index("standing")
    assert caption.index("standing") < caption.index("Beside the rooftop railing")
    assert caption.count(characters["whale"].appearance_en) == 1


@pytest.mark.parametrize("language", ["zh", "en"])
def test_same_name_trigger_does_not_move_name_after_appearance(language: str) -> None:
    _, characters = _fixture()
    character = characters["sylvia"]
    character.trigger_words = ["Sylvia", "Sylvia", "sylvia_identity"]
    caption = character_caption("sylvia", characters, language)
    appearance = character.appearance_en if language == "en" else character.appearance_zh
    assert caption.startswith("Sylvia")
    assert caption.index("Sylvia") < caption.index(appearance)
    assert caption.count("Sylvia") == 1
    assert "sylvia_identity" in caption
    character.appearance_en = "Sylvia, long blonde hair, a white coat"
    character.appearance_zh = "Sylvia，金色长发，白色外套"
    caption = character_caption("sylvia", characters, language)
    appearance = character.appearance_en if language == "en" else character.appearance_zh
    assert caption.startswith(appearance)
    assert caption.count("Sylvia") == 1


def test_role_name_precedes_appearance_and_matching_trigger_is_deduplicated() -> None:
    _, characters = _fixture()
    character = characters["whale"]
    character.trigger_words = ["the whale girl", "whale_identity"]
    caption = character_caption("whale", characters, "en")
    assert caption.startswith("the whale girl, " + character.appearance_en)
    assert caption.count("the whale girl") == 1
    assert "whale_identity" in caption
    character.appearance_en = "the whale girl, long navy hair, a blue dress"
    caption = character_caption("whale", characters, "en")
    assert caption.startswith(character.appearance_en)
    assert caption.count("the whale girl") == 1
    character.appearance_en = "long navy hair framing the whale girl's face, a blue dress"
    caption = character_caption("whale", characters, "en")
    assert caption.startswith("the whale girl, " + character.appearance_en)


@pytest.mark.parametrize("language", ["zh", "en"])
def test_multi_character_outfit_distinction_is_explicit(language: str) -> None:
    page, characters = _fixture()
    _translate(page, characters)
    caption = panel_caption(page.panels[0], page, characters, language)
    if language == "en":
        assert "each character keeps their own outfit:" in caption
        assert "Sylvia in a white blouse under a dark grey pinafore dress" in caption
        assert "the whale girl in a blue frilled dress" in caption
    else:
        assert "每个角色保持各自的服装：" in caption
        assert "Sylvia穿白色衬衫外搭深灰背心裙" in caption
        assert "鲸鱼娘穿蓝色荷边连衣裙" in caption


def test_single_character_panel_has_no_shared_outfit_statement() -> None:
    page, characters = _fixture()
    page.panels[0].figures.pop()
    page.panels[0].character_ids = ["sylvia"]
    _translate(page, characters)
    assert "each character keeps their own outfit" not in panel_caption(page.panels[0], page, characters)


def test_single_character_keeps_separate_clothing_and_deduplicates_card_details() -> None:
    page, characters = _fixture()
    panel = page.panels[0]
    panel.figures = [Figure("whale")]
    panel.character_ids = ["whale"]
    character = characters["whale"]
    character.appearance_en = "long blue hair"
    character.clothing = ["a red coat", "a red coat"]
    _translate(page, characters)
    caption = panel_caption(panel, page, characters)
    assert "long blue hair" in caption
    assert caption.count("a red coat") == 1
    character.appearance_en = "long blue hair, a red coat"
    caption = panel_caption(panel, page, characters)
    assert character.appearance_en in caption
    assert caption.count("a red coat") == 1


def test_only_scene_prose_affects_source_hash() -> None:
    page, characters = _fixture()
    panel = page.panels[0]
    _translate(page, characters)
    initial = source_hash(panel, page, characters)
    panel.shot, panel.angle = "long", "low"
    panel.figures[0].pose = "sit"
    panel.shape["x"] = 100
    characters["sylvia"].clothing = ["a black jacket"]
    characters["sylvia"].trigger_words = ["new_identity"]
    assert source_hash(panel, page, characters) == initial
    assert translation_state(panel, page, characters) == "fresh"
    panel.extra["props"] = "一把伞"
    assert source_hash(panel, page, characters) != initial
    assert translation_state(panel, page, characters) == "stale"


def test_old_full_sentence_cache_requires_migration_even_with_current_hash() -> None:
    page, characters = _fixture()
    panel = page.panels[0]
    legacy_text = "Medium shot, eye-level. Sylvia wears an obsolete red dress beside the whale girl."
    panel.caption_auto_en = {"text": legacy_text, "source_hash": source_hash(panel, page, characters)}
    assert translation_state(panel, page, characters) == "legacy"
    warning = next(
        issue
        for issue in validate_page(page, characters).warnings
        if issue.code == "caption_translation_legacy"
    )
    assert "需要重新翻译" in warning.message
    assert "--todo" in warning.message
    assert "--apply" in warning.message
    todo = translation_todo(page, characters, {})["panels"][0]
    assert todo["status"] == "legacy"
    assert "角色外观由编译器统一插入" in todo["migration"]
    assert legacy_text not in panel_caption(panel, page, characters)
    assert "obsolete red dress" not in panel_caption(panel, page, characters)
    _translate(page, characters)
    assert panel.caption_auto_en["format"] == "scene-v1"
    assert translation_state(panel, page, characters) == "fresh"
