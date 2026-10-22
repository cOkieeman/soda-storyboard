"""F7 regressions for joint-derived actions and intact scene subjects."""

from __future__ import annotations

import copy

import pytest

from soda_storyboard.captions import character_caption, source_hash, structured_caption
from soda_storyboard.compiler import compile_page
from soda_storyboard.figure_rig import POSE_PRESETS
from soda_storyboard.figure_semantics import figure_description
from soda_storyboard.models import Character, Figure, Page, Panel, RectShape

# ruff: noqa: RUF001 -- preserve the exact Chinese source scene and appearance punctuation.

# Coordinates and scene prose transcribed from the T2 confirmed rooftop page.
T2_P4_JOINTS = {
    **POSE_PRESETS["point"],
    "head": [23.530194349826637, -85.2407318197308],
    "neck": [21.59078686984228, -66.33150888988342],
    "rHand": [55.045565899572246, -84.75587994973469],
}
T2_P6_SCENE = (
    "天台栏杆旁，Sylvia在左边拿着画稿转头看向右边的鲸鱼娘；"
    "鲸鱼娘僵在原地，双手抱紧剩下的稿纸，尾巴也僵住，两人尴尬对视。"
)


def _figure(*, pose: str = "stand", flip: bool = False, view: str = "front", **joints: list) -> Figure:
    return Figure(
        "sylvia",
        pose=pose,
        facing="left" if flip else "right",
        extra={
            "editor": {
                "x": 610,
                "y": 530,
                "size": 492.23999999999984,
                "flip": flip,
                "view": view,
                "break_frame": True,
                "joints": {**POSE_PRESETS[pose], **joints},
            }
        },
    )


def _page(figure: Figure) -> tuple[Page, dict[str, Character]]:
    characters = {
        "sylvia": Character(
            "sylvia",
            "Sylvia",
            appearance_zh="长直浅金发，齐刘海，白色长袖衬衫外搭深色背心裙，戴手表",
            appearance_en="long straight pale blonde hair, blunt bangs, a wristwatch",
            trigger_words=["Sylvia"],
        ),
        "whale": Character("whale", "鲸鱼娘", appearance_zh="深色长发，鲸鱼尾巴", trigger_words=["鲸鱼娘"]),
    }
    page = Page(panels=[Panel("p4", 4, RectShape(46, 474, 932, 586), shot="full", figures=[figure])])
    return page, characters


@pytest.mark.parametrize(
    ("language", "lean", "reach"),
    [("zh", "身体前倾", "一只手伸向左方"), ("en", "leaning forward", "one hand reaching left")],
)
def test_t2_p4_actual_joints_reach_figure_and_panel_captions(language: str, lean: str, reach: str) -> None:
    figure = _figure(pose="point", flip=True, **T2_P4_JOINTS)
    page, characters = _page(figure)
    original = copy.deepcopy(page.to_dict())
    descriptions = [
        figure_description(figure, language),
        structured_caption(page.panels[0], page, characters, language),
    ]
    if language == "en":
        panel = page.panels[0]
        panel.caption_auto_en = {
            "text": descriptions[-1],
            "source_hash": source_hash(panel, page, characters),
        }
    result = compile_page(page, characters, caption_language=language)
    descriptions.extend(item["caption"] for item in result["items"])
    for caption in descriptions:
        assert lean in caption
        assert reach in caption
    page.panels[0].caption_auto_en = None
    assert page.to_dict() == original


