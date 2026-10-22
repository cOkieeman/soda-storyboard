from __future__ import annotations

import json
from math import isfinite

import pytest
from PIL import Image, ImageFont

from soda_storyboard.figure_rig import JOINT_NAMES, POSE_PRESETS, ensure_figure_editor, rig_primitives
from soda_storyboard.figures import draw_primitives, figure_geometry
from soda_storyboard.models import Figure


def editor_figure(**updates: object) -> Figure:
    editor = {"version": 1, "x": 160, "y": 270, "size": 200, "style": "box", **updates}
    return Figure.from_dict({"character_id": "girl", "id": "figure-one", "editor": editor})


def test_figure_editor_roundtrip_retains_identity_and_independent_joint_edits() -> None:
    figure = editor_figure(joints={"rHand": [55, -30]}, break_frame=True)
    saved = Figure.from_dict(json.loads(json.dumps(figure.to_dict())))
    assert saved.to_dict() == figure.to_dict()
    geometry = figure_geometry((400, 600), saved, None, shot="full", color="#00a8c4", origin=(10, 20))
    assert geometry["figure_id"] == "figure-one"
    assert geometry["break_frame"] is True
    assert geometry["primitives"][4]["points"][-1] == [280, 230]
    assert geometry == figure_geometry(
        (400, 600), figure, None, shot="full", color="#00a8c4", origin=(10, 20)
    )


def test_figure_anchor_flip_and_resizing_are_explicit() -> None:
    editor = ensure_figure_editor(editor_figure(style="stick"), 400, 600, "full")
    head = rig_primitives(editor)[0]
    assert (head["cx"], head["cy"], head["r"]) == (160, 87, 17)
    assert rig_primitives({**editor, "x": 195, "y": 315})[0]["cx"] == head["cx"] + 35
    assert rig_primitives({**editor, "size": 400})[0]["r"] == head["r"] * 2
    arms = rig_primitives({**editor, "flip": True})[4]
    assert arms["points"][-1] == [194, 182]


@pytest.mark.parametrize("style", ["stick", "box", "rough"])
@pytest.mark.parametrize("pose", list(POSE_PRESETS))
def test_every_rig_preset_renders_with_all_styles(pose: str, style: str) -> None:
    figure = editor_figure(style=style)
    figure.pose = pose
    geometry = figure_geometry((400, 600), figure, None, shot="full", color="#00a8c4")
    image = Image.new("RGBA", (400, 600))
    draw_primitives(image, geometry, font=ImageFont.load_default(), show_name=False)
    assert image.getbbox() is not None
    assert len(ensure_figure_editor(figure, 400, 600)["joints"]) == len(JOINT_NAMES)


@pytest.mark.parametrize(
    "raw",
    [
        False,
        "bad",
        [],
        {"joints": "bad"},
        {
            "x": float("nan"),
            "y": float("inf"),
            "size": -20,
            "style": [],
            "joints": {"head": [float("nan"), "bad"], "neck": [10**1000, -(10**1000)], "hip": []},
        },
    ],
)
def test_malformed_extensions_use_finite_bounded_defaults(raw: object) -> None:
    figure = Figure("girl", extra={"editor": raw})
    editor = ensure_figure_editor(figure, 400, 600)
    assert all(isfinite(value) for name in JOINT_NAMES for value in editor["joints"][name])
    assert 8 <= editor["size"] <= 20000
    # The real rendering path must also accept invalid extension JSON.
    geometry = figure_geometry((400, 600), figure, None, shot="full", color="#00a8c4")
    json.dumps(geometry, allow_nan=False)


def test_preview_scale_scales_editor_coordinates_and_does_not_move_anchor() -> None:
    figure = editor_figure(style="rough")
    regular = figure_geometry((400, 600), figure, None, shot="full", color="#00a8c4")
    scaled = figure_geometry((200, 300), figure, None, shot="full", color="#00a8c4", editor_scale=0.5)
    a, b = regular["primitives"][0], scaled["primitives"][0]
    assert b["cx"] == a["cx"] / 2
    assert b["cy"] == a["cy"] / 2
    assert b["r"] == a["r"] / 2


