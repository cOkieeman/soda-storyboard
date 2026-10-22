from __future__ import annotations

import json
import runpy
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from soda_storyboard.captions import source_hash
from soda_storyboard.cli import main
from soda_storyboard.extract import extract_image
from soda_storyboard.io import read_json, write_json
from soda_storyboard.models import Page, Panel, RectShape


def test_translate_cli_todo_apply_and_reject_changed_sources(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    page = Page(
        page_id="p", panels=[Panel("p1", 1, RectShape(0, 0, 512, 512), description="带猫胡子的女孩读书")]
    )
    path = write_json(tmp_path / "pages/p.json", page)
    write_json(tmp_path / "project.json", {"glossary": {"猫胡子": "cat whiskers"}, "caption_language": "en"})
    assert main(["translate", str(path), "--todo", "--json"]) == 0
    todo = json.loads(capsys.readouterr().out)
    assert todo["glossary"] == {"猫胡子": "cat whiskers"}
    assert "猫胡子" in todo["panels"][0]["caption_zh"]
    translations = write_json(
        tmp_path / "translations.json",
        {
            "translations": [
                {
                    "panel_id": "p1",
                    "source_hash": todo["panels"][0]["source_hash"],
                    "text": "A girl with cat whiskers reading a book.",
                }
            ]
        },
    )
    assert main(["translate", str(path), "--apply", str(translations), "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["applied"] == ["p1"]
    translated = read_json(path)
    assert translated["panels"][0]["caption_auto_en"]["translated_at"]
    translated["panels"][0]["description"] = "女孩合上书"
    write_json(path, translated)
    original = path.read_bytes()
    assert main(["translate", str(path), "--apply", str(translations), "--json"]) == 1
    assert json.loads(capsys.readouterr().out)["rejected"][0]["reason"] == "source_hash_mismatch"
    assert path.read_bytes() == original


def test_import_cli_writes_new_page_and_refuses_overwrite(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source = tmp_path / "story.md"
    source.write_text("1. 门打开\n2. 天空放晴", encoding="utf-8")
    assert main(["import", str(source), "--project", str(tmp_path), "--page-id", "imported", "--json"]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["report"]["panel_count"] == 2
    assert read_json(tmp_path / "pages/imported.json")["id"] == "imported"
    assert main(["import", str(source), "--project", str(tmp_path), "--page-id", "imported", "--json"]) == 2


def test_color_mode_classifies_panels_texts_and_title_without_ocr() -> None:
    image = Image.new("RGB", (800, 1200), "white")
    draw = ImageDraw.Draw(image)
    boxes = [
        (20, 180, 240, 430),
        (550, 180, 780, 430),
        (20, 450, 240, 700),
        (550, 450, 780, 700),
        (20, 720, 240, 970),
        (550, 720, 780, 970),
        (20, 990, 240, 1170),
    ]
    for box in boxes:
        draw.rectangle(box, outline="#00eeee", width=3)
        draw.rectangle((box[0] + 15, box[1] + 20, box[0] + 45, box[3] - 20), outline="#20dc60", width=2)
    draw.rectangle((270, 180, 520, 1170), outline="#e52010", width=3)
    draw.rectangle((270, 20, 780, 130), outline="#e52010", width=3)
    result = extract_image(image, mode="color")
    assert result["cyan_panel_count"] == 7
    assert result["protagonist_count"] == 1
    assert len(result["titles"]) == 1
    assert sum(item["color"] == "green" for item in result["texts"]) == 7
    assert all(item["text"] == "" for item in result["texts"])
    assert extract_image(image)["mode"] == "color"


def test_ab_translation_file_rejects_stale_hash_without_changing_source(tmp_path: Path) -> None:
    page = Page(page_id="p", panels=[Panel("p1", 1, RectShape(0, 0, 512, 512), description="窗边的书")])
    path = write_json(tmp_path / "pages/p.json", page)
    original = path.read_bytes()
    translations = write_json(
        tmp_path / "translations.json",
        {
            "translations": [
                {
                    "panel_id": "p1",
                    "text": "A book by the window.",
                    "source_hash": source_hash(page.panels[0], page, {}),
                }
            ]
        },
    )
    entry = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/ab_caption_lang.py"))
    output = tmp_path / "ab"
    arguments = [str(path), "--translations", str(translations), "--output-dir", str(output)]
    assert entry["main"](arguments) == 0
    assert read_json(output / "p.en.moss.json")["items"][0]["caption"] == "A book by the window."
    assert "窗边的书" in read_json(output / "p.zh.moss.json")["items"][0]["caption"]
    assert path.read_bytes() == original
    stale = read_json(translations)
    stale["translations"][0]["source_hash"] = "outdated"
    write_json(translations, stale)
    with pytest.raises(SystemExit) as error:
        entry["main"](arguments)
    assert error.value.code == 2
    assert path.read_bytes() == original