@pytest.mark.parametrize(
    ("joints", "zh", "en"),
    [
        ({"neck": [14, -74]}, "身体前倾", "leaning forward"),
        ({"neck": [-14, -74]}, "身体后仰", "leaning backward"),
        ({"rHand": [48, -78]}, "一只手伸向右方", "one hand reaching right"),
        ({"lHand": [-48, -78]}, "一只手伸向左方", "one hand reaching left"),
        ({"rHand": [30, -108]}, "一只手举过头顶", "one hand raised above the head"),
        ({"lHand": [-26, -108], "rHand": [26, -108]}, "双手举过头顶", "both hands raised above the head"),
        (
            {"lElbow": [15, -72], "lHand": [42, -75], "rElbow": [21, -66], "rHand": [44, -69]},
            "双手前伸",
            "both hands reaching forward",
        ),
        ({"lKnee": [-25, -25], "lFoot": [0, 0], "rKnee": [25, -25], "rFoot": [0, 0]}, "屈膝", "knees bent"),
        (POSE_PRESETS["crouch"], "蹲着", "crouching"),
        (
            {"lKnee": [-25, 0], "lFoot": [-45, 0], "rKnee": [20, -22], "rFoot": [23, 0]},
            "单膝跪地",
            "kneeling on one knee",
        ),
        (
            {"lKnee": [-25, 0], "lFoot": [-45, 0], "rKnee": [25, 0], "rFoot": [45, 0]},
            "双膝跪地",
            "kneeling on both knees",
        ),
    ],
)
def test_clear_joint_patterns_are_bilingual(joints: dict, zh: str, en: str) -> None:
    figure = _figure(**joints)
    assert zh in figure_description(figure, "zh")
    assert en in figure_description(figure, "en")


def test_horizontal_mirror_changes_reach_direction_without_reversing_forward_lean() -> None:
    figure = _figure(flip=True, neck=[14, -74], rHand=[48, -78])
    description = figure_description(figure, "en")
    assert "one hand reaching left" in description
    assert "leaning forward" in description


def test_only_a_clear_side_view_counterturn_is_described_as_looking_back() -> None:
    figure = _figure(view="side", neck=[16, -74], head=[-4, -88])
    assert "回头" in figure_description(figure, "zh")
    assert "head turned back" in figure_description(figure, "en")
    figure.extra["editor"]["view"] = "front"
    assert "回头" not in figure_description(figure, "zh")
    only_head = _figure(view="side", head=[-20, -91])
    assert "回头" not in figure_description(only_head, "zh")


def test_lying_rig_never_acquires_upright_limb_or_torso_claims() -> None:
    figure = _figure(pose="lie", rHand=[46, -30])
    result = figure_description(figure, "en")
    for phrase in ("leaning", "above the head", "kneeling", "crouching", "reaching"):
        assert phrase not in result


def test_t2_p6_preserves_subjects_objects_and_scene_action() -> None:
    page, characters = _page(_figure())
    panel = page.panels[0]
    panel.description = T2_P6_SCENE
    panel.figures = [Figure("sylvia"), Figure("whale", pose="hands_clasped")]
    panel.character_ids = ["sylvia", "whale"]
    caption = structured_caption(panel, page, characters, "zh")
    assert "Sylvia在左边拿着画稿转头看向右边的鲸鱼娘" in caption
    assert "鲸鱼娘僵在原地" in caption
    assert "双手抱紧剩下的稿纸" in caption


@pytest.mark.parametrize("language", ["zh", "en"])
def test_display_name_equal_to_trigger_is_emitted_once_and_trigger_survives(language: str) -> None:
    _, characters = _page(_figure())
    caption = character_caption("sylvia", characters, language)
    assert caption.count("Sylvia") == 1
    characters["sylvia"].trigger_words.append("sylvia_character_v2")
    caption = character_caption("sylvia", characters, language)
    assert "sylvia_character_v2" in caption


def test_trigger_is_not_dropped_as_a_substring_of_another_word() -> None:
    characters = {
        "sylvia": Character(
            "sylvia", "Sylvia", appearance_en="SylviaMOSS_v20, blonde hair", trigger_words=["SylviaMOSS_v2"]
        )
    }
    assert "SylviaMOSS_v2," in character_caption("sylvia", characters, "en") + ","
    characters["sylvia"].display_name = "sylviamoss_v2"
    assert (character_caption("sylvia", characters, "en").casefold() + ",").count("sylviamoss_v2,") == 1


def test_only_standalone_duplicate_appearance_clauses_are_removed() -> None:
    page, characters = _page(_figure())
    panel = page.panels[0]
    panel.description = "齐刘海，Sylvia向鲸鱼娘伸手，鲸鱼娘看向Sylvia"
    caption = structured_caption(panel, page, characters, "zh")
    assert caption.count("齐刘海") == 1
    assert "Sylvia向鲸鱼娘伸手" in caption
    assert "鲸鱼娘看向Sylvia" in caption
