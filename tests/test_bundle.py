from __future__ import annotations

import base64
import copy
import io
import json
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from PIL import Image

from soda_storyboard import bundle as bundles
from soda_storyboard.bundle import BUNDLE_FORMAT, compile_bundle, export_bundle, load_bundle
from soda_storyboard.captions import source_hash, translation_state
from soda_storyboard.compiler import compile_page
from soda_storyboard.io import read_json, write_json
from soda_storyboard.models import Character, Figure, Page, Panel, RectShape

if TYPE_CHECKING:
    from collections.abc import Callable


@pytest.fixture
def pudding(tmp_path: Path) -> Path:
    source = Path(__file__).resolve().parents[1] / "examples" / "pudding"
    root = tmp_path / "pudding"
    shutil.copytree(source, root, ignore=shutil.ignore_patterns(".soda"))
    return root / "pages" / "pudding.json"


def _envelope(*, translated: bool = False, triggers: bool = False) -> dict:
    card = Character(
        "girl",
        "女孩",
        appearance_zh="女孩，黑发",  # noqa: RUF001 -- exercise Chinese caption punctuation
        appearance_en="a black-haired girl",
        trigger_words=["soda_girl"] if triggers else [],
    )
    page = Page(
        page_id="test",
        panels=[
            Panel("p1", 1, RectShape(24, 24, 976, 1488), description="窗边读书", figures=[Figure("girl")])
        ],
    )
    if translated:
        page.panels[0].caption_auto_en = {
            "format": "scene-v1",
            "source_hash": source_hash(page.panels[0], page, {card.id: card}),
            "text": "She reads by the window.",
            "translated_at": "2026-01-01T00:00:00Z",
        }
    return {
        "format": BUNDLE_FORMAT,
        "page": page.to_dict(),
        "project": {},
        "characters": {card.id: card.to_dict()},
    }


def test_pudding_export_preserves_raw_sources_and_compiles_identically(pudding: Path) -> None:
    root = pudding.parent.parent
    source_files = [pudding, root / "project.json", *(root / "characters").glob("*.json")]
    before = {path: path.read_bytes() for path in source_files}
    result = export_bundle(pudding)
    target = root / "exports" / "pudding.storyboard.json"
    assert result["path"] == str(target.resolve())
    raw = read_json(target)
    assert raw["format"] == BUNDLE_FORMAT
    assert raw["generator"].startswith("soda-storyboard ")
    assert raw["exported_at"].endswith("+00:00")
    assert raw["page"] == read_json(pudding)
    assert raw["project"] == read_json(root / "project.json")
    assert raw["characters"] == {path.stem: read_json(path) for path in (root / "characters").glob("*.json")}
    page, cards, settings, warnings = load_bundle(target)
    expected = read_json(pudding)
    for key in ("style_prompt", "tags"):
        expected[key] = settings[key]
    expected["caption_language"] = "en"
    assert page.to_dict() == Page.from_dict(expected).to_dict()
    assert {key: card.to_dict() for key, card in cards.items()} == {
        key: Character.from_dict(card).to_dict() for key, card in raw["characters"].items()
    }
    assert compile_bundle(target)["moss"] == compile_page(Page.from_dict(expected), cards)
    assert result["panel_count"] == len(raw["page"]["panels"])
    assert result["dialogue_count"] > 0
    assert set(result["characters"]) == {"older", "younger"}
    assert set(result["translation_status"].values()) == {"missing"}
    assert any("translate <页> --todo" in warning for warning in warnings)
    image_bytes = base64.b64decode(raw["sketch_png_base64"], validate=True)
    with Image.open(io.BytesIO(image_bytes)) as image:
        assert image.format == "PNG"
        assert max(image.size) == 768
        assert image.width * image.height <= bundles.MAX_SKETCH_PIXELS
    assert len(image_bytes) <= bundles.MAX_SKETCH_BYTES
    assert all(path.read_bytes() == original for path, original in before.items())


