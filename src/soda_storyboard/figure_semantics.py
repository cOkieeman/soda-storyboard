"""Shared figure footprints and conservative, bilingual pose descriptions.

Editor coordinates use the exact rig used by the wireframe. Legacy footprint
rounding intentionally follows the original production mask algorithm.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import ceil, floor, hypot
from typing import TYPE_CHECKING

from PIL import Image, ImageDraw

from .figure_rig import JOINT_NAMES, POSE_PRESETS, STAND, ensure_figure_editor, rig_bounds, rig_primitives
from .figures import POSITIONS
from .geometry import polygon_area, shape_bbox, shape_polygon

if TYPE_CHECKING:
    from collections.abc import Callable

    from .models import Figure, Panel

# ruff: noqa: PLR2004, RUF001 -- explicit geometric thresholds and Chinese templates.

POSE_DESCRIPTIONS = {
    "stand": ("站立", "standing"),
    "walk": ("行走", "walking"),
    "run": ("奔跑", "running"),
    "sit": ("坐着", "sitting"),
    "crouch": ("蹲着", "crouching"),
    "wave": ("站立挥手", "standing and waving"),
    "point": ("站立，伸手指向一侧", "standing and pointing to one side"),
    "arms_up": ("站立，双手举过头顶", "standing with both hands above the head"),
    "hands_clasped": ("站立，双手在身前交握", "standing with hands clasped in front"),
    "hand_on_chin": ("站立，一只手托着下巴", "standing with one hand on the chin"),
    "lie": ("躺着", "lying down"),
    "back_view": ("背身站立", "standing with the back toward the viewer"),
    "handshake": ("站立，伸出一只手准备握手", "standing with one hand extended for a handshake"),
    "hug": ("站立，双臂向前作拥抱姿势", "standing with arms reaching forward in an embracing pose"),
}
_ARM_POSES = {"wave", "point", "arms_up", "hands_clasped", "hand_on_chin", "handshake", "hug"}
_ARMS = {"lElbow", "lHand", "rElbow", "rHand"}
_LEGS = {"lKnee", "lFoot", "rKnee", "rFoot"}


def _clip_box(box: tuple[float, float, float, float], panel: Panel) -> tuple[float, float, float, float]:
    """Clip an axis-aligned footprint to the actual convex panel polygon."""
    left, top, right, bottom = box
    points = [(left, top), (right, top), (right, bottom), (left, bottom)]
    clip = shape_polygon(panel.shape)
    orientation = 1 if polygon_area(clip) > 0 else -1
    for start, end in zip(clip, [*clip[1:], clip[0]], strict=True):
        if not points:
            break
        dx, dy = end[0] - start[0], end[1] - start[1]

        output = []
        previous = points[-1]
        previous_distance = orientation * (dx * (previous[1] - start[1]) - dy * (previous[0] - start[0]))
        for current in points:
            current_distance = orientation * (dx * (current[1] - start[1]) - dy * (current[0] - start[0]))
            if (current_distance >= 0) != (previous_distance >= 0):
                ratio = previous_distance / (previous_distance - current_distance)
                output.append(
                    (
                        previous[0] + (current[0] - previous[0]) * ratio,
                        previous[1] + (current[1] - previous[1]) * ratio,
                    )
                )
            if current_distance >= 0:
                output.append(current)
            previous, previous_distance = current, current_distance
        points = output
    if not points:
        x, y, _, _ = shape_bbox(panel.shape)
        return x, y, x, y
    return (
        min(p[0] for p in points),
        min(p[1] for p in points),
        max(p[0] for p in points),
        max(p[1] for p in points),
    )


def _raster_clip_box(box: tuple[int, int, int, int], panel: Panel) -> tuple[int, int, int, int]:
    """Use the production polygon's pixel intersection without a page-size image.

    Pillow truncates polygon vertices to integer pixels. Do that in the same
    panel-local coordinate system as ``quad_mask`` before translating into the
    small footprint crop, where some vertices can become negative.
    """
    left, top, right, bottom = box
    px, py, _, _ = shape_bbox(panel.shape)
    origin_x, origin_y = floor(px), floor(py)
    points = [
        (int(x - origin_x) - (left - origin_x), int(y - origin_y) - (top - origin_y))
        for x, y in shape_polygon(panel.shape)
    ]
    mask = Image.new("L", (right - left, bottom - top))
    ImageDraw.Draw(mask).polygon(points, fill=255)
    bounds = mask.getbbox()
    if bounds is None:
        return left, top, left, top
    return bounds[0] + left, bounds[1] + top, bounds[2] + left, bounds[3] + top


def figure_page_box(figure: Figure, panel: Panel) -> tuple[int, int, int, int]:
    """Return page-pixel xyxy bounds; an invisible clipped figure has zero area.

    Editors use outward-rounded, half-open bounds including rig stroke widths.
    Without an editor extension, legacy bbox/position values retain their
    original rounding, even when they extend beyond the panel.
    """
    px, py, right, bottom = shape_bbox(panel.shape)
    origin_x, origin_y = floor(px), floor(py)
    width, height = ceil(right) - origin_x, ceil(bottom) - origin_y
    if figure.extra.get("editor") is not None:
        editor = ensure_figure_editor(figure, right - px, bottom - py, panel.shot)
        box = rig_bounds(rig_primitives(editor, (px, py)))
        if not editor["break_frame"]:
            box = _clip_box(box, panel)
        if box[2] <= box[0] or box[3] <= box[1]:
            x, y = round(box[0]), round(box[1])
            return x, y, x, y
        pixels = floor(box[0]), floor(box[1]), ceil(box[2]), ceil(box[3])
        if panel.shape_type == "quad" and not editor["break_frame"]:
            return _raster_clip_box(pixels, panel)
        return pixels
    if "bbox" in figure.extra:
        bounds = figure.extra["bbox"]
        return (
            origin_x + round(bounds["x"] - origin_x),
            origin_y + round(bounds["y"] - origin_y),
            origin_x + round(bounds["x"] + bounds["w"] - origin_x),
            origin_y + round(bounds["y"] + bounds["h"] - origin_y),
        )
    position = POSITIONS.get(figure.position, 0.5) if isinstance(figure.position, str) else figure.position
    if not 0 <= position <= 1:
        message = "人物 position 必须在 0 到 1 之间"
        raise ValueError(message)
    cx = width * position
    half = min(width * 0.21, height * 0.25)
    return (
        origin_x + round(cx - half),
        origin_y + round(height * 0.06),
        origin_x + round(cx + half),
        origin_y + round(height * 0.98),
    )


def _modified_joints(figure: Figure, joints: dict) -> set[str]:
    preset = POSE_PRESETS.get(figure.pose, STAND)
    return {
        name
        for name in JOINT_NAMES
        if hypot(joints[name][0] - preset[name][0], joints[name][1] - preset[name][1]) > 1
    }


@dataclass(frozen=True)
class _JointFacts:
    lean: float = 0
    counterturn: bool = False
    raised: int = 0
    on_hip: int = 0
    reaching: tuple[str, ...] = ()
    both_forward: bool = False
    kneeling: int = 0
    bent: int = 0
    crouched: bool = False


@dataclass(frozen=True)
class _JointRule:
    """One independently gated geometric assertion and its bilingual wording."""

    matches: Callable[[_JointFacts], bool]
    wording: tuple[str, str]


_JOINT_RULES = (
    _JointRule(lambda f: f.lean >= 0.35, ("身体前倾", "leaning forward")),
    _JointRule(lambda f: f.lean <= -0.35, ("身体后仰", "leaning backward")),
    _JointRule(lambda f: f.counterturn, ("回头", "head turned back")),
    _JointRule(lambda f: f.raised == 2, ("双手举过头顶", "both hands raised above the head")),
    _JointRule(lambda f: f.raised == 1, ("一只手举过头顶", "one hand raised above the head")),
    _JointRule(lambda f: f.on_hip == 2, ("双手叉腰", "both hands on the hips")),
    _JointRule(lambda f: f.on_hip == 1, ("一只手叉腰", "one hand on the hip")),
    _JointRule(lambda f: f.both_forward, ("双手前伸", "both hands reaching forward")),
    _JointRule(lambda f: f.kneeling == 2, ("双膝跪地", "kneeling on both knees")),
    _JointRule(lambda f: f.kneeling == 1, ("单膝跪地", "kneeling on one knee")),
    _JointRule(lambda f: f.crouched, ("屈膝蹲着", "crouching with knees bent")),
    _JointRule(lambda f: f.bent == 2 and not f.crouched and not f.kneeling, ("双腿屈膝", "both knees bent")),
    _JointRule(lambda f: f.bent == 1 and not f.crouched and not f.kneeling, ("一腿屈膝", "one knee bent")),
)
_REACH_DIRECTIONS = {
    "left": ("左方", "left"),
    "right": ("右方", "right"),
    "upper left": ("左上方", "toward the upper left"),
    "upper right": ("右上方", "toward the upper right"),
    "lower left": ("左下方", "toward the lower left"),
    "lower right": ("右下方", "toward the lower right"),
}


def _reach_direction(dx: float, dy: float) -> str:
    if abs(dx) >= abs(dy) * 1.6:
        return "right" if dx > 0 else "left"
    return ("upper " if dy < 0 else "lower ") + ("right" if dx > 0 else "left")


def _arm_facts(joints: dict, modified: set[str], flip: int, forward: int) -> dict:
    head, neck, hip = (joints[name] for name in ("head", "neck", "hip"))
    raised, on_hip, reaching = [], [], []
    for side in ("l", "r"):
        hand, elbow = (joints[f"{side}{name}"] for name in ("Hand", "Elbow"))
        if hand[1] < head[1] - 5:
            raised.append(side)
        elif (
            abs(hand[1] - hip[1]) <= 5
            and 3 <= abs(hand[0] - hip[0]) <= 12
            and abs(elbow[0] - hip[0]) > abs(hand[0] - hip[0]) + 5
        ):
            on_hip.append(side)
        elif (
            abs(hand[0] - neck[0]) >= 24
            and abs(hand[0] - neck[0]) > abs(elbow[0] - neck[0]) + 8
            and abs(hand[1] - neck[1]) <= abs(hand[0] - neck[0])
        ):
            reaching.append(_reach_direction((hand[0] - neck[0]) * flip, hand[1] - neck[1]))
    arms_changed = bool(modified & (_ARMS | {"neck", "hip"}))
    return {
        "raised": len(raised) if any(f"{s}Hand" in modified for s in raised) else 0,
        "on_hip": len(on_hip) if any(modified & {f"{s}Hand", f"{s}Elbow"} for s in on_hip) else 0,
        "reaching": tuple(reaching) if arms_changed else (),
        "both_forward": arms_changed
        and len(reaching) == 2
        and forward != 0
        and all((joints[f"{s}Hand"][0] - neck[0]) * flip * forward >= 24 for s in ("l", "r")),
    }


def _bent_knee(hip: list, knee: list, foot: list) -> bool:
    upper = hip[0] - knee[0], hip[1] - knee[1]
    lower = foot[0] - knee[0], foot[1] - knee[1]
    lengths = hypot(*upper) * hypot(*lower)
    # A straight knee has cosine -1; require at least about 55 degrees of bend.
    return lengths >= 100 and (upper[0] * lower[0] + upper[1] * lower[1]) / lengths >= -0.57


def _leg_facts(joints: dict, modified: set[str]) -> dict:
    if not modified & (_LEGS | {"hip"}):
        return {}
    hip = joints["hip"]
    floor_y = max(joints["lFoot"][1], joints["rFoot"][1])
    grounded, bent = [], []
    for side in ("l", "r"):
        knee, foot = (joints[f"{side}{name}"] for name in ("Knee", "Foot"))
        if _bent_knee(hip, knee, foot):
            bent.append(side)
        if abs(knee[1] - floor_y) <= 4 and knee[1] - hip[1] >= 15 and abs(knee[0] - foot[0]) >= 12:
            grounded.append(side)
    kneeling = len(grounded)
    if kneeling == 1:
        other = "r" if grounded[0] == "l" else "l"
        knee, foot = joints[f"{other}Knee"], joints[f"{other}Foot"]
        if abs(foot[1] - floor_y) > 4 or foot[1] - knee[1] < 12:
            kneeling = 0
    return {
        "kneeling": kneeling,
        "bent": len(bent),
        "crouched": not kneeling
        and len(bent) == 2
        and 15 <= floor_y - hip[1] <= 40
        and abs(joints["lFoot"][1] - joints["rFoot"][1]) <= 4,
    }


def _joint_descriptions(figure: Figure, editor: dict, modified: set[str], language: str) -> list[str]:
    """Match clear silhouettes; side counterturns require both head and torso edits."""
    joints = editor["joints"]
    head, neck, hip = (joints[name] for name in ("head", "neck", "hip"))
    # Lying/rotated rigs do not support gravity-based upright action claims.
    # A leaning torso remains eligible, unlike the former all-or-nothing guard.
    if not modified or hip[1] - neck[1] < 8:
        return []
    index = language == "en"
    flip = -1 if editor["flip"] else 1
    forward = {"facing left": -1, "facing right": 1}.get(_facing_description(figure, editor, "en"), 0)
    lean = (
        (neck[0] - hip[0]) * flip * forward / hypot(neck[0] - hip[0], neck[1] - hip[1])
        if modified & {"neck", "hip"}
        else 0
    )
    facts = _JointFacts(
        lean=lean,
        counterturn=editor["view"] == "side"
        and {"head", "neck"} <= modified
        and lean >= 0.35
        and (head[0] - neck[0]) * flip * forward <= -14
        and 5 <= neck[1] - head[1] <= 28,
        **_arm_facts(joints, modified, flip, forward),
        **_leg_facts(joints, modified),
    )
    phrases = [rule.wording[index] for rule in _JOINT_RULES if rule.matches(facts)]
    for direction in dict.fromkeys(facts.reaching):
        count = facts.reaching.count(direction)
        zh, en = _REACH_DIRECTIONS[direction]
        phrases.append(
            (
                f"{'双手' if count == 2 else '一只手'}伸向{zh}",
                f"{'both hands' if count == 2 else 'one hand'} reaching {en}",
            )[index]
        )
    return phrases


def _facing_description(figure: Figure, editor: dict | None, language: str) -> str:
    index = language == "en"
    direction = "back" if figure.pose == "back_view" else figure.facing
    if editor is not None:
        if editor["view"] == "side":
            neck, hip = (editor["joints"][name] for name in ("neck", "hip"))
            # The profile nose in rig_primitives lies on this torso normal.
            dx, dy = (hip[1] - neck[1]) * (-1 if editor["flip"] else 1), neck[0] - hip[0]
            if hypot(dx, dy) > 1:
                direction = (
                    ("right" if dx >= 0 else "left") if abs(dx) >= abs(dy) else ("down" if dy >= 0 else "up")
                )
            else:
                return ""
        elif direction in {"left", "right"}:
            direction = "left" if editor["flip"] else "right"
    return {
        "front": ("面向画面", "facing the viewer"),
        "back": ("背对画面", "facing away from the viewer"),
        "left": ("面朝左", "facing left"),
        "right": ("面朝右", "facing right"),
        "up": ("面朝上", "facing upward"),
        "down": ("面朝下", "facing downward"),
    }.get(direction, ("", ""))[index]


def figure_description(figure: Figure, language: str = "zh", *, head_only: bool = False) -> str:
    """Describe actual presets, projected facing, mirroring and clear edits.

    Explicit editor flips are authoritative for left/right facing; they are
    never applied a second time to the persisted facing value. A head joint
    moved alone never establishes a turn, intent or emotion.
    """
    index = language == "en"
    raw = figure.extra.get("editor")
    editor = ensure_figure_editor(figure, 300, 400) if raw is not None else None
    text = POSE_DESCRIPTIONS.get(figure.pose, ("", ""))[index]
    details = []
    if editor is not None:
        modified = _modified_joints(figure, editor["joints"])
        details = _joint_descriptions(figure, editor, modified, language)
        posture_changed = bool(modified & (_LEGS | {"neck", "hip"}))
        if posture_changed:
            # The stored preset is only a starting pose after manual edits.
            # Avoid claiming standing/running/sitting when legs no longer agree.
            text = ""
        elif figure.pose in _ARM_POSES and modified & _ARMS:
            text = ("站立", "standing")[index]
        if figure.pose == "lie" and not posture_changed:
            text = ("侧身躺着", "lying on one side")[index] if editor["view"] == "side" else text
        if figure.pose == "lie":
            head, hip = (editor["joints"][name] for name in ("head", "hip"))
            dx = (head[0] - hip[0]) * (-1 if editor["flip"] else 1)
            if abs(dx) > abs(head[1] - hip[1]) * 2 and abs(dx) > 15:
                details.append(
                    ("头部位于右侧", "head toward the right")[index]
                    if dx > 0
                    else ("头部位于左侧", "head toward the left")[index]
                )
    if head_only:
        text = ("一只手托着下巴", "one hand on the chin")[index] if "下巴" in text or "chin" in text else ""
        details = [
            detail
            for detail in details
            if any(phrase in detail for phrase in ("头部", "回头", "head toward", "head turned"))
        ]
    parts = [text, _facing_description(figure, editor, language), *details]
    if editor is not None and editor["flip"]:
        parts.append(("水平镜像", "horizontally mirrored")[index])
    return (", " if index else "，").join(dict.fromkeys(part for part in parts if part))
