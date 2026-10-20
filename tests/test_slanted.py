from __future__ import annotations

import copy
import json
from itertools import combinations, pairwise
from pathlib import Path

import pytest
from PIL import Image

from soda_storyboard import geometry
from soda_storyboard.cli import main
from soda_storyboard.compiler import compile_geometry_map, compile_page
from soda_storyboard.io import load_characters, load_page, read_json, write_json
from soda_storyboard.models import Dialogue, Page, Panel
from soda_storyboard.preview import render_preview
from soda_storyboard.templates import builtin_templates, suggest_layouts
from soda_storyboard.validation import validate_page


@pytest.mark.parametrize("count", range(3, 8))
@pytest.mark.parametrize("importance", [None, [1, 3, 1, 2, 1, 2, 1]])
def test_default_candidates_mix_shapes_and_unique_families(count: int, importance: list[int] | None) -> None:
    candidates = suggest_layouts(count, importance=importance)
    assert len(candidates) == 6
    assert len({candidate["family"] for candidate in candidates}) == len(candidates)
    assert any(p["type"] == "quad" for c in candidates for p in c["panels"])
    assert any(p["type"] == "rect" for c in candidates for p in c["panels"])


def test_shared_vertical_seams_keep_true_distance() -> None:
    rectangles = [
        {"type": "rect", "x": 40, "y": 40, "w": 280, "h": 420},
        {"type": "rect", "x": 344, "y": 40, "w": 280, "h": 420},
        {"type": "rect", "x": 648, "y": 40, "w": 280, "h": 420},
    ]
    quads = geometry.skew_rectangles(rectangles, angle=8, gap=24)
    assert len(quads) == 3
    assert all(quad["type"] == "quad" for quad in quads)
    assert geometry.shape_distance(quads[0], quads[1]) >= 24 - 1e-7


def _inside(point: tuple[float, float], polygon: list[tuple[float, float]]) -> bool:
    return all(
        (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]) >= -1e-6
        for a, b in zip(polygon, [*polygon[1:], polygon[0]], strict=True)
    )


@pytest.mark.parametrize("count", range(3, 8))
@pytest.mark.parametrize("angle", [-15, -5, 5, 15])
@pytest.mark.parametrize("direction", ["rtl", "ltr"])
def test_slanted_candidates_are_bounded_separated_and_keep_order(
    count: int, angle: int, direction: str
) -> None:
    candidates = suggest_layouts(count, skew=angle, reading_direction=direction, candidates=20)
    assert len(candidates) >= 2
    assert len({c["family"] for c in candidates}) == len(candidates)
    for candidate in candidates:
        panels = candidate["panels"]
        assert [p["order"] for p in panels] == list(range(1, count + 1))
        assert any(p["type"] == "quad" for p in panels)
        for panel in panels:
            assert all(0 <= x <= 1024 and 0 <= y <= 1536 for x, y in geometry.shape_polygon(panel))
        for first, second in combinations(panels, 2):
            assert not geometry.polygons_overlap(first, second)
            assert geometry.shape_distance(first, second) >= 24 - 1e-6
        boxes = [geometry.shape_bbox(p) for p in panels]
        top = [box for box in boxes if box[1] == min(b[1] for b in boxes)]
        side = max if direction == "rtl" else min
        assert boxes[0][0] == side(box[0] for box in top)
        page = Page(
            reading_direction=direction,
            panels=[
                Panel(str(i), i, {k: v for k, v in p.items() if k != "order"})
                for i, p in enumerate(panels, 1)
            ],
        )
        assert validate_page(page).valid
        assert len(compile_page(page)["items"]) == count