def test_export_only_includes_panels_figures_overlays_and_speakers(tmp_path: Path) -> None:
    raw = _envelope()["page"]
    raw["panels"][0]["character_ids"] = ["panel"]
    raw["panels"][0]["dialogue"] = [{"speaker_id": "dialogue", "text": "你好"}]
    raw["overlays"] = [{"id": "o", "character_id": "overlay", "rect": {"x": 20, "y": 20, "w": 100, "h": 100}}]
    raw["texts"] = [
        {"id": "t", "speaker_id": "text", "text": "早上好", "bbox": {"x": 30, "y": 30, "w": 200, "h": 100}}
    ]
    page_path = write_json(tmp_path / "pages/test.json", raw)
    for identifier in ("girl", "panel", "dialogue", "overlay", "text", "unused"):
        write_json(tmp_path / f"characters/{identifier}.json", Character(identifier, identifier))
    # Unrelated invalid cards do not prevent exporting this page.
    (tmp_path / "characters/unused.json").write_text("invalid unrelated document", encoding="utf-8")
    result = export_bundle(page_path, no_sketch=True)
    assert result["characters"] == ["dialogue", "girl", "overlay", "panel", "text"]
    assert set(read_json(result["path"])["characters"]) == set(result["characters"])


def test_export_portable_metadata_and_fresh_cache_without_mutation(tmp_path: Path) -> None:
    raw = _envelope(translated=True)
    raw["project"] = {
        "custom": {"keep": [1, True], "cache": "/home/example/cache.dat"},
        "comfy_url": "http://localhost:8188",
        "lan_url": "http://192.168.1.2:8188/api",
        "public_url": "https://example.com/docs",
    }
    card = raw["characters"]["girl"]
    card["reference_images"] = ["refs/sketch.png", r"C:\private\portrait.png"]
    card["approved_images"] = ["/home/example/final.png"]
    card["lora"] = {"path": r"C:\models\people\girl.safetensors", "strength": 0.75}
    card["custom"] = {"input": r"C:\private\project.json", "unknown": "retain me"}
    raw["page"]["unknown"] = {"asset": "file:///Users/example/sample.png", "keep": {"a": 1}}
    path = write_json(tmp_path / "pages/test.json", raw["page"])
    write_json(tmp_path / "project.json", raw["project"])
    card_path = write_json(tmp_path / "characters/girl.json", card)
    originals = {source: source.read_bytes() for source in (path, card_path, tmp_path / "project.json")}
    result = export_bundle(path, no_sketch=True)
    portable = read_json(result["path"])
    assert portable["characters"]["girl"]["reference_images"] == ["sketch.png", "portrait.png"]
    assert portable["characters"]["girl"]["approved_images"] == ["final.png"]
    assert portable["characters"]["girl"]["lora"]["path"] == "girl.safetensors"
    assert portable["project"]["custom"] == {"keep": [1, True], "cache": "cache.dat"}
    assert portable["project"]["comfy_url"] == ""
    assert portable["project"]["lan_url"] == ""
    assert portable["project"]["public_url"] == "https://example.com/docs"
    assert portable["page"]["unknown"] == {"asset": "sample.png", "keep": {"a": 1}}
    assert portable["characters"]["girl"]["custom"] == {"input": "project.json", "unknown": "retain me"}
    assert portable["page"]["panels"][0]["caption_auto_en"] == raw["page"]["panels"][0]["caption_auto_en"]
    assert result["translation_status"] == {"p1": "fresh"}
    assert result["lora"] == {"character_id": "girl", "filename": "girl.safetensors", "strength": 0.75}
    assert "sketch_png_base64" not in portable
    assert all(source.read_bytes() == original for source, original in originals.items())