def test_normalization_never_rewrites_legacy_or_editor_source() -> None:
    legacy = Figure("girl", pose="wave", position="left", framing="waist")
    before = legacy.to_dict()
    editor = ensure_figure_editor(legacy, 400, 600)
    editor["joints"]["head"][0] = 300
    assert legacy.to_dict() == before
    assert ensure_figure_editor(legacy, 400, 600)["joints"]["head"][0] == 0


@pytest.mark.parametrize("view", [None, "front", "bad", False, 1, [], {}])
def test_absent_or_invalid_view_retains_front_geometry(view: object) -> None:
    figure = editor_figure(view=view)
    before = figure.to_dict()
    editor = ensure_figure_editor(figure, 400, 600)
    expected = ensure_figure_editor(editor_figure(), 400, 600)
    assert editor["view"] == "front"
    assert rig_primitives(editor) == rig_primitives(expected)
    assert figure.to_dict() == before


def test_side_lying_pose_uses_profile_torso_and_overlapping_bent_limbs() -> None:
    figure = editor_figure(view="side")
    figure.pose = "lie"
    editor = ensure_figure_editor(figure, 400, 600)
    primitives = rig_primitives(editor)
    head, torso = primitives[0], primitives[2]
    assert (head["cx"], head["cy"], head["r"]) == (244, 238, 17)
    assert torso["points"] == [[218, 237.6], [218, 250.4], [162, 249.6], [162, 238.4]]
    # Far limbs use a thinner line and precede the near limbs, instead of
    # spreading the four limbs symmetrically as a rotated front view does.
    far_arm, far_leg, near_arm, near_leg = primitives[3:7]
    assert far_arm["width"] == far_leg["width"] == 1
    assert near_arm["width"] == near_leg["width"] == 2
    assert far_arm["points"][-1] == [246, 264]
    assert near_arm["points"][-1] == [236, 272]
    assert far_leg["points"][-1] == [70, 250]
    assert near_leg["points"][-1] == [80, 266]
    assert primitives[7]["points"] == [[250, 253.6], [244, 259], [240, 253.6]]
    assert primitives[8]["points"] == [[252, 246], [246, 246]]


@pytest.mark.parametrize("style", ["stick", "box", "rough"])
@pytest.mark.parametrize("flip", [False, True])
def test_side_figure_view_and_custom_joints_survive_json_and_preview_scale(style: str, *, flip: bool) -> None:
    figure = editor_figure(view="side", style=style, flip=flip, joints={"rHand": [39.5, 2.25]})
    figure.pose = "lie"
    saved = Figure.from_dict(json.loads(json.dumps(figure.to_dict())))
    assert saved.to_dict() == figure.to_dict()
    assert ensure_figure_editor(saved, 400, 600)["view"] == "side"
    regular = figure_geometry((400, 600), saved, None, shot="full", color="#00a8c4")
    scaled = figure_geometry((200, 300), saved, None, shot="full", color="#00a8c4", editor_scale=0.5)
    assert regular == figure_geometry((400, 600), figure, None, shot="full", color="#00a8c4")
    assert len(regular["primitives"]) == len(scaled["primitives"])
    for original, half in zip(regular["primitives"], scaled["primitives"], strict=True):
        if original["type"] == "circle":
            assert (half["cx"], half["cy"], half["r"]) == (
                original["cx"] / 2,
                original["cy"] / 2,
                original["r"] / 2,
            )
        else:
            assert half["points"] == [[x / 2, y / 2] for x, y in original["points"]]
    opposite = ensure_figure_editor(saved, 400, 600)
    opposite["flip"] = not flip
    for original, mirrored in zip(regular["primitives"], rig_primitives(opposite), strict=True):
        if original["type"] == "circle":
            assert original["cx"] + mirrored["cx"] == 320
            assert original["cy"] == mirrored["cy"]
        else:
            for point, mirror_point in zip(original["points"], mirrored["points"], strict=True):
                assert point[0] + mirror_point[0] == 320
                assert point[1] == mirror_point[1]


def test_side_rough_head_uses_profile_instead_of_front_cross_guides() -> None:
    editor = ensure_figure_editor(editor_figure(view="side", style="rough"), 400, 600)
    primitives = rig_primitives(editor)
    assert len(primitives) == 13
    assert all(item["type"] == "circle" for item in primitives[-4:])
    box = rig_primitives({**editor, "style": "box"})
    assert primitives[:-4] == box
