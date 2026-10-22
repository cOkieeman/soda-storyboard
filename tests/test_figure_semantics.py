from __future__ import annotations

from math import ceil, floor

import pytest

from soda_storyboard.figure_rig import POSE_PRESETS, ensure_figure_editor, rig_bounds, rig_primitives
from soda_storyboard.figure_semantics import POSE_DESCRIPTIONS, figure_description, figure_page_box
from soda_storyboard.models import POSES, Figure, Page, Panel
from soda_storyboard.production.errors import ProductionError
from soda_storyboard.production.imaging import _figure_box, figure_mask, panel_box


def panel_with(figure: Figure) -> Panel:
    return Panel(
        "p", 1, {"type": "rect", "x": 50, "y": 80, "w": 400, "h": 600}, shot="full", figures=[figure]
    )


def edited_figure(*, pose: str = "stand", facing: str = "front", **editor: object) -> Figure:
    return Figure.from_dict(
        {
            "character_id": "girl",
            "pose": pose,
            "facing": facing,
            "editor": {"version": 1, "x": 160, "y": 270, "size": 200, "style": "box", **editor},
        }
    )


def test_editor_box_is_the_rendered_rig_bounds() -> None:
    figure = edited_figure(joints={"rHand": [60, -110]})
    panel = panel_with(figure)
    editor = ensure_figure_editor(figure, 400, 600, "full")
    bounds = rig_bounds(rig_primitives(editor, (50, 80)))
    assert figure_page_box(figure, panel) == (
        floor(bounds[0]),
        floor(bounds[1]),
        ceil(bounds[2]),
        ceil(bounds[3]),
    )
    assert _figure_box(figure, panel) == (
        floor(bounds[0]) - 50,
        floor(bounds[1]) - 80,
        ceil(bounds[2]) - 50,
        ceil(bounds[3]) - 80,
    )


def test_position_size_pose_and_mirror_change_the_shared_footprint() -> None:
    figure = edited_figure(pose="point")
    panel = panel_with(figure)
    before = figure_page_box(figure, panel)
    moved = edited_figure(pose="point", x=195, y=315)
    assert figure_page_box(moved, panel) == tuple(
        v + (35 if i % 2 == 0 else 45) for i, v in enumerate(before)
    )
    larger = figure_page_box(edited_figure(pose="point", size=260), panel)
    assert larger[2] - larger[0] > before[2] - before[0]
    assert larger[3] - larger[1] > before[3] - before[1]
    assert figure_page_box(edited_figure(pose="lie", view="side"), panel) != before
    mirror = figure_page_box(edited_figure(pose="point", flip=True), panel)
    assert before[0] + mirror[2] == before[2] + mirror[0] == 2 * (50 + 160)


def test_break_frame_controls_visible_footprint() -> None:
    clipped = edited_figure(x=10, y=150)
    panel = panel_with(clipped)
    assert figure_page_box(clipped, panel)[0:2] == (50, 80)
    broken = edited_figure(x=10, y=150, break_frame=True)
    left, top, _, _ = figure_page_box(broken, panel)
    assert left < 50
    assert top < 80
    hidden = edited_figure(x=-500)
    left, top, right, bottom = figure_page_box(hidden, panel)
    assert right == left
    assert bottom == top
    panel.figures = [hidden]
    with pytest.raises(ProductionError, match="人物遮罩为空"):
        figure_mask(panel, Page(panels=[panel]), "girl", margin=0, feather=0)


def test_quad_clipping_uses_the_polygon_and_not_only_its_aabb() -> None:
    figure = edited_figure(x=10, y=140, size=40)
    panel = Panel(
        "p", 1, {"type": "quad", "points": [[200, 0], [400, 200], [200, 400], [0, 200]]}, figures=[figure]
    )
    left, top, right, bottom = figure_page_box(figure, panel)
    assert left == right
    assert top == bottom
    figure.extra["editor"]["break_frame"] = True
    left, top, right, bottom = figure_page_box(figure, panel)
    assert left < right
    assert top < bottom


def test_clipped_empty_box_stays_empty_with_fractional_panel_coordinates() -> None:
    figure = edited_figure(x=-500)
    panel = panel_with(figure)
    panel.shape.update(x=50.3, y=80.7)
    left, top, right, bottom = figure_page_box(figure, panel)
    assert left == right
    assert top == bottom


@pytest.mark.parametrize("offset", [0, 0.3, 0.9])
@pytest.mark.parametrize(("x", "y"), [(0, 190), (0, 200), (10, 180), (10, 190), (20, 190), (55, 140)])
def test_quad_mask_and_shared_box_use_the_same_pixel_intersection(offset: float, x: int, y: int) -> None:
    figure = edited_figure(x=x, y=y, size=90)
    points = [[px + offset, py + offset] for px, py in ((200, 0), (400, 200), (200, 400), (0, 200))]
    panel = Panel("p", 1, {"type": "quad", "points": points}, figures=[figure])
    page = Page(panels=[panel])
    px, py, _, _ = panel_box(panel)
    bounds = figure_mask(panel, page, "girl", margin=0, feather=0).getbbox()
    assert bounds is not None
    assert figure_page_box(figure, panel) == (
        bounds[0] + px,
        bounds[1] + py,
        bounds[2] + px,
        bounds[3] + py,
    )


