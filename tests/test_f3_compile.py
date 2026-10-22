"""F3 structured prompts, editor figures, and offline language comparison."""

from __future__ import annotations

import copy
import runpy
from pathlib import Path

import pytest

from soda_storyboard.captions import source_hash, structured_caption
from soda_storyboard.compiler import compile_page
from soda_storyboard.figure_rig import ensure_figure_editor
from soda_storyboard.geometry import from_moss_bbox
from soda_storyboard.io import read_json, write_json
from soda_storyboard.models import Character, Figure, Page, Panel, RectShape
from soda_storyboard.production.imaging import figure_mask


def sample() -> tuple[Page, dict[str, Character]]:
    figure = Figure("girl", pose="stand", facing="right")
    figure.extra["editor"] = {**ensure_figure_editor(figure, 500, 600), "x": 220, "y": 430, "size": 260}
    page = Page(
        panels=[Panel("p", 1, RectShape(80, 90, 500, 600), description="女孩望着窗外", figures=[figure])]
    )
    characters = {
        "girl": Character(
            "girl", "小雨", appearance_zh="黑发、白色衬衫", appearance_en="black hair, white shirt"
        )
    }
    return page, characters


def character_item(page: Page, characters: dict[str, Character]) -> dict:
    return next(item for item in compile_page(page, characters)["items"] if item["label"] == "character")


def test_editor_position_size_pose_and_facing_reach_moss() -> None:
    page, characters = sample()
    source = copy.deepcopy(page.to_dict())
    before = character_item(page, characters)
    figure = page.panels[0].figures[0]
    figure.extra["editor"]["x"] += 40
    translated = character_item(page, characters)
    assert translated["bbox"] == [
        before["bbox"][0],
        before["bbox"][1] + 40,
        before["bbox"][2],
        before["bbox"][3] + 40,
    ]
    figure.extra["editor"]["size"] = 330
    larger = character_item(page, characters)
    assert larger["bbox"][2] - larger["bbox"][0] > before["bbox"][2] - before["bbox"][0]
    figure.pose = "arms_up"
    figure.extra["editor"]["joints"] = ensure_figure_editor(Figure("girl", pose="arms_up"), 500, 600)[
        "joints"
    ]
    raised = character_item(page, characters)
    assert "双手举过头顶" in raised["caption"]
    assert raised["bbox"] != larger["bbox"]
    figure.facing = "left"
    figure.extra["editor"]["flip"] = True
    mirrored = character_item(page, characters)
    assert "左" in mirrored["caption"]
    assert "镜像" in mirrored["caption"]
    assert "左" in compile_page(page, characters)["items"][0]["caption"]
    assert source != page.to_dict()


def test_mask_matches_character_json_bounds() -> None:
    page, characters = sample()
    panel = page.panels[0]
    x, y, right, bottom = from_moss_bbox(character_item(page, characters)["bbox"], page.width, page.height)
    assert figure_mask(panel, page, "girl", margin=0, feather=0).getbbox() == (
        x - 80,
        y - 90,
        right - 80,
        bottom - 90,
    )


def test_chinese_is_default_and_overrides_are_explicit_and_round_trip() -> None:
    page, characters = sample()
    panel = page.panels[0]
    panel.caption_en = "An old hand-written prompt."
    first = compile_page(page, characters)["items"][0]["caption"]
    assert "女孩望着窗外" in first
    assert "黑发" in first
    assert "中景" in first
    assert "平视" in first
    panel.description = "女孩向门口跑去"
    assert "女孩向门口跑去" in compile_page(page, characters)["items"][0]["caption"]
    panel.use_custom_caption = True
    assert compile_page(page, characters)["items"][0]["caption"] == panel.caption_en
    panel.use_custom_caption = False
    assert compile_page(page, characters)["items"][0]["caption"] != panel.caption_en
    page.legacy_caption_en = True
    assert compile_page(page, characters)["items"][0]["caption"] == panel.caption_en
    assert Page.from_dict(page.to_dict()) == page
    page.legacy_caption_en = False
    raw = page.to_dict()
    raw["panels"][0].pop("use_custom_caption", None)
    assert Page.from_dict(raw).panels[0].use_custom_caption is False
    assert Page.from_dict(raw).panels[0].caption_en == panel.caption_en


@pytest.mark.parametrize("field", ["use_custom_caption", "legacy_caption_en"])
def test_caption_switches_require_real_booleans(field: str) -> None:
    raw = Page(panels=[Panel("p", 1, RectShape(0, 0, 200, 300))]).to_dict()
    target = raw["panels"][0] if field == "use_custom_caption" else raw
    target[field] = "false"
    with pytest.raises(TypeError, match="boolean"):
        Page.from_dict(raw)


def test_offline_ab_script_preserves_sources_and_uses_both_templates(tmp_path: Path) -> None:
    page, characters = sample()
    page.panels[0].extra["description_en"] = "A girl looks out of the window"
    page.panels[0].caption_auto_en = {
        "text": structured_caption(page.panels[0], page, characters, "en"),
        "source_hash": source_hash(page.panels[0], page, characters),
        "translated_at": "test",
    }
    page.panels[0].caption_en = "MANUAL OVERRIDE"
    page.panels[0].use_custom_caption = True
    source = write_json(tmp_path / "pages/p.json", page)
    write_json(tmp_path / "characters/girl.json", characters["girl"])
    before = source.read_bytes()
    entry = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/ab_caption_lang.py"))
    output = tmp_path / "ab"
    assert entry["main"]([str(source), "--output-dir", str(output)]) == 0
    zh = read_json(output / "p.zh.moss.json")
    en = read_json(output / "p.en.moss.json")
    assert "女孩望着窗外" in zh["items"][0]["caption"]
    assert "A girl looks out of the window" in en["items"][0]["caption"]
    assert "medium shot" in en["items"][0]["caption"]
    assert "black hair" in en["items"][0]["caption"]
    assert "MANUAL OVERRIDE" not in str(zh) + str(en)
    assert [item["bbox"] for item in zh["items"]] == [item["bbox"] for item in en["items"]]
    assert source.read_bytes() == before
    assert sorted(path.name for path in output.iterdir()) == ["p.en.moss.json", "p.zh.moss.json"]


def test_ab_reports_missing_translation_and_uses_only_translated_text(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    page, _ = sample()
    source = write_json(tmp_path / "pages/p.json", page)
    entry = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/ab_caption_lang.py"))
    output = tmp_path / "ab"
    entry["main"]([str(source), "--output-dir", str(output)])
    assert "English translations missing or stale; Chinese fallback for panels: p" in capsys.readouterr().err
    translation = copy.deepcopy(page.to_dict())
    translation["panels"][0]["description"] = "A girl looks out of the window"
    translation["panels"][0]["shape"]["x"] = 999
    translation["panels"][0]["figures"] = []
    translated = write_json(tmp_path / "translated.json", translation)
    entry["main"]([str(source), "--output-dir", str(output), "--english-page", str(translated)])
    assert capsys.readouterr().err == ""
    en = read_json(output / "p.en.moss.json")
    zh = read_json(output / "p.zh.moss.json")
    assert "A girl looks out of the window" in en["items"][0]["caption"]
    assert [item["bbox"] for item in zh["items"]] == [item["bbox"] for item in en["items"]]