@pytest.mark.parametrize("axis", ["vertical", "horizontal"])
@pytest.mark.parametrize("gap", [0, 24])
def test_midline_regions_tile_working_band_and_real_gutters(axis: str, gap: int) -> None:
    rectangles = [{"x": 40 + i * (280 + gap), "y": 40, "w": 280, "h": 420} for i in range(3)]
    if axis == "horizontal":
        rectangles = [{"x": p["y"], "y": p["x"], "w": p["h"], "h": p["w"]} for p in rectangles]
    quads = geometry.skew_rectangles(rectangles, angle=10, gap=gap, axis=axis)
    regions = [geometry.shape_bbox(geometry.midline_rect(quad)) for quad in quads]
    original = [geometry.shape_bbox(rect) for rect in rectangles]
    start, end = (0, 2) if axis == "vertical" else (1, 3)
    assert regions[0][start] == original[0][start]
    assert regions[-1][end] == original[-1][end]
    for first, second in pairwise(regions):
        assert first[end] <= second[start]
        if gap == 0:
            assert first[end] == pytest.approx(second[start])
    for first, second in pairwise(quads):
        assert geometry.shape_distance(first, second) == pytest.approx(gap)


@pytest.mark.parametrize(
    ("points", "area"),
    [
        ([[0, 0], [100, 0], [100, 100], [0, 100]], 10000),
        ([[50, 0], [100, 50], [50, 100], [0, 50]], 2500),
        ([[0, 0], [100, 0], [200, 100], [100, 100]], 2500),
        ([[0, 0], [100, 0], [80, 100], [20, 100]], 6000),
    ],
)
def test_hint_rectangle_has_analytic_maximum_area(points: list[list[int]], area: int) -> None:
    shape = {"type": "quad", "points": points}
    rectangle = geometry.inscribed_rect(shape)
    assert rectangle["w"] * rectangle["h"] == pytest.approx(area)
    assert all(_inside(point, geometry.convex_polygon(shape)) for point in geometry.shape_polygon(rectangle))


@pytest.mark.parametrize("recipe", [t["id"] for t in builtin_templates(5) if "skew" in t])
@pytest.mark.parametrize("direction", ["rtl", "ltr"])
def test_hint_object_and_text_bboxes_stay_inside_quads(recipe: str, direction: str) -> None:
    candidate = suggest_layouts(5, pick=recipe, reading_direction=direction)[0]
    panels = [
        Panel(str(i), i, {k: v for k, v in p.items() if k != "order"}, dialogue=[Dialogue(text="hello")])
        for i, p in enumerate(candidate["panels"], 1)
    ]
    page = Page(panels=panels, reading_direction=direction)
    result = compile_page(page, slant_mode="hint", with_ids=True)
    assert "slanted dividing lines" in result["summary"]["caption"]
    for item in result["items"]:
        panel = panels[int(item["panel_id"]) - 1]
        x1, y1, x2, y2 = geometry.from_moss_bbox(item["bbox"], 1024, 1536)
        assert x1 < x2
        assert y1 < y2
        assert all(
            _inside(point, geometry.convex_polygon(panel.shape))
            for point in ((x1, y1), (x2, y1), (x2, y2), (x1, y2))
        )
        if panel.shape_type == "quad" and item["label"] == "object":
            assert "slanted panel" in item["caption"]


