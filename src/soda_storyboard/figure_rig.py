"""Editable 11-joint figures; coordinate rules match editor/src/lib/figureRig.ts.

The panel-local anchor is the middle of the feet. Joint coordinates use a
100-unit standing height and negative y above the feet. Legacy figures are
rendered by figures.py unless an explicit editor extension is present.
"""

from __future__ import annotations

from collections.abc import Mapping
from math import floor, hypot, isfinite
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import Figure

# ruff: noqa: PLR2004 -- geometry ratios and coordinates are intentionally numeric.

JOINT_NAMES = (
    "head",
    "neck",
    "hip",
    "lElbow",
    "lHand",
    "rElbow",
    "rHand",
    "lKnee",
    "lFoot",
    "rKnee",
    "rFoot",
)
STAND = {
    "head": (0, -91.5),
    "neck": (0, -78),
    "hip": (0, -51),
    "lElbow": (-14, -61),
    "lHand": (-17, -44),
    "rElbow": (14, -61),
    "rHand": (17, -44),
    "lKnee": (-7, -28),
    "lFoot": (-10, 0),
    "rKnee": (7, -28),
    "rFoot": (10, 0),
}
POSE_PRESETS = {
    "stand": STAND,
    "back_view": STAND,
    "walk": {**STAND, "lKnee": (-13, -30), "lFoot": (-24, -6), "rKnee": (12, -26), "rFoot": (25, -14)},
    "run": {
        **STAND,
        "lElbow": (-23, -62),
        "lHand": (-31, -76),
        "rElbow": (24, -88),
        "rHand": (32, -77),
        "lKnee": (-23, -31),
        "lFoot": (-35, -40),
        "rKnee": (24, -27),
        "rFoot": (30, -4),
    },
    "sit": {**STAND, "lKnee": (-24, -42), "lFoot": (-23, -14), "rKnee": (23, -42), "rFoot": (24, -14)},
    "crouch": {
        **STAND,
        "head": (-3, -72),
        "neck": (-2, -58),
        "hip": (9, -35),
        "lElbow": (-17, -43),
        "lHand": (-7, -25),
        "rElbow": (23, -45),
        "rHand": (25, -26),
        "lKnee": (-17, -18),
        "lFoot": (4, 0),
        "rKnee": (27, -18),
        "rFoot": (13, 0),
    },
    "wave": {**STAND, "rElbow": (20, -72), "rHand": (19, -96)},
    "point": {**STAND, "rElbow": (23, -76), "rHand": (38, -78)},
    "arms_up": {
        **STAND,
        "lElbow": (-19, -87),
        "lHand": (-24, -99),
        "rElbow": (19, -87),
        "rHand": (24, -99),
    },
    "hands_clasped": {
        **STAND,
        "lElbow": (-16, -56),
        "lHand": (0, -46),
        "rElbow": (16, -56),
        "rHand": (0, -46),
    },
    "hand_on_chin": {**STAND, "rElbow": (20, -69), "rHand": (2, -81)},
    "lie": {
        "head": (42, -16),
        "neck": (29, -13),
        "hip": (1, -13),
        "lElbow": (29, -4),
        "lHand": (43, -3),
        "rElbow": (23, 2),
        "rHand": (38, 1),
        "lKnee": (-20, -7),
        "lFoot": (-45, -10),
        "rKnee": (-18, 1),
        "rFoot": (-40, -2),
    },
    "handshake": {**STAND, "rElbow": (21, -64), "rHand": (33, -58)},
    "hug": {**STAND, "lElbow": (14, -69), "lHand": (34, -73), "rElbow": (24, -61), "rHand": (36, -62)},
}


