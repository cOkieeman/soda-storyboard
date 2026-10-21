from __future__ import annotations

import argparse
import copy
import json
import re
import shlex
from pathlib import Path

import pytest

from soda_storyboard.cli import build_parser, main
from soda_storyboard.compiler import compile_page
from soda_storyboard.io import load_character, load_page, read_json, write_json
from soda_storyboard.templates import RECIPES
from soda_storyboard.validation import validate_page

PACKAGE = Path(__file__).resolve().parents[1] / "skill"
SKILL = PACKAGE / "skills" / "soda-storyboard"
DOCUMENTS = [*PACKAGE.rglob("*.md"), PACKAGE.parent / "README.md"]


def _document_commands(path: Path) -> list[list[str]]:
    content = path.read_text(encoding="utf-8")
    snippets = re.findall(r"(?<!`)`([^`\n]+)`(?!`)", content)
    for block in re.findall(r"```(?:shell|bash|powershell|console)\n(.*?)```", content, re.DOTALL):
        snippets.extend(
            line.strip() for line in block.splitlines() if line.strip() and not line.startswith("#")
        )
    commands = []
    for snippet in snippets:
        if "soda-storyboard" not in snippet:
            continue
        tokens = shlex.split(snippet)
        if "soda-storyboard" not in tokens:
            continue
        arguments = tokens[tokens.index("soda-storyboard") + 1 :]
        if arguments:
            commands.append(arguments)
    return commands


@pytest.fixture
def strict_parser(monkeypatch: pytest.MonkeyPatch) -> argparse.ArgumentParser:
    original_init = argparse.ArgumentParser.__init__

    def strict_init(self: argparse.ArgumentParser, *args: object, **kwargs: object) -> None:
        kwargs["allow_abbrev"] = False
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(argparse.ArgumentParser, "__init__", strict_init)
    return build_parser()


@pytest.mark.parametrize("path", DOCUMENTS, ids=lambda path: str(path.relative_to(PACKAGE.parent)))
def test_every_documented_cli_command_is_real(path: Path, strict_parser: argparse.ArgumentParser) -> None:
    for arguments in _document_commands(path):
        if "--help" in arguments or "-h" in arguments:
            with pytest.raises(SystemExit) as error:
                strict_parser.parse_args(arguments)
            assert error.value.code == 0, f"{path}: invalid documented command {arguments}"
            continue
        parsed = strict_parser.parse_args(arguments)
        assert callable(parsed.func)
        if path.is_relative_to(PACKAGE):
            assert parsed.json, f"{path}: workflow commands must request JSON: {arguments}"


def test_command_check_detects_unknown_options_and_bad_enums(strict_parser: argparse.ArgumentParser) -> None:
    with pytest.raises(SystemExit) as error:
        strict_parser.parse_args(["character", "new", "--id", "girl", "--lor", "model"])
    assert error.value.code == 2
    with pytest.raises(SystemExit) as error:
        strict_parser.parse_args(["page", "new", "--id", "p", "--direction", "up"])
    assert error.value.code == 2
    assert sum(len(_document_commands(path)) for path in DOCUMENTS) >= 20


def test_manifests_share_one_standard_skill_and_marketplace_paths_stay_inside() -> None:
    portable = read_json(PACKAGE / "plugin.json")
    codex = read_json(PACKAGE / ".codex-plugin" / "plugin.json")
    claude = read_json(PACKAGE / ".claude-plugin" / "plugin.json")
    for key in ("name", "version", "description", "author"):
        assert portable[key] == codex[key] == claude[key]
    assert codex["skills"] == "./skills/"
    assert portable["extensions"]["com.openai"]["requires_local_executor"] is True
    assert portable["extensions"]["com.openai"]["interface"] == codex["interface"]
    assert list((PACKAGE / "skills").glob("*/SKILL.md")) == [SKILL / "SKILL.md"]
    assert re.search(
        r"^name: soda-storyboard$", (SKILL / "SKILL.md").read_text(encoding="utf-8"), re.MULTILINE
    )
    codex_market = read_json(PACKAGE / ".agents" / "plugins" / "marketplace.json")
    claude_market = read_json(PACKAGE / ".claude-plugin" / "marketplace.json")
    assert codex_market["name"] == claude_market["name"]
    for entry in codex_market["plugins"]:
        assert entry["name"] == portable["name"]
        assert entry["source"]["source"] == "local"
        assert entry["source"]["path"].startswith("./")
        assert (PACKAGE / entry["source"]["path"]).resolve() == PACKAGE.resolve()
    for entry in claude_market["plugins"]:
        assert entry["name"] == portable["name"]
        assert (PACKAGE / entry["source"]).resolve() == PACKAGE.resolve()