@pytest.mark.parametrize(
    "kind", ["geometry", "missing_card", "card_id", "output_source", "output_project", "output_card"]
)
def test_export_rejects_invalid_without_writing(tmp_path: Path, kind: str) -> None:
    raw = _envelope()
    if kind == "geometry":
        raw["page"]["panels"][0]["shape"]["w"] = 3000
    if kind == "card_id":
        raw["characters"]["girl"]["id"] = "other"
    path = write_json(tmp_path / "pages/test.json", raw["page"])
    project_path = write_json(tmp_path / "project.json", {})
    card_path = tmp_path / "characters/girl.json"
    if kind != "missing_card":
        write_json(card_path, raw["characters"]["girl"])
    output = {"output_source": path, "output_project": project_path, "output_card": card_path}.get(
        kind, tmp_path / "exports/keep.json"
    )
    if kind not in {"output_source", "output_project", "output_card"}:
        output.parent.mkdir()
        output.write_text("previous output", encoding="utf-8")
    before = output.read_bytes()
    with pytest.raises(ValueError, match=r"校验失败|角色卡 id|不能覆盖"):
        export_bundle(path, output=output, no_sketch=True)
    assert output.read_bytes() == before


def test_invalid_export_does_not_create_default_directory(tmp_path: Path) -> None:
    raw = _envelope()["page"]
    raw["canvas_width"] = 0
    path = write_json(tmp_path / "pages/test.json", raw)
    write_json(tmp_path / "characters/girl.json", Character("girl", "女孩"))
    with pytest.raises(ValueError, match="校验失败"):
        export_bundle(path)
    assert not (tmp_path / "exports").exists()


def test_bundle_inherits_project_defaults_and_respects_page_aliases() -> None:
    raw = _envelope()
    raw["page"] = {"id": "p", "panels": []}
    raw["project"] = {
        "default_canvas_width": 1536,
        "default_canvas_height": 1024,
        "default_style_prefix": "a style",
        "default_dialogue_mode": "lettering",
        "reading_direction": "ltr",
        "text_direction": "horizontal",
        "color_mode": "color",
        "style_prompt": "project style",
        "caption_language": "zh",
        "tags": ["test"],
        "unknown": {"kept": True},
    }
    before = copy.deepcopy(raw)
    page, _, settings, _ = load_bundle(raw)
    assert page.canvas_size == (1536, 1024)
    assert page.style_prefix == "a style"
    assert page.dialogue_mode == "lettering"
    assert page.reading_direction == "ltr"
    assert page.text_direction == "horizontal"
    assert page.color_mode == "color"
    assert page.caption_language == "zh"
    assert page.style_prompt == "project style"
    assert page.tags == ["test"]
    assert settings == before["project"]
    raw["page"].update(
        canvas={"width": 1024, "height": 1536},
        direction="rtl",
        lettering_mode="moss_text",
        style="page style",
    )
    page, _, _, _ = load_bundle(raw)
    assert page.canvas_size == (1024, 1536)
    assert page.reading_direction == "rtl"
    assert page.dialogue_mode == "moss_text"
    assert page.style_prefix == "page style"
    assert before["page"] == {"id": "p", "panels": []}


def test_compile_overrides_dialogue_mode_without_modifying_bundle() -> None:
    raw = _envelope(translated=True)
    raw["page"]["texts"] = [{"id": "t", "text": "你好", "bbox": {"x": 100, "y": 100, "w": 200, "h": 100}}]
    before = copy.deepcopy(raw)
    page, cards, _, _ = load_bundle(raw)
    page.dialogue_mode = "lettering"
    actual = compile_bundle(raw, dialogue_mode="lettering", slant_mode="hint")
    assert actual["moss"] == compile_page(page, cards, slant_mode="hint")
    assert actual["width"] == 1024
    assert actual["height"] == 1536
    assert not any(item["label"] == "text" for item in actual["moss"]["items"])
    assert raw == before
    with pytest.raises(ValueError, match="台词模式"):
        compile_bundle(raw, dialogue_mode="bad-mode")