def _safe_number(value: object, fallback: float, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return max(minimum, min(maximum, fallback))
    # Avoid overflowing float() on arbitrary-size Python ints supplied by JSON.
    try:
        number = float(value)
    except OverflowError:
        return max(minimum, min(maximum, fallback))
    return max(minimum, min(maximum, number if isfinite(number) else fallback))


def ensure_figure_editor(figure: Figure, width: float, height: float, shot: str = "medium") -> dict:
    """Sanitize optional extension fields without changing the source model."""
    width = _safe_number(width, 300, 1, 100000)
    height = _safe_number(height, 400, 1, 100000)
    framings = {
        "extreme_long": "full",
        "long": "full",
        "full": "full",
        "medium": "waist",
        "close_up": "bust",
        "extreme_close_up": "face",
    }
    framing = figure.framing or framings.get(shot, "waist")
    visible = {"full": 1, "waist": 0.59, "bust": 0.43, "face": 0.23}.get(framing, 1)
    size = min(height * 0.84 / visible, width * 2.8)
    position = (
        {"left": 0.23, "center": 0.5, "right": 0.77}.get(figure.position, 0.5)
        if isinstance(figure.position, str)
        else _safe_number(figure.position, 0.5, -10, 10)
    )
    raw = figure.extra.get("editor")
    raw = raw if isinstance(raw, Mapping) else {}
    pose = POSE_PRESETS.get(figure.pose, STAND)
    joints = {name: list(pose[name]) for name in JOINT_NAMES}
    joint_data = raw.get("joints")
    if isinstance(joint_data, Mapping):
        for name in JOINT_NAMES:
            point = joint_data.get(name)
            if isinstance(point, (tuple, list)) and len(point) == 2:
                joints[name] = [
                    _safe_number(point[0], joints[name][0], -300, 300),
                    _safe_number(point[1], joints[name][1], -300, 300),
                ]
    style = raw.get("style")
    return {
        "version": 1,
        "x": _safe_number(raw.get("x"), width * position, -100000, 100000),
        "y": _safe_number(raw.get("y"), height * 0.16 + size, -100000, 100000),
        "size": _safe_number(raw.get("size"), size, 8, 20000),
        "flip": raw.get("flip") if isinstance(raw.get("flip"), bool) else figure.facing == "left",
        "view": "side" if raw.get("view") == "side" else "front",
        "style": style if isinstance(style, str) and style in {"stick", "box", "rough"} else "box",
        "break_frame": raw.get("break_frame") if isinstance(raw.get("break_frame"), bool) else False,
        "joints": joints,
    }


def rig_primitives(editor: dict, origin: tuple[float, float] = (0, 0), scale: float = 1) -> list[dict]:
    result = []
    unit = editor["size"] / 100
    stroke = max(2, floor(editor["size"] * 0.012 + 0.5))
    thin = max(1, floor(stroke / 2))

    def at(point: tuple | list) -> list[float]:
        return [
            origin[0] + (editor["x"] + point[0] * unit * (-1 if editor["flip"] else 1)) * scale,
            origin[1] + (editor["y"] + point[1] * unit) * scale,
        ]

    def line(points: list | tuple, width: int = stroke) -> None:
        result.append(
            {
                "type": "line",
                "points": [at(point) for point in points],
                "width": max(1, floor(width * scale + 0.5)),
            }
        )

    joints = editor["joints"]
    head, neck, hip = (joints[name] for name in ("head", "neck", "hip"))
    length = hypot(hip[0] - neck[0], hip[1] - neck[1]) or 1
    across = ((hip[1] - neck[1]) / length, -(hip[0] - neck[0]) / length)

    def offset(point: tuple | list, amount: float) -> tuple[float, float]:
        return point[0] + across[0] * amount, point[1] + across[1] * amount

    side = editor.get("view") == "side"
    shoulder_half, hip_half = (3.2, 2.8) if side else (8.5, 7)
    left_shoulder, right_shoulder = offset(neck, -shoulder_half), offset(neck, shoulder_half)
    left_hip, right_hip = offset(hip, -hip_half), offset(hip, hip_half)
    hx, hy = at(head)
    result.append(
        {
            "type": "circle",
            "cx": hx,
            "cy": hy,
            "r": 8.5 * unit * scale,
            "width": max(1, floor(stroke * scale + 0.5)),
            "fill": None,
        }
    )
    delta = neck[0] - head[0], neck[1] - head[1]
    distance = hypot(*delta) or 1
    line([(head[0] + delta[0] / distance * 8.5, head[1] + delta[1] / distance * 8.5), neck])
    if editor["style"] == "stick":
        line([neck, hip])
        line([left_shoulder, right_shoulder])
    else:
        result.append(
            {
                "type": "polygon",
                "points": [at(point) for point in (left_shoulder, right_shoulder, right_hip, left_hip)],
                "fill": None,
                "width": max(1, floor(stroke * scale + 0.5)),
            }
        )
    if side:
        line([left_shoulder, joints["lElbow"], joints["lHand"]], thin)
        line([left_hip, joints["lKnee"], joints["lFoot"]], thin)
        line([right_shoulder, joints["rElbow"], joints["rHand"]])
        line([right_hip, joints["rKnee"], joints["rFoot"]])
        axis = ((hip[0] - neck[0]) / length, (hip[1] - neck[1]) / length)

        def side_point(along: float, cross: float) -> tuple[float, float]:
            return (
                head[0] + axis[0] * along + across[0] * cross,
                head[1] + axis[1] * along + across[1] * cross,
            )

        line([side_point(-3, 7.8), side_point(0, 10.5), side_point(2, 7.8)], thin)
        line([side_point(-4, 4), side_point(-1, 4)], thin)
    else:
        line([left_shoulder, joints["lElbow"], joints["lHand"]])
        line([right_shoulder, joints["rElbow"], joints["rHand"]])
        line([left_hip, joints["lKnee"], joints["lFoot"]])
        line([right_hip, joints["rKnee"], joints["rFoot"]])
    if editor["style"] == "rough":
        if not side:
            line([(head[0] - 7.5, head[1]), (head[0] + 7.5, head[1])], thin)
            line([(head[0], head[1] - 7.5), (head[0], head[1] + 7.5)], thin)
        for name in ("lElbow", "rElbow", "lKnee", "rKnee"):
            cx, cy = at(joints[name])
            result.append(
                {
                    "type": "circle",
                    "cx": cx,
                    "cy": cy,
                    "r": 1.7 * unit * scale,
                    "width": max(1, floor(thin * scale + 0.5)),
                    "fill": None,
                }
            )
    return result


def rig_bounds(primitives: list[dict]) -> tuple[float, float, float, float]:
    points = []
    for item in primitives:
        pad = item.get("width", 0) / 2
        if item["type"] == "circle":
            radius = item["r"] + pad
            points.extend(
                ((item["cx"] - radius, item["cy"] - radius), (item["cx"] + radius, item["cy"] + radius))
            )
        else:
            for x, y in item["points"]:
                points.extend(((x - pad, y - pad), (x + pad, y + pad)))
    return (
        min(p[0] for p in points),
        min(p[1] for p in points),
        max(p[0] for p in points),
        max(p[1] for p in points),
    )


def editor_figure_geometry(  # noqa: PLR0913 -- same drawing context as figure_geometry.
    size: tuple[int, int],
    figure: Figure,
    label: str,
    *,
    shot: str,
    color: str,
    origin: tuple[float, float] = (0, 0),
    scale: float = 1,
) -> dict:
    scale = _safe_number(scale, 1, 0.001, 1000)
    editor = ensure_figure_editor(figure, size[0] / scale, size[1] / scale, shot)
    primitives = rig_primitives(editor, origin, scale)
    bounds = rig_bounds(primitives)
    return {
        "character_id": figure.character_id,
        "figure_id": figure.extra.get("id"),
        "label": label,
        "color": color,
        "primitives": primitives,
        "break_frame": editor["break_frame"],
        "label_at": [origin[0] + editor["x"] * scale, bounds[1] - 24 * scale],
    }
