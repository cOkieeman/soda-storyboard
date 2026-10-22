# ruff: noqa: RUF001 -- bilingual caption expectations
"""F5 position contracts and regressions for external editor projects."""

from __future__ import annotations

import copy
from pathlib import Path

import pytest

from soda_storyboard.canvas_sizes import CANVAS_PRESETS, infer_dimensions
from soda_storyboard.captions import panel_caption, panel_caption_info, source_hash, translation_state
from soda_storyboard.cli import main
from soda_storyboard.compiler import compile_page
from soda_storyboard.figure_rig import ensure_figure_editor
from soda_storyboard.figure_semantics import figure_description
from soda_storyboard.importers import import_moss, import_storyboard
from soda_storyboard.io import write_json
from soda_storyboard.models import Figure, Page, Panel, RectShape
from soda_storyboard.panel_positions import panel_positions
from soda_storyboard.translations import translation_todo


def test_six_panel_positions_are_geometric_and_unique() -> None:
    boxes = [
        (520, 20, 480, 260),
        (20, 20, 480, 260),
        (520, 320, 480, 260),
        (20, 320, 480, 260),
        (20, 650, 980, 260),
        (20, 1000, 980, 500),
    ]
    page = Page(panels=[Panel(f"p{i}", i, RectShape(*box)) for i, box in enumerate(boxes, 1)])
    positions = panel_positions(page)
    assert positions["p1"] == "Top-right horizontal panel"
    assert positions["p2"] == "Top-left horizontal panel"
    assert "full-width" in positions["p5"]
    assert len(set(positions.values())) == 6
    assert all("第" not in value for value in positions.values())


def test_three_columns_slanted_and_collisions() -> None:
    page = Page(
        canvas_width=1000,
        canvas_height=1000,
        panels=[Panel(f"p{i}", i, RectShape(x, 100, 200, 500)) for i, x in enumerate((20, 400, 780), 1)],
    )
    result = panel_positions(page)
    assert list(result.values()) == [
        "Upper-left vertical panel",
        "Upper-center vertical panel",
        "Upper-right vertical panel",
    ]
    page.panels[0].shape = {"type": "quad", "points": [[20, 100], [220, 100], [200, 600], [20, 600]]}
    assert "slanted" in panel_positions(page)["p1"]
    page.panels = [Panel(f"p{i}", i, RectShape(10, 10, 100, 100)) for i in range(1, 5)]
    assert len(set(panel_positions(page).values())) == 4
    assert "first" in panel_positions(page)["p1"].lower()


def test_position_is_outside_translation_hash_and_in_todo() -> None:
    panel = Panel("p", 1, RectShape(600, 0, 400, 300), description="女孩读书")
    page = Page(panels=[panel])
    old_hash = source_hash(panel, page, {})
    panel.caption_auto_en = {"format": "scene-v1", "text": "A girl reads a book.", "source_hash": old_hash}
    assert panel_caption(panel, page, {}).startswith(
        "Top-right horizontal panel: Medium shot, eye-level. A girl"
    )
    panel.shape["x"] = 0
    assert source_hash(panel, page, {}) == old_hash
    assert translation_state(panel, page, {}) == "fresh"
    assert panel_caption(panel, page, {}).startswith("Top-left")
    panel.caption_auto_en = None
    assert translation_todo(page, {}, {})["panels"][0]["position_en"] == "Top-left horizontal panel"
    panel.use_custom_caption = True
    panel.caption_en = "A manual scene."
    assert panel_caption(panel, page, {}) == panel.caption_en
    assert any(
        "建议以方位开头" in item["message"] for item in panel_caption_info(panel, page, {})["warnings"]
    )


@pytest.mark.parametrize("shot", ["close_up", "extreme_close_up"])
def test_closeups_omit_generated_full_body_posture(shot: str) -> None:
    page = Page(
        panels=[
            Panel(
                "p",
                1,
                RectShape(0, 0, 400, 400),
                shot=shot,
                figures=[Figure("girl", pose="sit", facing="left")],
                description="她微笑",
            )
        ]
    )
    captions = [item["caption"] for item in compile_page(page)["items"]]
    assert all("坐着" not in text for text in captions)
    assert all("左" in text for text in captions)
    assert "sitting" not in str(translation_todo(page, {}, {}))


def test_external_text_direction_color_and_node_canvas_rules() -> None:
    source = {
        "summary": {"caption": "Full color phone interface"},
        "bbox_format": "yxyx",
        "bbox_coord_space": "abs_centralized",
        "items": [
            {"label": "text", "caption": "nickname", "text": "清月如故", "bbox": [-737, -430, -697, -272]},
            {
                "label": "text",
                "caption": "chat message",
                "text": "琴声晚：姐姐好美",
                "bbox": [473, -517, 558, 0],
            },
            {"label": "object", "caption": "Lamp", "bbox": [-261, 413, 215, 544]},
        ],
    }
    original = copy.deepcopy(source)
    page, report = import_moss(source)
    assert (page.width, page.height) == (1024, 1536)
    assert all(text.direction == "horizontal" for text in page.texts)
    assert page.color_mode == "color"
    assert compile_page(page) == original
    assert report["guesses"]
    source["summary"]["caption"] = "Phone interface"
    assert import_moss(source, default_color_mode="color")[0].color_mode == "color"
    assert (
        import_storyboard(
            {"shots": [{"description": "full color landscape"}]}, default_color_mode="monochrome"
        )[0].color_mode
        == "color"
    )