def test_trigger_suppression_keeps_fresh_translation_and_manual_override() -> None:
    raw = _envelope(translated=True, triggers=True)
    before = copy.deepcopy(raw)
    result = compile_bundle(raw, include_triggers=False)
    captions = " ".join(
        [result["moss"]["summary"]["caption"], *(item["caption"] for item in result["moss"]["items"])]
    )
    assert "soda_girl" not in captions
    assert "reads by the window" in captions
    assert "窗边读书" not in captions
    assert not any("译文" in warning for warning in result["warnings"])
    assert "soda_girl" in json.dumps(compile_bundle(raw)["moss"])
    assert raw == before
    raw["page"]["panels"][0].update(
        caption_en="soda_girl, A manually overridden portrait.", use_custom_caption=True
    )
    result = compile_bundle(raw, include_triggers=False)
    assert "soda_girl" not in json.dumps(result["moss"])
    assert "manually overridden portrait" in result["moss"]["items"][0]["caption"]


def test_trigger_suppression_does_not_make_stale_cache_fresh() -> None:
    raw = _envelope(translated=True, triggers=True)
    raw["page"]["panels"][0]["description"] = "窗边读书，合上书本"  # noqa: RUF001
    result = compile_bundle(raw, include_triggers=False)
    assert "窗边读书" in result["moss"]["items"][0]["caption"]
    assert "reads by the window" not in result["moss"]["items"][0]["caption"]
    assert any("已过期" in warning for warning in result["warnings"])


def test_trigger_suppression_handles_chinese_adjacent_tokens_without_removing_longer_words() -> None:
    raw = _envelope()
    raw["characters"]["girl"]["trigger_words"] = ["cat"]
    raw["page"]["panels"][0].update(
        caption_en="中文cat标签, cat portrait with catlike features.", use_custom_caption=True
    )
    caption = compile_bundle(raw, include_triggers=False)["moss"]["items"][0]["caption"]
    assert "中文标签" in caption
    assert "cat portrait" not in caption
    assert "catlike features" in caption


def test_bare_page_missing_cards_warns_and_keeps_overlay_geometry() -> None:
    raw = _envelope()["page"]
    raw["overlays"] = [
        {"id": "o", "character_id": "girl", "mode": "moss", "rect": {"x": 100, "y": 100, "w": 200, "h": 300}}
    ]
    page, cards, settings, warnings = load_bundle(raw)
    assert cards == settings == {}
    assert bundles.MISSING_CHARACTERS in warnings
    result = compile_bundle(raw)
    assert result["moss"] == compile_page(page, cards)
    raw["overlays"][0]["rect"]["w"] = 3000
    with pytest.raises(ValueError, match="画布内"):
        load_bundle(raw)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda raw: raw.update(format="soda-storyboard-bundle-v2"),
        lambda raw: raw.update(project=[]),
        lambda raw: raw.update(characters=[]),
        lambda raw: raw.update(page=None),
        lambda raw: raw["characters"]["girl"].update(id="different"),
        lambda raw: raw.update(sketch_png_base64="not base64"),
        lambda raw: raw["characters"].update(girl="invalid"),
        lambda raw: raw["page"].update(dialogue_mode="invalid"),
    ],
)
def test_bundle_rejects_invalid_envelope(mutate: Callable[[dict], None]) -> None:
    raw = _envelope()
    mutate(raw)
    with pytest.raises((ValueError, TypeError)):
        load_bundle(raw)


def test_loader_accepts_utf8_bom_and_rejects_nonobject_and_oversized_files(tmp_path: Path) -> None:
    path = tmp_path / "p.json"
    path.write_text(json.dumps(_envelope()), encoding="utf-8-sig")
    assert load_bundle(path)[0].id == "test"
    path.write_text("[]", encoding="utf-8")
    with pytest.raises(TypeError, match="JSON 对象"):
        load_bundle(path)
    with path.open("wb") as stream:
        stream.truncate(bundles.MAX_FILE_BYTES + 1)
    with pytest.raises(ValueError, match="16 MiB"):
        load_bundle(path)