@pytest.mark.parametrize(
    ("position", "expected"),
    [
        ("left", (8, 36, 176, 588)),
        ("center", (116, 36, 284, 588)),
        ("right", (224, 36, 392, 588)),
        (0.4, (76, 36, 244, 588)),
        (0, (-84, 36, 84, 588)),
    ],
)
def test_legacy_position_rounding_remains_unchanged(position: float | str, expected: tuple[int, ...]) -> None:
    figure = Figure("girl", position=position)
    panel = panel_with(figure)
    assert _figure_box(figure, panel) == expected
    assert figure_page_box(figure, panel) == (
        expected[0] + 50,
        expected[1] + 80,
        expected[2] + 50,
        expected[3] + 80,
    )


def test_legacy_bbox_rounding_is_retained_and_editor_geometry_takes_precedence() -> None:
    figure = Figure("girl", extra={"bbox": {"x": 81.5, "y": 101.5, "w": 111, "h": 222}})
    panel = panel_with(figure)
    assert _figure_box(figure, panel) == (32, 22, 142, 244)
    before = figure.to_dict()
    figure_description(figure)
    figure_page_box(figure, panel)
    assert figure.to_dict() == before
    figure.extra["editor"] = edited_figure().extra["editor"]
    assert figure_page_box(figure, panel) == figure_page_box(edited_figure(), panel)


def test_mask_uses_exactly_the_shared_integer_box() -> None:
    figure = edited_figure(joints={"rHand": [60.25, -110.25]})
    panel = panel_with(figure)
    page = Page(panels=[panel])
    mask = figure_mask(panel, page, "girl", margin=0, feather=0)
    assert mask.getbbox() == _figure_box(figure, panel)
    px, py, _, _ = panel_box(panel)
    assert figure_page_box(figure, panel) == tuple(
        v + (px if i % 2 == 0 else py) for i, v in enumerate(mask.getbbox())
    )


def test_every_real_preset_has_both_templates() -> None:
    assert set(POSE_DESCRIPTIONS) == set(POSE_PRESETS) == set(POSES)
    for pose in POSES:
        figure = Figure("girl", pose=pose)
        assert POSE_DESCRIPTIONS[pose][0] in figure_description(figure)
        assert POSE_DESCRIPTIONS[pose][1] in figure_description(figure, "en")


@pytest.mark.parametrize("facing", ["left", "right"])
def test_editor_mirror_is_authoritative_and_never_reapplied_to_facing(facing: str) -> None:
    mirrored = edited_figure(facing=facing, flip=True)
    assert "面朝左" in figure_description(mirrored)
    assert "面朝右" not in figure_description(mirrored)
    assert "水平镜像" in figure_description(mirrored)
    assert "facing left" in figure_description(mirrored, "en")
    unmirrored = edited_figure(facing=facing, flip=False)
    assert "面朝右" in figure_description(unmirrored)
    assert "水平镜像" not in figure_description(unmirrored)


def test_side_view_uses_the_rigs_profile_normal_and_mirrored_head_position() -> None:
    assert "面朝右" in figure_description(edited_figure(view="side", flip=False))
    assert "面朝左" in figure_description(edited_figure(view="side", flip=True))
    lying = figure_description(edited_figure(pose="lie", view="side", flip=False))
    mirrored = figure_description(edited_figure(pose="lie", view="side", flip=True))
    assert "侧身躺着" in lying
    assert "面朝下" in lying
    assert "头部位于右侧" in lying
    assert "面朝下" in mirrored
    assert "头部位于左侧" in mirrored


def test_manual_arm_edits_add_only_confident_descriptions() -> None:
    raised = edited_figure(joints={"rHand": [12, -112]})
    assert "一只手举过头顶" in figure_description(raised)
    assert "one hand raised above the head" in figure_description(raised, "en")
    hip = edited_figure(joints={"rHand": [7, -51], "rElbow": [20, -61]})
    assert "一只手叉腰" in figure_description(hip)
    reset_arms = edited_figure(pose="arms_up", joints={"lHand": [-17, -44], "rHand": [17, -44]})
    assert "举过头顶" not in figure_description(reset_arms)
    moved_head = edited_figure(joints={"head": [18, -91]})
    assert "回头" not in figure_description(moved_head)


def test_kneeling_rule_requires_a_grounded_knee_and_the_other_planted_foot() -> None:
    kneeling = edited_figure(
        joints={"lKnee": [-25, 0], "lFoot": [-45, 0], "rKnee": [20, -22], "rFoot": [23, 0]}
    )
    assert "单膝跪地" in figure_description(kneeling)
    assert "站立" not in figure_description(kneeling)
    assert "kneeling on one knee" in figure_description(kneeling, "en")
    kneeling.extra["editor"]["joints"]["rFoot"] = [23, -30]
    assert "单膝跪地" not in figure_description(kneeling)