def test_cut_and_rect_compilation_and_sidecar_geometry() -> None:
    page = load_page("examples/slanted/pages/platform-dash.json")
    before = copy.deepcopy(page.to_dict())
    cut = compile_page(page)
    assert "slant" not in json.dumps(cut)
    assert "overlay" not in json.dumps(cut)
    assert len(cut["items"]) == 5
    assert all(set(item) == {"caption", "bbox", "label"} for item in cut["items"])
    shapes = []
    for item in cut["items"]:
        x1, y1, x2, y2 = geometry.from_moss_bbox(item["bbox"], 1024, 1536)
        shapes.append({"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1})
    assert all(not geometry.polygons_overlap(a, b) for a, b in combinations(shapes, 2))
    debug = compile_page(page, slant_mode="rect")
    assert debug["items"][0]["bbox"][1] < cut["items"][0]["bbox"][1]
    mapping = compile_geometry_map(page)
    assert mapping["panels"][0]["quad"] == page.panels[0].shape["points"]
    assert [p["bbox"] for p in mapping["panels"]] == [item["bbox"] for item in cut["items"]]
    assert mapping["overlays"] == [o.to_dict() for o in page.overlays]
    assert page.to_dict() == before


@pytest.mark.parametrize("mode", ["cut", "hint", "rect"])
def test_cli_sidecar_files_and_overlay_map(tmp_path: Path, capsys: pytest.CaptureFixture, mode: str) -> None:
    output = tmp_path / "page.moss.json"
    assert (
        main(
            [
                "compile",
                "examples/slanted/pages/platform-dash.json",
                "--output",
                str(output),
                "--slant-mode",
                mode,
                "--with-ids",
                "--json",
            ]
        )
        == 0
    )
    compiled = json.loads(capsys.readouterr().out)
    assert read_json(output) == compiled
    mapping = read_json(tmp_path / "page.moss.map.json")
    assert mapping["overlays"][0]["id"] == "dash"
    assert "overlays" not in compiled
    assert (tmp_path / "page.moss.cut.json").exists() == (mode == "cut")
    if mode == "cut":
        cut_map = read_json(tmp_path / "page.moss.cut.json")
        assert "overlays" not in cut_map
        assert cut_map["panels"][0]["quad"] == mapping["panels"][0]["quad"]
        assert cut_map["panels"][0]["bbox"] == compiled["items"][0]["bbox"]


def test_overlay_roundtrip_and_preview(tmp_path: Path) -> None:
    page = load_page("examples/slanted/pages/platform-dash.json")
    page.overlays[0].extra["note"] = {"keep": True}
    assert Page.from_dict(page.to_dict()).to_dict() == page.to_dict()
    characters = load_characters("examples/slanted/characters")
    assert validate_page(page, characters).valid
    overlay_image = render_preview(page, tmp_path / "overlay.png")
    page.overlays.clear()
    plain_image = render_preview(page, tmp_path / "plain.png")
    with Image.open(overlay_image) as overlay, Image.open(plain_image) as plain:
        assert overlay.tobytes() != plain.tobytes()
        assert overlay.getpixel((130, 450)) == (5, 150, 105)
        assert overlay.getpixel((130, 455)) == plain.getpixel((130, 455))


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("panel_id", "missing", "unknown_overlay_panel"),
        ("character_id", "missing", "unknown_overlay_character"),
        ("rect", {"x": -2, "y": 0, "w": 50, "h": 50}, "overlay_out_of_bounds"),
        ("status", "draft", "invalid_overlay_status"),
        ("z_index", 0, "invalid_overlay_layer"),
        ("id", "", "invalid_overlay_id"),
    ],
)
def test_invalid_overlays_are_reported(field: str, value: object, code: str) -> None:
    data = read_json(Path("examples/slanted/pages/platform-dash.json"))
    data["overlays"][0][field] = value
    report = validate_page(Page.from_dict(data), load_characters("examples/slanted/characters"))
    assert code in {issue.code for issue in report.errors}


def test_overlay_parent_is_optional_and_unknown_characters_are_errors() -> None:
    page = load_page("examples/slanted/pages/platform-dash.json")
    page.overlays[0].panel_id = None
    assert validate_page(page, load_characters("examples/slanted/characters")).valid
    assert "unknown_overlay_character" in {e.code for e in validate_page(page).errors}
    page.overlays.append(copy.deepcopy(page.overlays[0]))
    assert "invalid_overlay_id" in {e.code for e in validate_page(page).errors}


@pytest.mark.parametrize("selectors", ["p1,p2", "p4,p5"])
def test_page_skew_preserves_order_and_other_fields(tmp_path: Path, selectors: str) -> None:
    original = read_json(Path("examples/station/pages/station-turn.json"))
    if selectors == "p4,p5":
        original["panels"] = original["panels"][:2]
        for i, panel in enumerate(original["panels"], 4):
            panel.update(
                id=f"p{i}",
                order=i - 3,
                character_ids=[],
                dialogue=[],
                shape={"type": "rect", "x": 40, "y": 40 + (i - 4) * 500, "w": 900, "h": 476},
            )
    original["custom"] = {"keep": True}
    path = write_json(tmp_path / "page.json", original)
    assert main(["page", "skew", str(path), "--panels", selectors, "--angle", "8", "--json"]) == 0
    updated = read_json(path)
    for a, b in zip(original["panels"], updated["panels"], strict=True):
        if a["id"] in selectors.split(","):
            assert b["shape"]["type"] == "quad"
            b["shape"] = a["shape"]
    assert updated == original