def test_stdout_compile_places_sidecars_in_page_production_directory(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    page = Page(
        page_id="p",
        panels=[Panel("p1", 1, {"type": "quad", "points": [[20, 20], [400, 20], [380, 400], [20, 400]]})],
    )
    path = write_json(tmp_path / "pages/p.json", page)
    assert main(["compile", str(path), "--with-ids", "--json"]) == 0
    capsys.readouterr()
    assert not (tmp_path / "pages/p.cut.json").exists()
    assert not (tmp_path / "pages/p.map.json").exists()
    assert (tmp_path / "pages/p/p.cut.json").is_file()
    assert (tmp_path / "pages/p/p.map.json").is_file()


@pytest.mark.parametrize(
    ("center", "word"), [(0.1, "Top"), (0.2, "Upper"), (0.4, "Middle"), (0.6, "Lower"), (0.8, "Bottom")]
)
def test_vertical_position_uses_equal_fifths(center: float, word: str) -> None:
    page = Page(
        canvas_width=1000,
        canvas_height=1000,
        panels=[Panel("p", 1, RectShape(10, center * 1000 - 25, 100, 50))],
    )
    assert panel_positions(page)["p"].startswith(word)


def test_same_region_refines_left_center_right_and_uses_reading_order() -> None:
    page = Page(
        canvas_width=1000,
        canvas_height=1000,
        panels=[Panel(f"p{i}", 4 - i, RectShape(x, 100, 30, 50)) for i, x in enumerate((10, 100, 200), 1)],
    )
    assert list(panel_positions(page).values()) == [
        "Top-left vertical panel",
        "Top-center vertical panel",
        "Top-right vertical panel",
    ]
    for panel in page.panels:
        panel.shape["x"] = 10
    assert panel_positions(page)["p3"].startswith("first")
    assert panel_positions(Page()) == {}


@pytest.mark.parametrize(
    ("space", "box", "size"),
    [
        ("abs_centralized", [-740, -517, 745, 544], (1024, 1536)),
        ("abs", [0, 0, 1536, 1024], (1024, 1536)),
        ("normalized", [0, 0, 1, 1], (1024, 1536)),
        ("abs_centralized", [-500, -500, 500, 500], (1024, 1024)),
    ],
)
def test_public_canvas_table_and_node_compatible_inference(space: str, box: list, size: tuple) -> None:
    assert CANVAS_PRESETS == ((1024, 1536), (1536, 1024), (1024, 1024), (768, 1344), (1344, 768))
    assert infer_dimensions({"bbox_coord_space": space, "items": [{"bbox": box}]}) == size


def test_formatting_alone_keeps_existing_translation_hash() -> None:
    panel = Panel("p", 1, RectShape(0, 0, 400, 300), description="女孩读书")
    page = Page(panels=[panel])
    # F8 hashes only translatable scene prose, excluding the generated camera.
    import hashlib  # noqa: PLC0415 -- independent expected digest

    expected = hashlib.sha256('{"description":"女孩读书"}'.encode()).hexdigest()
    assert source_hash(panel, page, {}) == expected
    panel.caption_auto_en = {"format": "scene-v1", "text": "a girl reading.", "source_hash": expected}
    assert (
        panel_caption(panel, page, {}) == "Top-left horizontal panel: Medium shot, eye-level. a girl reading."
    )


def test_closeup_does_not_restore_a_chin_pose_after_manual_arm_edits() -> None:
    figure = Figure("girl", pose="hand_on_chin", facing="left")
    editor = ensure_figure_editor(figure, 300, 400)
    editor["joints"]["rHand"] = [40, 0]
    editor["joints"]["lHand"] = [-40, 0]
    figure.extra["editor"] = editor
    caption = figure_description(figure, "en", head_only=True)
    assert "chin" not in caption
    assert "facing left" in caption


@pytest.mark.parametrize("mode", ["cut", "hint", "rect"])
def test_slanted_caption_is_added_once_and_matches_preview(mode: str) -> None:
    page = Page(
        panels=[
            Panel(
                "p",
                1,
                {"type": "quad", "points": [[20, 20], [400, 20], [380, 300], [20, 300]]},
                description="女孩读书",
            )
        ]
    )
    panel = page.panels[0]
    panel.caption_auto_en = {
        "format": "scene-v1",
        "text": "A girl reads.",
        "source_hash": source_hash(panel, page, {}),
    }
    caption = compile_page(page, slant_mode=mode)["items"][0]["caption"]
    assert caption.count("slanted panel") == 1
    assert caption == panel_caption_info(panel, page, {})["caption"]
