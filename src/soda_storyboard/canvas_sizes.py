"""Public MOSS canvas inference contract shared with node integrations.

Snap by aspect ratio only, preserving table order on ties. Source boxes may
extend beyond the inferred canvas; imports clip display geometry, not raw data.
"""

from __future__ import annotations

import math

CANVAS_PRESETS = ((1024, 1536), (1536, 1024), (1024, 1024), (768, 1344), (1344, 768))


def infer_dimensions(value: dict) -> tuple[int, int]:
    """Match the node's MOSS inference, with additional core coordinate aliases."""
    space = value.get("bbox_coord_space", "abs_centralized")
    fmt = value.get("bbox_format", "yxyx")
    if space in {"normalized", "0-1", "relative", "normalized_1000", "0-1000"}:
        return CANVAS_PRESETS[0]
    bounds = []
    for item in value.get("items", []):
        box = item.get("bbox") if isinstance(item, dict) else None
        if not isinstance(box, list) or len(box) != 4:  # noqa: PLR2004 -- bbox contract
            continue
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in box):
            continue
        a, b, c, d = box
        bounds.append(
            (b, a, d, c) if fmt == "yxyx" else (a, b, a + c, b + d) if fmt == "xywh" else (a, b, c, d)
        )
    if not bounds:
        return CANVAS_PRESETS[0]
    if space in {"abs_centralized", "centered"}:
        width = 2 * max(abs(edge) for box in bounds for edge in (box[0], box[2]))
        height = 2 * max(abs(edge) for box in bounds for edge in (box[1], box[3]))
    else:
        width = max(box[2] for box in bounds)
        height = max(box[3] for box in bounds)
    if width <= 0 or height <= 0:
        return CANVAS_PRESETS[0]
    ratio = width / height
    return min(CANVAS_PRESETS, key=lambda size: abs(math.log((size[0] / size[1]) / ratio)))


__all__ = ["CANVAS_PRESETS", "infer_dimensions"]
