from __future__ import annotations

import copy
import json
import subprocess
import sys
from itertools import combinations
from pathlib import Path

import pytest
from PIL import Image

from soda_storyboard.cli import main
from soda_storyboard.compiler import compile_page
from soda_storyboard.io import read_json, write_json
from soda_storyboard.models import CAMERA_ANGLES, SHOT_SIZES, Dialogue, Page, Panel
from soda_storyboard.templates import RECIPES, builtin_templates, suggest_layouts


def test_default_layouts_cover_four_candidates_and_keep_reading_order() -> None:
    candidates = suggest_layouts(5, importance=[1, 3, 1, 2, 1], skew=0)
    assert len(candidates) >= 4
    for candidate in candidates:
        panels = candidate["panels"]
        assert [panel["order"] for panel in panels] == list(range(1, 6))
        top = [panel for panel in panels if panel["y"] == min(p["y"] for p in panels)]
        assert panels[0]["x"] == max(panel["x"] for panel in top)


def test_compile_uses_proven_caption_contract() -> None:
    page = Page(panels=[Panel("p1", 1, {"x": 0, "y": 0, "w": 512, "h": 300})])
    compiled = compile_page(page)
    assert compiled["items"][0]["caption"].startswith("Panel 1, medium shot, eye-level:")
    assert "no text, no speech bubbles" in compiled["summary"]["caption"]
    assert set(compiled["items"][0]) == {"label", "caption", "bbox"}
    assert all(type(value) is int for value in compiled["items"][0]["bbox"])
    page.panels[0].dialogue = [Dialogue(text="……是你？")]
    text = compile_page(page)["items"][1]
    assert "Clean vertical Chinese dialogue text in a white speech bubble" in text["caption"]
    assert text["text"] == "……是你？"
    assert "……是你？" not in text["caption"]


@pytest.mark.parametrize("count", range(3, 8))
@pytest.mark.parametrize("direction", ["rtl", "ltr"])
@pytest.mark.parametrize(("size", "gap"), [((1024, 1536), 24), ((1600, 900), 17), ((800, 1200), 0)])
def test_all_recipes_have_separated_bounded_panels(
    count: int, direction: str, size: tuple[int, int], gap: int
) -> None:
    width, height = size
    templates = builtin_templates(count, skew=0)
    results = [
        suggest_layouts(
            count,
            width=width,
            height=height,
            gap=gap,
            reading_direction=direction,
            pick=template["id"],
            skew=0,
        )[0]
        for template in templates
    ]
    assert len(results) >= 4
    assert {r["template_id"] for r in results} == {t["id"] for t in templates}
    for candidate in results:
        assert candidate["name_zh"]
        assert candidate["name_ja"]
        assert candidate["description"]
        assert candidate["tags"]
        panels = candidate["panels"]
        assert [panel["order"] for panel in panels] == list(range(1, count + 1))
        for panel in panels:
            assert panel["w"] > 0
            assert panel["h"] > 0
            assert panel["x"] >= -1e-7
            assert panel["y"] >= -1e-7
            assert panel["x"] + panel["w"] <= width + 1e-7
            assert panel["y"] + panel["h"] <= height + 1e-7
        for first, second in combinations(panels, 2):
            dx = max(first["x"] - second["x"] - second["w"], second["x"] - first["x"] - first["w"])
            dy = max(first["y"] - second["y"] - second["h"], second["y"] - first["y"] - first["h"])
            assert max(dx, dy) >= gap - 1e-7
        top = [p for p in panels if p["y"] == min(p["y"] for p in panels)]
        edge = max if direction == "rtl" else min
        assert panels[0]["x"] == edge(p["x"] for p in top)
        for y in {p["y"] for p in panels}:
            row = [p for p in panels if p["y"] == y]
            assert [p["x"] for p in row] == sorted([p["x"] for p in row], reverse=direction == "rtl")


@pytest.mark.parametrize("recipe", RECIPES, ids=lambda recipe: recipe["id"])
def test_original_recipe_ranges_are_supported(recipe: dict) -> None:
    for count in range(recipe["minPanels"], recipe["maxPanels"] + 1):
        result = suggest_layouts(count, pick=recipe["id"])[0]
        assert len(result["panels"]) == count
        assert result["ja"] == recipe["ja"]
        assert result["family"] == recipe["family"]


