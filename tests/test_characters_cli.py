from __future__ import annotations

import json
from pathlib import Path

import pytest

from soda_storyboard.cli import main
from soda_storyboard.io import read_json, write_json


def test_character_new_records_lora_outfits_and_references(
    tmp_path: Path, capsys: pytest.CaptureFixture
) -> None:
    assert (
        main(
            [
                "character",
                "new",
                "--project",
                str(tmp_path),
                "--id",
                "girl",
                "--name",
                "女孩",
                "--lora",
                "models/girl.safetensors",
                "--outfit",
                "校服",
                "--outfit",
                "帆布包",
                "--reference",
                "refs/front.png",
                "--reference",
                "refs/side.png",
                "--json",
            ]
        )
        == 0
    )
    card = read_json(tmp_path / "characters" / "girl.json")
    assert card["lora"] == {"path": "models/girl.safetensors", "strength": 0.8}
    assert card["clothing"] == ["校服", "帆布包"]
    assert card["reference_images"] == ["refs/front.png", "refs/side.png"]
    assert json.loads(capsys.readouterr().out)["character"] == card


def test_character_set_changes_only_supplied_fields(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    original = {
        "id": "girl",
        "name": "女孩",
        "appearance": {"zh": "黑色短发", "en": "short black hair", "artist_note": "keep"},
        "lora": {"path": "old.safetensors", "strength": 0.4, "custom": True},
        "clothing": ["校服"],
        "reference_images": ["front.png"],
        "custom": {"keep": [1, 2]},
    }
    path = write_json(tmp_path / "characters" / "custom-filename.json", original)
    assert (
        main(
            [
                "character",
                "set",
                "girl",
                "--project",
                str(tmp_path),
                "--lora-strength",
                "0.7",
                "--appearance-zh",
                "黑色长发",
                "--json",
            ]
        )
        == 0
    )
    expected = {
        **original,
        "appearance": {**original["appearance"], "zh": "黑色长发"},
        "lora": {**original["lora"], "strength": 0.7},
    }
    assert read_json(path) == expected
    assert json.loads(capsys.readouterr().out)["character"]["lora"]["strength"] == 0.7


def test_character_list_and_missing_set(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    write_json(tmp_path / "characters" / "girl.json", {"id": "girl", "display_name": "女孩"})
    assert main(["character", "list", "--project", str(tmp_path), "--json"]) == 0
    assert json.loads(capsys.readouterr().out)[0]["id"] == "girl"
    assert main(["character", "set", "missing", "--project", str(tmp_path), "--json"]) == 2
    assert not (tmp_path / "characters" / "missing.json").exists()


@pytest.mark.parametrize("lora", [{"path": "old", "strength": 0.35, "note": "keep"}, "old"])
def test_set_path_preserves_strength_and_lora_metadata(tmp_path: Path, lora: dict | str) -> None:
    original = {"id": "girl", "display_name": "Girl", "lora": lora}
    path = write_json(tmp_path / "characters" / "girl.json", original)
    assert main(["character", "set", "girl", "--project", str(tmp_path), "--lora", "new", "--json"]) == 0
    expected = {**lora, "path": "new"} if isinstance(lora, dict) else "new"
    assert read_json(path) == {**original, "lora": expected}


def test_set_legacy_fields_and_noop_preserve_raw_file(tmp_path: Path) -> None:
    original = {
        "id": "girl",
        "name": "Girl",
        "triggers": ["old"],
        "lora_path": "old",
        "lora_strength": 0.65,
        "references": ["old.png"],
        "appearance_zh": "old look",
        "unknown": 1,
    }
    path = write_json(tmp_path / "characters" / "girl.json", original)
    before = path.read_bytes()
    assert main(["character", "set", "girl", "--project", str(tmp_path), "--json"]) == 0
    assert path.read_bytes() == before
    assert (
        main(
            [
                "character",
                "set",
                "girl",
                "--project",
                str(tmp_path),
                "--name",
                "New",
                "--trigger",
                "first",
                "--trigger",
                "second",
                "--reference",
                "new.png",
                "--lora",
                "new",
                "--appearance-zh",
                "new look",
                "--json",
            ]
        )
        == 0
    )
    assert read_json(path) == {
        **original,
        "name": "New",
        "triggers": ["first", "second"],
        "references": ["new.png"],
        "lora_path": "new",
        "appearance_zh": "new look",
    }


def test_set_new_lora_and_repeated_lists(tmp_path: Path) -> None:
    path = write_json(
        tmp_path / "characters" / "girl.json",
        {
            "id": "girl",
            "appearance": "short hair",
            "clothing": ["old"],
            "reference_images": ["old.png"],
            "trigger_words": ["old"],
        },
    )
    assert (
        main(
            [
                "character",
                "set",
                "girl",
                "--project",
                str(tmp_path),
                "--lora",
                "girl.safetensors",
                "--outfit",
                "uniform",
                "--outfit",
                "bag",
                "--reference",
                "front.png",
                "--reference",
                "side.png",
                "--trigger",
                "new",
                "--appearance-en",
                "short black hair",
                "--json",
            ]
        )
        == 0
    )
    card = read_json(path)
    assert card["lora"] == {"path": "girl.safetensors", "strength": 0.8}
    assert card["clothing"] == ["uniform", "bag"]
    assert card["reference_images"] == ["front.png", "side.png"]
    assert card["trigger_words"] == ["new"]
    assert card["appearance"] == {"zh": "short hair", "en": "short black hair"}


@pytest.mark.parametrize("strength", ["nan", "inf", "-inf"])
def test_nonfinite_strength_never_writes(tmp_path: Path, strength: str) -> None:
    path = write_json(
        tmp_path / "characters" / "girl.json", {"id": "girl", "lora": {"path": "old", "strength": 0.8}}
    )
    before = path.read_bytes()
    assert (
        main(
            ["character", "set", "girl", "--project", str(tmp_path), f"--lora-strength={strength}", "--json"]
        )
        == 2
    )
    assert path.read_bytes() == before
    assert (
        main(
            [
                "character",
                "new",
                "--id",
                "new",
                "--project",
                str(tmp_path),
                "--lora",
                "new",
                f"--lora-strength={strength}",
                "--json",
            ]
        )
        == 2
    )
    assert not (tmp_path / "characters" / "new.json").exists()


def test_strength_requires_a_lora_and_old_new_behavior_remains(tmp_path: Path) -> None:
    assert main(["character", "new", "--id", "girl", "--project", str(tmp_path), "--json"]) == 0
    path = tmp_path / "characters" / "girl.json"
    card = read_json(path)
    assert card["display_name"] == "girl"
    assert "lora" not in card
    before = path.read_bytes()
    assert (
        main(["character", "set", "girl", "--project", str(tmp_path), "--lora-strength", "0.3", "--json"])
        == 2
    )
    assert path.read_bytes() == before
    assert (
        main(
            [
                "character",
                "new",
                "--id",
                "bad",
                "--project",
                str(tmp_path),
                "--lora-strength",
                "0.3",
                "--json",
            ]
        )
        == 2
    )
    assert not (tmp_path / "characters" / "bad.json").exists()