@pytest.mark.parametrize("path", list(PACKAGE.rglob("*.md")), ids=lambda path: str(path.relative_to(PACKAGE)))
def test_packaged_local_references_exist_and_do_not_escape_plugin(path: Path) -> None:
    for reference in re.findall(r"\[[^\]]*\]\(([^)]+)\)", path.read_text(encoding="utf-8")):
        if reference.startswith(("https://", "http://", "#")):
            continue
        target = (path.parent / reference.split("#", 1)[0]).resolve()
        assert target.is_relative_to(PACKAGE.resolve()), (path, reference)
        assert target.is_file(), (path, reference)


def test_packaged_schema_license_and_recipe_table_match_sources() -> None:
    assert read_json(SKILL / "assets" / "storyboard-v1.schema.json") == read_json(
        PACKAGE.parent / "schema" / "storyboard-v1.schema.json"
    )
    assert (PACKAGE / "NOTICE").read_text(encoding="utf-8") == (PACKAGE.parent / "NOTICE").read_text(
        encoding="utf-8"
    )
    grammar = (SKILL / "references" / "layout-grammar.md").read_text(encoding="utf-8")
    assert set(re.findall(r"^\| `([^`]+)`", grammar, re.MULTILINE)) == {recipe["id"] for recipe in RECIPES}


def test_dialogue_selected_layout_is_offered_and_matches_page(capsys: pytest.CaptureFixture) -> None:
    commands = _document_commands(PACKAGE / "examples" / "station-dialogue.md")
    arguments = next(command for command in commands if command[:2] == ["layout", "suggest"])
    # Verify the documented selection without writing illustrative preview paths.
    preview_index = arguments.index("--preview-dir")
    del arguments[preview_index : preview_index + 2]
    assert main(arguments) == 0
    candidates = json.loads(capsys.readouterr().out)
    selected = next(candidate for candidate in candidates if candidate["template_id"] == "hero-top-skew")
    page = read_json(PACKAGE / "examples" / "assets" / "station-page.before.json")
    assert [panel["shape"] for panel in page["panels"]] == [
        {key: value for key, value in shape.items() if key != "order"} for shape in selected["panels"]
    ]


def test_station_example_only_changes_panel_three_and_compiles_without_images(tmp_path: Path) -> None:
    assets = PACKAGE / "examples" / "assets"
    before = read_json(assets / "station-page.before.json")
    after = read_json(assets / "station-page.after.json")
    original = copy.deepcopy(after)
    changed = next(panel for panel in after["panels"] if panel["order"] == 3)
    assert "背后" in changed["description"]
    changed["description"] = next(panel for panel in before["panels"] if panel["order"] == 3)["description"]
    assert after == before
    path = write_json(tmp_path / "pages" / "station-turn.json", original)
    write_json(tmp_path / "characters" / "girl.json", read_json(assets / "girl.json"))
    character = load_character(assets / "girl.json")
    page = load_page(path)
    assert validate_page(page, {character.id: character}).valid
    assert main(["compile", str(path), "--output", str(tmp_path / "station.moss.json"), "--json"]) == 0
    compiled = read_json(tmp_path / "station.moss.json")
    assert "背后" in next(
        item["caption"] for item in compiled["items"] if item["caption"].startswith("Panel 3,")
    )
    assert all("panel_id" not in item for item in compiled["items"])
    assert (tmp_path / "station.moss.cut.json").is_file()
    assert not list(tmp_path.rglob("*.png"))
    assert page.style_prefix in compile_page(page, {character.id: character})["summary"]["caption"]
