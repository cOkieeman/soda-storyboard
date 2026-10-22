from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

import soda_storyboard
from soda_storyboard import importers
from soda_storyboard.cli import main
from soda_storyboard.io import read_json, write_json

if TYPE_CHECKING:
    import pytest

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "pudding"


def test_export_bundle_cli_default_summary_and_no_sketch(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    project = tmp_path / "story"
    shutil.copytree(EXAMPLE, project, ignore=shutil.ignore_patterns(".soda"))
    unused = read_json(project / "characters/older.json")
    unused["id"] = "unused"
    write_json(project / "characters/unused.json", unused)
    original = (project / "pages/pudding.json").read_bytes()
    assert main(["export-bundle", str(project / "pages/pudding.json"), "--no-sketch", "--json"]) == 0
    captured = capsys.readouterr()
    result = json.loads(captured.out)
    target = project / "exports/pudding.storyboard.json"
    assert Path(result["path"]) == target
    assert result["panel_count"] == 5
    assert set(result["characters"]) == {"older", "younger"}
    assert "translate" in captured.err
    assert "--todo" in captured.err
    payload = read_json(target)
    assert payload["format"] == "soda-storyboard-bundle-v1"
    assert not payload.get("sketch_png_base64")
    assert payload["page"] == read_json(project / "pages/pudding.json")
    assert (project / "pages/pudding.json").read_bytes() == original
    assert "unused" not in payload["characters"]


def test_export_bundle_cli_validation_refuses_to_replace_existing_output(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    page = {
        "format": "soda-storyboard-page-v1",
        "id": "bad",
        "canvas_width": 512,
        "canvas_height": 512,
        "panels": [
            {"id": "p1", "order": 1, "shape": {"type": "rect", "x": -100, "y": 0, "w": 200, "h": 200}}
        ],
    }
    source = write_json(tmp_path / "pages/bad.json", page)
    target = tmp_path / "bundle.json"
    target.write_text("keep existing output", encoding="utf-8")
    assert main(["export-bundle", str(source), "--output", str(target), "--json"]) == 2
    assert "error" in json.loads(capsys.readouterr().out)
    assert target.read_text(encoding="utf-8") == "keep existing output"


def test_public_external_import_and_bundle_schema_contract() -> None:
    assert {"import_moss", "import_storyboard"} <= set(importers.__all__)
    assert {"infer_dimensions", "CANVAS_PRESETS", "import_moss", "import_storyboard"} <= set(
        soda_storyboard.__all__
    )
    assert {"load_bundle", "compile_bundle", "export_bundle"} <= set(soda_storyboard.__all__)
    schema = read_json(Path(__file__).resolve().parents[1] / "schema/storyboard-v1.schema.json")
    contract = schema["$defs"]["bundle"]
    assert contract["properties"]["format"]["const"] == "soda-storyboard-bundle-v1"
    assert {"page", "project", "characters", "exported_at", "generator"} <= set(contract["required"])
    card_options = contract["properties"]["characters"]["additionalProperties"]["anyOf"]
    legacy_card = next(option for option in card_options if option.get("type") == "object")
    assert legacy_card["required"] == ["id"]
    assert legacy_card["additionalProperties"] is True


def test_export_legacy_character_cards_retains_raw_aliases(tmp_path: Path) -> None:
    project = tmp_path / "story"
    shutil.copytree(EXAMPLE, project, ignore=shutil.ignore_patterns(".soda"))
    cards = {
        "older": {"id": "older", "name": "姐姐", "custom": {"note": "retain me"}},
        "younger": {"id": "younger", "name": "妹妹"},
    }
    for identifier, card in cards.items():
        write_json(project / "characters" / f"{identifier}.json", card)
    result = soda_storyboard.export_bundle(project / "pages/pudding.json", no_sketch=True)
    assert read_json(result["path"])["characters"] == cards
    _, loaded, _, _ = soda_storyboard.load_bundle(result["path"])
    assert loaded["older"].display_name == "姐姐"
    assert loaded["older"].extra["custom"] == {"note": "retain me"}