@pytest.mark.parametrize(
    ("selectors", "angle"),
    [("p1,missing", "8"), ("p1,p4", "8"), ("p1,p1", "8"), ("p1,p2", "nan"), ("p1,p2", "80")],
)
def test_invalid_skew_never_writes_page(tmp_path: Path, selectors: str, angle: str) -> None:
    original = Path("examples/station/pages/station-turn.json").read_bytes()
    path = tmp_path / "page.json"
    path.write_bytes(original)
    assert main(["page", "skew", str(path), "--panels", selectors, "--angle", angle, "--json"]) == 2
    assert path.read_bytes() == original


def test_zero_skew_and_candidate_preview(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    assert all(p["type"] == "rect" for c in suggest_layouts(5, skew=0) for p in c["panels"])
    assert main(["layout", "suggest", "--panels", "5", "--preview-dir", str(tmp_path), "--json"]) == 0
    candidates = json.loads(capsys.readouterr().out)
    assert len(list(tmp_path.glob("*.png"))) == 6
    assert len({c["family"] for c in candidates}) == 6
    assert sum(any(p["type"] == "quad" for p in c["panels"]) for c in candidates) >= 2


@pytest.mark.parametrize(
    "points", [[[0, 0], [100, 100], [100, 0], [0, 100]], [[0, 0], [100, 0], [20, 20], [0, 100]]]
)
def test_invalid_quad_is_rejected(points: list[list[int]]) -> None:
    page = Page(panels=[Panel("p", 1, {"type": "quad", "points": points})])
    assert "invalid_panel_polygon" in {issue.code for issue in validate_page(page).errors}


def test_custom_template_skew_and_quad_template(tmp_path: Path) -> None:
    template = {
        "id": "custom",
        "family": "custom",
        "panel_count": 3,
        "skew": {"angle": 10},
        "panels": [{"x": i / 3, "y": 0, "w": 1 / 3, "h": 1} for i in range(3)],
    }
    write_json(tmp_path / "custom.json", template)
    result = suggest_layouts(3, user_templates=tmp_path, pick="custom-skew")[0]
    assert all(p["type"] == "quad" for p in result["panels"])
    exported = next(t for t in builtin_templates(5) if t["id"] == "hero-top-skew")
    exported["id"] = "exported"
    exported.pop("skew")
    write_json(tmp_path / "exported.json", exported)
    imported = suggest_layouts(5, user_templates=tmp_path, pick="exported")[0]
    assert any(p["type"] == "quad" for p in imported["panels"])


def test_impossible_skew_reports_error_without_writing(tmp_path: Path) -> None:
    source = Path("examples/station/pages/station-turn.json").read_bytes()
    path = tmp_path / "page.json"
    path.write_bytes(source)
    assert main(["layout", "suggest", "--page", str(path), "--skew", "nan", "--json"]) == 2
    assert path.read_bytes() == source
    with pytest.raises(ValueError, match="没有可用版式"):
        suggest_layouts(1, skew=8)


def test_cut_mode_rejects_conflicting_midlines_and_unknown_mode() -> None:
    shape = {"type": "quad", "points": [[0, 0], [100, 0], [100, 100], [0, 100]]}
    page = Page(panels=[Panel("a", 1, shape), Panel("b", 2, shape)])
    with pytest.raises(ValueError, match="midline rectangles overlap"):
        compile_page(page)
    with pytest.raises(ValueError, match="midline rectangles overlap"):
        compile_geometry_map(page)
    assert len(compile_page(page, slant_mode="rect")["items"]) == 2
    with pytest.raises(ValueError, match="slant_mode"):
        compile_geometry_map(page, slant_mode="bad")


def test_cut_sidecar_next_to_input_without_output_and_without_ids(tmp_path: Path) -> None:
    source = read_json(Path("examples/slanted/pages/platform-dash.json"))
    path = write_json(tmp_path / "page.json", source)
    assert main(["compile", str(path), "--json"]) == 0
    assert (tmp_path / "page.cut.json").exists()
    assert not (tmp_path / "page.map.json").exists()
    assert read_json(path) == source
