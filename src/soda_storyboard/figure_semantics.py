"""Shared figure footprints and conservative, bilingual pose descriptions.

Editor coordinates use the exact rig used by the wireframe. Legacy footprint
rounding intentionally follows the original production mask algorithm.
"""

from __future__ import annotations

from math import ceil, floor, hypot
from typing import TYPE_CHECKING

from PIL import Image, ImageDraw

from .figure_rig import JOINT_NAMES, POSE_PRESETS, STAND, ensure_figure_editor, rig_bounds, rig_primitives
from .figures import POSITIONS
from .geometry import polygon_area, shape_bbox, shape_polygon

if TYPE_CHECKING:
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


def _joint_descriptions(joints: dict, modified: set[str], language: str) -> list[str]:
    """Infer only clear joint configurations, never gaze from head position."""
    if not modified:
        return []
    index = language == "en"
    head, neck, hip = (joints[name] for name in ("head", "neck", "hip"))
    # Upright limbs are the only reliable source for these rules. Rotated rigs
    # and lying figures must not acquire hand-raising or kneeling assertions.
    if hip[1] - neck[1] < 15 or abs(hip[0] - neck[0]) > (hip[1] - neck[1]) * 0.5:
        return []
    phrases = []
    raised = [side for side in ("l", "r") if joints[f"{side}Hand"][1] < head[1] - 5]
    if raised and any(f"{side}Hand" in modified for side in raised):
        phrases.append(
            ("双手举过头顶", "both hands raised above the head")[index]
            if len(raised) == 2
            else ("一只手举过头顶", "one hand raised above the head")[index]
        )
    on_hip = [
        side
        for side in ("l", "r")
        if abs(joints[f"{side}Hand"][1] - hip[1]) <= 5
        and 3 <= abs(joints[f"{side}Hand"][0] - hip[0]) <= 12
        and abs(joints[f"{side}Elbow"][0] - hip[0]) > abs(joints[f"{side}Hand"][0] - hip[0]) + 5
    ]
    if on_hip and any(f"{side}Hand" in modified or f"{side}Elbow" in modified for side in on_hip):
        phrases.append(
            ("双手叉腰", "both hands on the hips")[index]
            if len(on_hip) == 2
            else ("一只手叉腰", "one hand on the hip")[index]
        )
    floor_y = max(joints["lFoot"][1], joints["rFoot"][1])
    grounded = [
        side
        for side in ("l", "r")
        if abs(joints[f"{side}Knee"][1] - floor_y) <= 4
        and joints[f"{side}Knee"][1] - hip[1] >= 15
        and abs(joints[f"{side}Knee"][0] - joints[f"{side}Foot"][0]) >= 12
    ]
    if len(grounded) == 1 and modified & _LEGS:
        other = "r" if grounded[0] == "l" else "l"
        knee, foot = joints[f"{other}Knee"], joints[f"{other}Foot"]
        if abs(foot[1] - floor_y) <= 4 and foot[1] - knee[1] >= 12:
            phrases.append(("单膝跪地", "kneeling on one knee")[index])
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


def figure_description(figure: Figure, language: str = "zh") -> str:
    """Describe actual presets, projected facing, mirroring and clear edits.

    Explicit editor flips are authoritative for left/right facing; they are
    never applied a second time to the persisted facing value. No rule infers
    a head turn, intent or emotion from a featureless joint position.
    """
    index = language == "en"
    raw = figure.extra.get("editor")
    editor = ensure_figure_editor(figure, 300, 400) if raw is not None else None
    text = POSE_DESCRIPTIONS.get(figure.pose, ("", ""))[index]
    details = []
    if editor is not None:
        modified = _modified_joints(figure, editor["joints"])
        details = _joint_descriptions(editor["joints"], modified, language)
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
    parts = [text, _facing_description(figure, editor, language), *details]
    if editor is not None and editor["flip"]:
        parts.append(("水平镜像", "horizontally mirrored")[index])
    return (", " if index else "，").join(dict.fromkeys(part for part in parts if part))