def test_loader_rejects_large_or_wrong_format_sketch() -> None:
    raw = _envelope()
    with io.BytesIO() as output:
        Image.new("RGB", (10, 10)).save(output, format="JPEG")
        raw["sketch_png_base64"] = base64.b64encode(output.getvalue()).decode("ascii")
    with pytest.raises(ValueError, match="PNG"):
        load_bundle(raw)
    with io.BytesIO() as output:
        Image.new("RGB", (2001, 2000)).save(output, format="PNG")
        raw["sketch_png_base64"] = base64.b64encode(output.getvalue()).decode("ascii")
    with pytest.raises(ValueError, match="400 万像素"):
        load_bundle(raw)


def test_load_and_compile_are_repeatable_and_leave_input_fresh() -> None:
    raw = _envelope(translated=True)
    before = copy.deepcopy(raw)
    first = compile_bundle(raw)
    assert compile_bundle(raw) == first
    page, cards, _, _ = load_bundle(raw)
    assert translation_state(page.panels[0], page, cards) == "fresh"
    assert raw == before


def test_export_enforces_actual_indented_size_before_writing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    raw = _envelope()
    raw["page"]["custom"] = [{"a": "x", "b": [1, 2, 3]} for _ in range(40)]
    source = write_json(tmp_path / "pages/test.json", raw["page"])
    write_json(tmp_path / "characters/girl.json", raw["characters"]["girl"])
    result = export_bundle(source, no_sketch=True)
    exported = read_json(result["path"])
    small = len(json.dumps(exported, ensure_ascii=False).encode("utf-8"))
    large = Path(result["path"]).stat().st_size
    assert small < large
    monkeypatch.setattr(bundles, "MAX_FILE_BYTES", (small + large) // 2)
    target = tmp_path / "rejected/bundle.json"
    with pytest.raises(ValueError, match="16 MiB"):
        export_bundle(source, output=target, no_sketch=True)
    assert not target.parent.exists()


def test_dict_source_obeys_file_size_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    raw = _envelope()
    monkeypatch.setattr(bundles, "MAX_FILE_BYTES", 1)
    with pytest.raises(ValueError, match="16 MiB"):
        load_bundle(raw)


@pytest.mark.parametrize(
    "lora", ["nested/girl.safetensors", {"path": "nested/girl.safetensors", "strength": 0.7}]
)
def test_relative_lora_aliases_export_filename_only(tmp_path: Path, lora: str | dict) -> None:
    raw = _envelope()
    raw["characters"]["girl"]["lora"] = lora
    source = write_json(tmp_path / "pages/test.json", raw["page"])
    write_json(tmp_path / "characters/girl.json", raw["characters"]["girl"])
    result = export_bundle(source, no_sketch=True)
    portable = read_json(result["path"])["characters"]["girl"]["lora"]
    assert portable == "girl.safetensors" if isinstance(lora, str) else portable["path"] == "girl.safetensors"


def test_portable_path_cleanup_keeps_prose_after_embedded_path(tmp_path: Path) -> None:
    raw = _envelope()
    raw["page"]["custom"] = {
        "windows_note": r"Read C:\private\file.png then keep this explanation.",
        "posix_note": "Read /home/example/file.png then keep this explanation.",
    }
    source = write_json(tmp_path / "pages/test.json", raw["page"])
    write_json(tmp_path / "characters/girl.json", raw["characters"]["girl"])
    result = export_bundle(source, no_sketch=True)
    notes = read_json(result["path"])["page"]["custom"]
    assert notes["windows_note"] == notes["posix_note"] == "Read file.png then keep this explanation."


def test_root_package_exports_shared_bundle_api() -> None:
    import soda_storyboard  # noqa: PLC0415 -- exercise public root-package imports

    assert soda_storyboard.load_bundle is load_bundle
    assert soda_storyboard.compile_bundle is compile_bundle
    assert soda_storyboard.export_bundle is export_bundle
    assert {"load_bundle", "compile_bundle", "export_bundle"} <= set(soda_storyboard.__all__)
