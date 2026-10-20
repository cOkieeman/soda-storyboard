"""Python port of manga-blueprint-studio/layout-recipes.mjs (zero mutation).

Copyright (c) 2026 c-a-p-engineer, MIT; full license in NOTICE.
Metadata is preserved in recipes.json. See layout-solver.mjs for affinity ranking
and layout-modifiers.mjs for the optional expressive geometry reference.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from importlib.resources import files
from pathlib import Path
from typing import Any

RECIPES = json.loads(files("soda_storyboard").joinpath("recipes.json").read_text(encoding="utf-8"))


def _rect(x: float, y: float, w: float, h: float) -> dict[str, Any]:
    return {"type": "rect", "x": x, "y": y, "w": w, "h": h}


def _balanced_rows(count: int) -> list[int]:
    if count <= 2:
        return [count]
    return [2] * (count // 2) + ([1] if count % 2 else [])


def _distribute(total: float, gap: float, weights: list[float]) -> list[float]:
    usable = total - gap * (len(weights) - 1)
    if usable <= 0:
        raise ValueError("画布太小，无法容纳格间距")
    return [usable * weight / sum(weights) for weight in weights]


def _rows(
    width: int,
    height: int,
    counts: list[int],
    gap: int,
    weights: list[float] | None = None,
    biases: list[float] | None = None,
) -> list[dict[str, Any]]:
    margin = round(min(58, max(20, min(width, height) * 0.045)))
    inner_width, inner_height = width - 2 * margin, height - 2 * margin
    heights = _distribute(inner_height, gap, weights or [1] * len(counts))
    result = []
    y = float(margin)
    for index, (count, row_height) in enumerate(zip(counts, heights, strict=True)):
        bias = biases[index] if biases else 0.5
        ratios = [bias, 1 - bias] if count == 2 else [1] * count
        widths = _distribute(inner_width, gap, ratios)
        cursor = width - margin
        for cell_width in widths:
            cursor -= cell_width
            result.append(_rect(cursor, y, cell_width, row_height))
            cursor -= gap
        y += row_height + gap
    return result


def _build(recipe_id: str, width: int, height: int, count: int, gap: int) -> list[dict[str, Any]]:
    rows = _balanced_rows(count)
    weights = None
    biases = None
    if recipe_id in {"vertical-rhythm", "cinematic-stack"}:
        rows = [1] * count
        if recipe_id == "cinematic-stack":
            weights = [1.45 if i == count // 2 else (0.85 if i % 2 else 1.05) for i in range(count)]
    elif recipe_id == "horizontal-rhythm":
        rows = [count]
    elif recipe_id in {"hero-bottom", "detail-payoff", "quiet-build", "action-step"}:
        rows = [*_balanced_rows(count - 1), 1]
        hero_weight = 1.35 if recipe_id == "quiet-build" else 1.9
        weights = [1] * (len(rows) - 1) + [hero_weight]
        if recipe_id == "action-step":
            weights = [0.75 + i * (1.05 / max(1, len(rows) - 1)) for i in range(len(rows))]
            biases = [0.4 if i % 2 else 0.6 for i in range(len(rows))]
    elif recipe_id == "hero-top":
        rows = [1, *_balanced_rows(count - 1)]
        weights = [1.75] + [1] * (len(rows) - 1)
    elif recipe_id == "hero-right":
        margin = round(min(58, max(20, min(width, height) * 0.045)))
        inner_width, inner_height = width - 2 * margin, height - 2 * margin
        hero_width, side_width = _distribute(inner_width, gap, [0.55, 0.45])
        hero = _rect(margin + side_width + gap, margin, hero_width, inner_height)
        heights = _distribute(inner_height, gap, [1] * (count - 1))
        result = [hero]
        y = float(margin)
        for cell_height in heights:
            result.append(_rect(margin, y, side_width, cell_height))
            y += cell_height + gap
        return result
    elif recipe_id in {"dialogue-stagger", "ladder"}:
        ratio = 0.6 if recipe_id == "dialogue-stagger" else 0.66
        biases = [1 - ratio if i % 2 else ratio for i in range(len(rows))]
        if recipe_id == "dialogue-stagger":
            weights = [1.05] + [1] * (len(rows) - 1)
    elif recipe_id == "wide-middle":
        if count == 3:
            rows, weights = [1, 1, 1], [0.8, 1.45, 0.8]
        else:
            top = count // 2
            rows, weights = [top, 1, count - top - 1], [1, 1.45, 1]
    elif recipe_id == "three-band":
        first = (count + 2) // 3
        second = (count - first + 1) // 2
        rows = [first, second, count - first - second]
        weights = [0.9, 1.2, 0.9] if count == 3 else [0.9, 1.15, 1]
    return _rows(width, height, rows, gap, weights, biases)


def builtin_templates(panel_count: int | None = None) -> list[dict[str, Any]]:
    """Return recipe metadata and normalized RTL geometry for each supported count."""
    result = []
    counts = [panel_count] if panel_count is not None else range(3, 8)
    for count in counts:
        for recipe in RECIPES:
            if count not in recipe["supported_panel_counts"]:
                continue
            panels = _build(recipe["id"], 1024, 1536, count, 24)
            normalized = [
                {**_rect(p["x"] / 1024, p["y"] / 1536, p["w"] / 1024, p["h"] / 1536), "order": i}
                for i, p in enumerate(panels, 1)
            ]
            result.append({**recipe, "name": recipe["zh"], "panel_count": count, "panels": normalized})
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
            result.extend(dict(item) for item in value if isinstance(item, Mapping))
        elif isinstance(value, Mapping) and isinstance(value.get("templates"), list):
            result.extend(dict(item) for item in value["templates"] if isinstance(item, Mapping))
        elif isinstance(value, Mapping):
            result.append(dict(value))
    return result


def _check_slots(slots: list[dict[str, Any]], width: int, height: int, gap: int) -> None:
    tolerance = 1e-7
    for index, slot in enumerate(slots):
        x, y, w, h = (slot[key] for key in ("x", "y", "w", "h"))
        if not (x >= -tolerance and y >= -tolerance and w > 0 and h > 0):
            raise ValueError("版式包含无效格子")
        if x + w > width + tolerance or y + h > height + tolerance:
            raise ValueError("版式超出画布")
        for other in slots[index + 1 :]:
            dx = max(x - other["x"] - other["w"], other["x"] - x - w)
            dy = max(y - other["y"] - other["h"], other["y"] - y - h)
            if max(dx, dy) < gap - tolerance or (dx < -tolerance and dy < -tolerance):
                raise ValueError("版式重叠或格间距不足")


def suggest_layouts(
    panel_count: int,
    *,
    width: int = 1024,
    height: int = 1536,
    importance: Iterable[int] | None = None,
    user_templates: str | Path | None = None,
    candidates: int = 4,
    gap: int = 24,
    reading_direction: str = "rtl",
    pick: str | None = None,
) -> list[dict[str, Any]]:
    if panel_count < 1 or width <= 0 or height <= 0 or gap < 0:
        raise ValueError("格数和画布尺寸必须大于 0，间距不能小于 0")
    if reading_direction not in {"rtl", "ltr"}:
        raise ValueError("reading_direction 必须是 rtl 或 ltr")
    templates = [recipe for recipe in RECIPES if panel_count in recipe["supported_panel_counts"]]
    custom = [
        item
        for item in load_user_templates(user_templates)
        if int(item.get("panel_count", len(item.get("panels", [])))) == panel_count
    ]
    templates = templates + custom
    if not templates:
        templates = [{"id": "balanced-grid", "zh": "均衡网格"}]
    aliases = {
        f"hero-top-{panel_count}": "hero-top",
        f"hero-side-{panel_count}": "hero-right",
        f"strip-{panel_count}": "vertical-rhythm",
    }
    pick = aliases.get(pick, pick)
    if pick:
        templates = [recipe for recipe in templates if recipe.get("id") == pick]
        if not templates:
            raise ValueError(f"找不到适用于 {panel_count} 格的模板：{pick}")
    values = list(importance or [1] * panel_count)
    values = (values + [1] * panel_count)[:panel_count]
    result = []
    for recipe in templates:
        if "panels" in recipe:
            slots = [
                _rect(
                    float(p["x"]) * width + gap / 2,
                    float(p["y"]) * height + gap / 2,
                    float(p["w"]) * width - gap,
                    float(p["h"]) * height - gap,
                )
                for p in recipe["panels"]
            ]
            slots.sort(key=lambda p: (p["y"], -p["x"]))
        else:
            slots = _build(recipe["id"], width, height, panel_count, gap)
        if len(slots) != panel_count:
            raise ValueError("模板格数与请求格数不一致")
        if reading_direction == "ltr":
            slots = [{**p, "x": width - p["x"] - p["w"]} for p in slots]
        _check_slots(slots, width, height, gap)
        panels = [{**slot, "order": i} for i, slot in enumerate(slots, 1)]
        score = sum(p["w"] * p["h"] * value for p, value in zip(panels, values, strict=True))
        result.append(
            {
                **{key: val for key, val in recipe.items() if key != "panels"},
                "template_id": recipe["id"],
                "name": recipe.get("zh", recipe.get("name", recipe["id"])),
                "name_zh": recipe.get("zh", recipe.get("name", "")),
                "name_ja": recipe.get("ja", ""),
                "description": recipe.get("helpZh", recipe.get("description", "")),
                "tags": recipe.get("tags", []),
                "hero_position": recipe.get("heroPosition"),
                "panel_count": panel_count,
                "panels": panels,
                "score": score,
            }
        )
    if len(set(values)) > 1:
        result.sort(key=lambda item: -item["score"])
    return result[: max(candidates, 1)]


__all__ = ["builtin_templates", "load_user_templates", "suggest_layouts"]
