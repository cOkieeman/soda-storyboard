# ruff: noqa: RUF001 -- verify Chinese punctuation
from __future__ import annotations

from soda_storyboard.captions import source_hash
from soda_storyboard.compiler import compile_page
from soda_storyboard.models import Character, Figure, Page, Panel, RectShape
from soda_storyboard.translations import apply_translations, translation_todo
from soda_storyboard.validation import validate_page


def fixture() -> tuple[Page, dict[str, Character]]:
    character = Character(
        "a", "小雨", appearance_zh="小雨穿白衬衫。", clothing=["白衬衫"], trigger_words=["rain", "rain"]
    )
    panel = Panel(
        "p", 1, RectShape(0, 0, 512, 512), description="小雨坐在一旁看书。", figures=[Figure("a", pose="lie")]
    )
    return Page(panels=[panel]), {"a": character}


def test_caption_cleanup_order_and_deduplication() -> None:
    page, characters = fixture()
    caption = compile_page(page, characters)["items"][0]["caption"]
    assert "第1格" not in caption
    assert caption.count("小雨") == 1
    assert caption.count("白衬衫") == 1
    assert caption.count("rain") == 1
    assert caption.index("躺") < caption.index("看书")
    assert "。，" not in caption
    assert "，，" not in caption
    assert caption.endswith("。")


def test_conflicting_pose_is_a_warning_and_never_rewrites_source() -> None:
    page, characters = fixture()
    original = page.panels[0].description
    warnings = validate_page(page, characters).warnings
    assert any(
        issue.code == "pose_description_conflict" and "坐" in issue.message and "躺" in issue.message
        for issue in warnings
    )
    assert page.panels[0].description == original


def test_translation_fresh_stale_missing_and_manual_override() -> None:
    page, characters = fixture()
    panel = page.panels[0]
    chinese = compile_page(page, characters)["items"][0]["caption"]
    assert "看书" in chinese
    result = apply_translations(
        page,
        characters,
        {
            "translations": [
                {
                    "panel_id": "p",
                    "source_hash": source_hash(panel, page, characters),
                    "text": "Panel 1, A girl lying beside a book, cat whiskers.",
                }
            ]
        },
    )
    assert result["applied"] == ["p"]
    assert (
        compile_page(page, characters)["items"][0]["caption"] == "A girl lying beside a book, cat whiskers."
    )
    assert translation_todo(page, characters, {})["panels"] == []
    panel.description = "她在窗边读书"
    assert "窗边" in compile_page(page, characters)["items"][0]["caption"]
    assert any(
        issue.code == "caption_translation_stale" for issue in validate_page(page, characters).warnings
    )
    panel.caption_en = "A custom illustration."
    panel.use_custom_caption = True
    assert compile_page(page, characters)["items"][0]["caption"] == panel.caption_en


def test_translation_rejects_hash_mismatch_and_preserves_existing_cache() -> None:
    page, characters = fixture()
    panel = page.panels[0]
    panel.caption_auto_en = {"text": "Keep me.", "source_hash": "old", "translated_at": "yesterday"}
    result = apply_translations(
        page, characters, [{"panel_id": "p", "text": "Replace me.", "source_hash": "bad"}]
    )
    assert result["rejected"] == [{"panel_id": "p", "reason": "source_hash_mismatch"}]
    assert panel.caption_auto_en["text"] == "Keep me."
