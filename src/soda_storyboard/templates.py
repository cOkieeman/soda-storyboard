"""Built-in panel layout recipes and a small deterministic layout solver."""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any


def _rect(x: float, y: float, w: float, h: float) -> dict[str, Any]:
    return {"type": "rect", "x": round(x, 6), "y": round(y, 6), "w": round(w, 6), "h": round(h, 6)}


def _grid(count: int, columns: int) -> list[dict[str, Any]]:
    rows = (count + columns - 1) // columns
    cells: list[dict[str, Any]] = []
    for index in range(count):
        row, column = divmod(index, columns)
        row_count = min(columns, count - row * columns)
        cells.append(_rect(column / row_count, row / rows, 1 / row_count, 1 / rows))
    return cells


def _hero_top(count: int) -> list[dict[str, Any]]:
    if count == 1:
        return [_rect(0, 0, 1, 1)]
    bottom = _grid(count - 1, min(3, count - 1))
    result = [_rect(0, 0, 1, 0.52)]
    for item in bottom:
        result.append(_rect(item["x"], 0.54 + item["y"] * 0.46, item["w"], item["h"] * 0.46))
    return result


def _hero_side(count: int) -> list[dict[str, Any]]:
    if count == 1:
        return [_rect(0, 0, 1, 1)]
    side = _grid(count - 1, 1)
    result = [_rect(0, 0, 0.54, 1)]
    for item in side:
        result.append(_rect(0.56, item["y"], 0.44, item["h"]))
    return result


def _strip(count: int) -> list[dict[str, Any]]:
    return [_rect(index / count, 0.08, 0.94 / count, 0.84) for index in range(count)]


def builtin_templates(panel_count: int | None = None) -> list[dict[str, Any]]:
    """Return built-in recipes, with at least three candidates for 3–7 panels."""

    counts = [panel_count] if panel_count is not None else list(range(3, 8))
    result: list[dict[str, Any]] = []
    for count in counts:
        if count < 1:
            continue
        result.extend(
            [
                {
                    "id": f"hero-top-{count}",
                    "name": "大格开场",
                    "panel_count": count,
                    "panels": _hero_top(count),
                },
                {
                    "id": f"hero-side-{count}",
                    "name": "一大多小",
                    "panel_count": count,
                    "panels": _hero_side(count),
                },
                {"id": f"strip-{count}", "name": "横长条分段", "panel_count": count, "panels": _strip(count)},
            ]
        )
    return result


def load_user_templates(directory: str | Path | None) -> list[dict[str, Any]]:
    if directory is None:
        return []
    root = Path(directory)
    if not root.exists():
        return []
    result: list[dict[str, Any]] = []
    for path in sorted(root.glob("*.json")):
        with path.open(encoding="utf-8") as handle:
            value = json.load(handle)
        if isinstance(value, list):
            result.extend(item for item in value if isinstance(item, Mapping))
        elif isinstance(value, Mapping) and isinstance(value.get("templates"), list):
            result.extend(item for item in value["templates"] if isinstance(item, Mapping))
        elif isinstance(value, Mapping):
            result.append(dict(value))
    return result


def _scaled_panel(normalized: Mapping[str, Any], width: int, height: int, gap: int) -> dict[str, Any]:
    x = float(normalized.get("x", 0)) * width
    y = float(normalized.get("y", 0)) * height
    w = float(normalized.get("w", 0)) * width
    h = float(normalized.get("h", 0)) * height
    half_gap = gap / 2
    return _rect(x + half_gap, y + half_gap, max(1.0, w - gap), max(1.0, h - gap))


def suggest_layouts(
    panel_count: int,
    *,
    width: int = 1024,
    height: int = 1536,
    importance: Iterable[int] | None = None,
    user_templates: str | Path | None = None,
    candidates: int = 3,
    gap: int = 24,
) -> list[dict[str, Any]]:
    if panel_count < 1:
        raise ValueError("panel_count 必须大于 0")
    templates = builtin_templates(panel_count) + [
        item
        for item in load_user_templates(user_templates)
        if int(item.get("panel_count", len(item.get("panels", [])))) == panel_count
    ]
    if not templates:
        templates = [{"id": f"grid-{panel_count}", "name": "网格", "panels": _grid(panel_count, 2)}]
    importance_values = list(importance or [1] * panel_count)
    importance_values = (importance_values + [1] * panel_count)[:panel_count]
    order_by_importance = sorted(range(panel_count), key=lambda index: (-importance_values[index], index))
    result: list[dict[str, Any]] = []
    for template in templates[: max(candidates, 1)]:
        normalized = list(template.get("panels", []))
        if len(normalized) != panel_count:
            continue
        slots = [_scaled_panel(item, width, height, gap) for item in normalized]
        # Assign the biggest slots to the most important panels while keeping
        # the returned list in storyboard order.
        slot_order = sorted(range(panel_count), key=lambda index: -(slots[index]["w"] * slots[index]["h"]))
        assigned: list[dict[str, Any] | None] = [None] * panel_count
        for panel_index, slot_index in zip(order_by_importance, slot_order, strict=True):
            assigned[panel_index] = slots[slot_index]
        result.append(
            {
                "template_id": template.get("id", "custom"),
                "name": template.get("name", template.get("id", "custom")),
                "panel_count": panel_count,
                "panels": assigned,
            }
        )
        if len(result) >= candidates:
            break
    return result


__all__ = ["builtin_templates", "load_user_templates", "suggest_layouts"]
