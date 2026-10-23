"""U2 regressions: saved MOSS fidelity, BOM inputs and bilingual outfits."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from soda_storyboard.bundle import export_bundle, load_bundle
from soda_storyboard.captions import character_caption, clothing_phrases
from soda_storyboard.compiler import compile_page
from soda_storyboard.importers import import_storyboard
from soda_storyboard.io import load_character, load_page, load_project, read_json, save_page, write_json
from soda_storyboard.json_safety import InvalidJSONNumberError, loads_json
from soda_storyboard.models import Character, Figure, Page, Panel, Project, RectShape
from soda_storyboard.translations import apply_translations, translation_todo
from soda_storyboard.validation import validate_page

if TYPE_CHECKING:
    from collections.abc import Callable


@pytest.mark.parametrize("with_ids", [False, True])
def test_external_moss_roundtrip_after_save_preserves_original_items(
    tmp_path: Path, *, with_ids: bool
) -> None:
    source = read_json(Path(__file__).parents[1] / "docs/examples/external-moss.json")
    page, _ = import_storyboard(source)
    path = save_page(page, tmp_path / "imported.json")
    result = compile_page(load_page(path), with_ids=with_ids)
    for original, output in zip(source["items"], result["items"], strict=True):
        assert {key: output[key] for key in original} == original
        if not with_ids:
            assert output == original
    assert result["items"][0]["bbox"] == [-420, -560, 420, 560]
    # Display geometry stays inside the canvas; compilation must not use it unchanged.
    reloaded = load_page(path)
    assert reloaded.objects[0].rect.x == 0
    reloaded.objects[0].rect.x = 24
    reloaded.objects[0].rect.w = 300
    reloaded.objects[0].caption = "An edited counter"
    edited = compile_page(reloaded)["items"]
    assert edited[0]["bbox"] == [-420, -488, 420, -188]
    assert edited[0]["caption"] == "An edited counter"
    assert edited[1:] == source["items"][1:]


def test_legacy_import_snapshot_preserves_source_but_keeps_real_edits() -> None:
    source = read_json(Path(__file__).parents[1] / "docs/examples/external-moss.json")
    page, _ = import_storyboard(source)
    metadata = page.extra["moss_import"]
    metadata.pop("snapshot_format", None)
    # Exact mixed-int/float snapshot recorded by the e967fe9 importer for U2.
    metadata["entries"][0]["snapshot"] = "742630f440298e3209855c4a9a3aa706c39e3c4b1acfbb5959eecc2bd2f192dc"
    assert compile_page(Page.from_dict(page.to_dict()))["items"] == source["items"]
    page.objects[0].caption = "An edited counter"
    assert compile_page(page)["items"][0]["caption"] == "An edited counter"


@pytest.mark.parametrize(
    ("value", "loader"),
    [
        (Page().to_dict(), load_page),
        (Project().to_dict(), load_project),
        (Character("qingyu", "晴雨").to_dict(), load_character),
    ],
)
def test_bom_model_inputs_and_bom_free_writes(tmp_path: Path, value: dict, loader: Callable) -> None:
    path = tmp_path / "model.json"
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8-sig")
    model = loader(path)
    assert model.to_dict() == value
    write_json(path, model)
    assert not path.read_bytes().startswith(b"\xef\xbb\xbf")


def test_bom_import_string() -> None:
    page, _ = import_storyboard('\ufeff{"frames":[{"description":"雨后的书店"}]}')
    assert page.panels[0].description == "雨后的书店"


@pytest.mark.parametrize("as_bytes", [False, True])
def test_bom_parser_keeps_numeric_safety(*, as_bytes: bool) -> None:
    content = '\ufeff{"seed":9223372036854775807}'
    assert loads_json(content.encode("utf-8") if as_bytes else content)["seed"] == 9223372036854775807
    invalid = '\ufeff{"value":1e999}'
    with pytest.raises(InvalidJSONNumberError):
        loads_json(invalid.encode("utf-8") if as_bytes else invalid)


def test_bom_import_file_cli(tmp_path: Path) -> None:
    from soda_storyboard.cli import main  # noqa: PLC0415

    source = tmp_path / "import.json"
    source.write_text('{"frames":[{"description":"A shop after the rain"}]}', encoding="utf-8-sig")
    assert main(["import", str(source), "--project", str(tmp_path), "--page-id", "imported", "--json"]) == 0
    saved = tmp_path / "pages/imported.json"
    assert load_page(saved).panels[0].description == "A shop after the rain"
    assert not saved.read_bytes().startswith(b"\xef\xbb\xbf")


def test_bom_translation_file(tmp_path: Path) -> None:
    page = Page(panels=[Panel("p1", 1, RectShape(0, 0, 500, 500), description="门前的小猫")])
    todo = translation_todo(page, {}, {})["panels"][0]
    path = tmp_path / "translations.json"
    path.write_text(
        json.dumps([{"panel_id": "p1", "source_hash": todo["source_hash"], "text": "A kitten at the door."}]),
        encoding="utf-8-sig",
    )
    # The public CLI accepts translation arrays as well as objects.
    from soda_storyboard.cli import main  # noqa: PLC0415

    page_path = save_page(page, tmp_path / "pages/page.json")
    assert main(["translate", str(page_path), "--apply", str(path), "--json"]) == 0
    assert load_page(page_path).panels[0].caption_auto_en["text"] == "A kitten at the door."


def test_bom_bundle_file(tmp_path: Path) -> None:
    page_path = save_page(Page(), tmp_path / "pages/page.json")
    output = tmp_path / "bundle.json"
    export_bundle(page_path, output=output, no_sketch=True)
    bundle = read_json(output)
    path = tmp_path / "bundle.json"
    path.write_text(json.dumps(bundle), encoding="utf-8-sig")
    assert load_bundle(path)


@pytest.mark.parametrize("appearance_en", ["short black hair", "short black hair, a cyan raincoat"])
def test_english_character_caption_excludes_chinese_clothing(appearance_en: str) -> None:
    card = Character(
        "qingyu",
        "晴雨",
        appearance_zh="黑色短发",
        appearance_en=appearance_en,
        clothing=["青色雨衣", "a yellow scarf"],
        role_en="the traveler",
    )
    characters = {card.id: card}
    assert "青色雨衣" not in character_caption(card.id, characters, "en")
    assert "a yellow scarf" in character_caption(card.id, characters, "en")
    assert "青色雨衣" not in ";".join(clothing_phrases(card, "en"))
    assert "青色雨衣" in character_caption(card.id, characters, "zh")
    page = Page(panels=[Panel("p1", 1, RectShape(0, 0, 500, 500), figures=[Figure(card.id)])])
    panel = page.panels[0]
    todo = translation_todo(page, characters, {})["panels"][0]
    apply_translations(
        page,
        characters,
        [{"panel_id": panel.id, "source_hash": todo["source_hash"], "text": "A kitten at the door."}],
    )
    for item in compile_page(page, characters)["items"]:
        assert "青色雨衣" not in item["caption"]
    warnings = validate_page(page, characters).warnings
    assert any(w.code == "character_clothing_translation_needed" for w in warnings)


def test_english_character_caption_does_not_fall_back_to_chinese_identity() -> None:
    card = Character("qingyu", "晴雨", appearance_zh="青色雨衣", age="成年", clothing=["青色雨衣"])
    assert character_caption(card.id, {card.id: card}, "en") == "qingyu"
    assert "青色雨衣" in character_caption(card.id, {card.id: card}, "zh")


def test_multi_character_outfit_distinction_uses_english_only() -> None:
    characters = {
        "a": Character("a", "晴雨", appearance_en="a cyan raincoat", clothing=["青色雨衣"], role_en="Qingyu"),
        "b": Character("b", "店主", appearance_en="a brown coat", clothing=["棕色外套"]),
    }
    page = Page(panels=[Panel("p1", 1, RectShape(0, 0, 500, 500), figures=[Figure("a"), Figure("b")])])
    todo = translation_todo(page, characters, {})["panels"][0]
    apply_translations(
        page,
        characters,
        [{"panel_id": "p1", "source_hash": todo["source_hash"], "text": "They greet each other."}],
    )
    caption = compile_page(page, characters)["items"][0]["caption"]
    assert "a cyan raincoat" in caption
    assert "a brown coat" in caption
    assert "青色雨衣" not in caption
    assert "棕色外套" not in caption
    assert "店主" not in caption