@pytest.mark.parametrize("recipe_id", ["hero-top", "hero-bottom", "hero-right", "detail-payoff"])
@pytest.mark.parametrize("direction", ["rtl", "ltr"])
def test_hero_is_at_intended_story_beat(recipe_id: str, direction: str) -> None:
    candidate = suggest_layouts(5, pick=recipe_id, reading_direction=direction)[0]
    panels = candidate["panels"]
    hero = panels[0 if candidate["hero_position"] == "first" else -1]
    assert hero["w"] * hero["h"] == max(p["w"] * p["h"] for p in panels)
    if recipe_id == "hero-right":
        assert (hero["x"] > panels[1]["x"]) == (direction == "rtl")


def test_four_equal_bands_and_stagger_have_real_geometry() -> None:
    panels = suggest_layouts(4, pick="vertical-rhythm")[0]["panels"]
    assert len({p["h"] for p in panels}) == 1
    assert len({p["x"] for p in panels}) == 1
    assert panels[0]["w"] > panels[0]["h"]
    stagger = suggest_layouts(4, pick="ladder")[0]["panels"]
    assert stagger[0]["w"] > stagger[1]["w"]
    assert stagger[2]["w"] < stagger[3]["w"]


@pytest.mark.parametrize("shot", SHOT_SIZES)
@pytest.mark.parametrize("angle", CAMERA_ANGLES)
def test_shots_and_angles_are_natural_english(shot: str, angle: str) -> None:
    page = Page(panels=[Panel("p", 1, {"x": 0, "y": 0, "w": 500, "h": 400}, shot=shot, angle=angle)])
    caption = compile_page(page)["items"][0]["caption"]
    assert caption.startswith("Panel 1, ")
    assert "_" not in caption
    assert "景别" not in caption
    assert "角度" not in caption


@pytest.mark.parametrize(
    ("bubble", "phrase"),
    [
        ("speech", "white speech bubble"),
        ("shout", "jagged shout bubble"),
        ("thought", "cloud-shaped thought bubble"),
        ("narration", "rectangular narration box"),
    ],
)
def test_bubble_caption_and_optional_ids(bubble: str, phrase: str) -> None:
    panel = Panel(
        "p",
        1,
        {"x": 1.5, "y": 1.5, "w": 510.2, "h": 298.4},
        dialogue=[Dialogue(speaker_id="girl", text="你好", bubble=bubble)],
    )
    page = Page(panels=[panel], text_direction="horizontal", color_mode="color", reading_direction="ltr")
    result = compile_page(page)
    assert phrase in result["items"][1]["caption"]
    assert result["items"][1]["text"] == "你好"
    assert "horizontal" in result["items"][1]["caption"]
    assert "Japanese manga layout read left to right" in result["summary"]["caption"]
    assert "full-color" in result["summary"]["caption"]
    assert "no text" not in result["summary"]["caption"]
    assert set(result["items"][0]) == {"label", "caption", "bbox"}
    assert set(result["items"][1]) == {"label", "caption", "text", "bbox"}
    ids = compile_page(page, with_ids=True)["items"]
    assert ids[0]["panel_id"] == "p"
    assert ids[1]["speaker_id"] == "girl"
    page.dialogue_mode = "lettering"
    result = compile_page(page)
    assert len(result["items"]) == 1
    assert result["summary"]["caption"].endswith("no text, no speech bubbles")


def test_bbox_rounds_and_clamps_even_on_odd_canvas_and_tiny_panel() -> None:
    page = Page(
        canvas_width=101,
        canvas_height=151,
        panels=[
            Panel("p", 1, {"x": -0.2, "y": 140.1, "w": 102, "h": 10.9}, dialogue=[Dialogue(text="hi")]),
        ],
    )
    for item in compile_page(page)["items"]:
        assert all(type(value) is int for value in item["bbox"])
        y1, x1, y2, x2 = item["bbox"]
        assert -75.5 <= y1 <= y2 <= 75.5
        assert -50.5 <= x1 <= x2 <= 50.5
    page = Page(panels=[Panel("p", 1, {"x": 10.6, "y": 10.6, "w": 100.8, "h": 100.8})])
    assert compile_page(page)["items"][0]["bbox"] == [-757, -501, -657, -401]


@pytest.mark.parametrize("separate_output", [False, True])
def test_layout_page_write_preserves_every_non_geometry_field(
    tmp_path: Path, *, separate_output: bool
) -> None:
    original = read_json(Path("examples/station/pages/station-turn.json"))
    original["custom"] = {"notes": ["keep"]}
    original["panels"].reverse()
    original["panels"][0]["custom"] = {"revision": 7}
    original["panels"][0]["shot_size"] = "legacy"
    path = write_json(tmp_path / "page.json", original)
    target = tmp_path / "chosen.json" if separate_output else path
    args = ["layout", "suggest", "--page", str(path), "--pick", "hero-right", "--json"]
    if separate_output:
        args.extend(["--write-page", str(target)])
    assert main(args) == 0
    updated = read_json(target)
    for old, new in zip(original["panels"], updated["panels"], strict=True):
        assert old["shape"] != new["shape"]
        new["shape"] = old["shape"]
    assert updated == original
    if separate_output:
        assert read_json(path) == original


@pytest.mark.parametrize("extra_args", [["--panels", "5"], ["--pick", "missing"]])
def test_layout_error_does_not_write_page(tmp_path: Path, extra_args: list[str]) -> None:
    path = tmp_path / "page.json"
    original = Path("examples/station/pages/station-turn.json").read_bytes()
    path.write_bytes(original)
    assert main(["layout", "suggest", "--page", str(path), "--json", *extra_args]) == 2
    assert path.read_bytes() == original


def test_candidate_pngs_match_json_results(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    assert main(["layout", "suggest", "--panels", "5", "--preview-dir", str(tmp_path), "--json"]) == 0
    results = json.loads(capsys.readouterr().out)
    assert len(results) >= 4
    assert len(list(tmp_path.glob("*.png"))) == len(results)
    for result in results:
        with Image.open(result["preview"]) as image:
            assert image.size == (1024, 1536)
            assert image.format == "PNG"


@pytest.mark.parametrize("forced_gbk", [False, True])
@pytest.mark.parametrize("args", [["layout", "suggest", "--panels", "5", "--json"], ["--help"]])
def test_cli_subprocess_outputs_utf8_without_encoding_env(
    monkeypatch: pytest.MonkeyPatch, args: list[str], *, forced_gbk: bool
) -> None:
    monkeypatch.delenv("PYTHONIOENCODING", raising=False)
    monkeypatch.delenv("PYTHONUTF8", raising=False)
    bootstrap = (
        "import sys; from soda_storyboard.cli import main; "
        + (
            "sys.stdout.reconfigure(encoding='gbk'); sys.stderr.reconfigure(encoding='gbk'); "
            if forced_gbk
            else ""
        )
        + "raise SystemExit(main(sys.argv[1:]))"
    )
    process = subprocess.run(
        [sys.executable, "-X", "utf8=0", "-c", bootstrap, *args], capture_output=True, check=False, timeout=15
    )
    assert process.returncode == 0, process.stderr.decode("utf-8")
    output = process.stdout.decode("utf-8")
    if "--json" in args:
        assert json.loads(output)[0]["name_zh"] == "均衡网格"
    else:
        assert "分镜单" in output


def test_compile_inherits_project_settings_and_page_overrides(
    tmp_path: Path, capsys: pytest.CaptureFixture
) -> None:
    write_json(
        tmp_path / "project.json", {"name": "test", "text_direction": "horizontal", "color_mode": "color"}
    )
    data = read_json(Path("examples/station/pages/station-turn.json"))
    path = write_json(tmp_path / "pages" / "test.json", data)
    assert main(["compile", str(path), "--json"]) == 0
    output = json.loads(capsys.readouterr().out)
    assert "full-color" in output["summary"]["caption"]
    assert "horizontal" in next(item for item in output["items"] if item["label"] == "text")["caption"]
    data.update(text_direction="vertical", color_mode="monochrome")
    write_json(path, data)
    assert main(["compile", str(path), "--json", "--with-ids"]) == 0
    output = json.loads(capsys.readouterr().out)
    assert "black-and-white" in output["summary"]["caption"]
    assert output["items"][0]["panel_id"] == "p1"


def test_empty_dialogue_and_brief_summary() -> None:
    data = read_json(Path("examples/station/pages/station-turn.json"))
    page = Page.from_dict(copy.deepcopy(data))
    result = compile_page(page)
    assert result["summary"]["caption"].startswith("High-taste")
    assert page.style_prefix in result["summary"]["caption"]
    assert page.description in result["summary"]["caption"]
    assert all(p.description not in result["summary"]["caption"] for p in page.panels)
    for panel in page.panels:
        panel.dialogue = [Dialogue(text="  ")]
        panel.sfx = []
    result = compile_page(page)
    assert result["summary"]["caption"].endswith("no text, no speech bubbles")
    assert all(item["label"] == "object" for item in result["items"])
