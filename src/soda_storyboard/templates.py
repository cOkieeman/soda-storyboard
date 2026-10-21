"""Python port of manga-blueprint-studio/layout-recipes.mjs (zero mutation).

Copyright (c) 2026 c-a-p-engineer, MIT; full license in NOTICE.
Metadata is preserved in recipes.json. See layout-solver.mjs for affinity ranking
and layout-modifiers.mjs for the optional expressive geometry reference.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from importlib.resources import files
from math import hypot, isfinite
from pathlib import Path
from typing import Any

from .geometry import (
    bbox_xywh,
    convex_polygon,
    polygon_area,
    polygons_overlap,
    shape_bbox,
    shape_distance,
    shape_polygon,
    skew_rectangles,
)

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


def _skew_slots(
    slots: list[dict[str, Any]], angle: float, gap: int, axis: str = "auto"
) -> list[dict[str, Any]]:
    if any(slot.get("type", "rect") != "rect" for slot in slots):
        raise ValueError("斜切变换的输入必须为矩形")
    for direction, keys in (("vertical", ("y", "h")), ("horizontal", ("x", "w"))):
        if axis not in {"auto", direction}:
            continue
        groups: dict[tuple[float, ...], list[int]] = {}
        for index, slot in enumerate(slots):
            groups.setdefault(tuple(round(slot[key], 7) for key in keys), []).append(index)
        adjacent = [indices for indices in groups.values() if len(indices) > 1]
        if not adjacent:
            continue
        result = [dict(slot) for slot in slots]
        for indices in adjacent:
            quads = skew_rectangles([slots[i] for i in indices], angle=angle, gap=gap, axis=direction)
            for index, quad in zip(indices, quads, strict=True):
                result[index] = quad
        return result
    raise ValueError("没有可斜切的相邻矩形组")


def _variants(recipes: list[dict[str, Any]], skew: float | None) -> list[dict[str, Any]]:
    result = []
    for recipe in recipes:
        base = {key: value for key, value in recipe.items() if key != "skew"}
        if skew is None or skew == 0:
            result.append(base)
        if skew == 0:
            continue
        option = recipe.get("skew", {"angle": 8, "axis": "auto"})
        option = dict(option) if isinstance(option, Mapping) else {"angle": option, "axis": "auto"}
        option.setdefault("angle", 8)
        option["angle"] = skew if skew is not None else option["angle"]
        if option["angle"] == 0:
            continue
        result.append({**base, "id": f"{recipe['id']}-skew", "source_id": recipe["id"], "skew": option})
    return result


def builtin_templates(panel_count: int | None = None, *, skew: float | None = None) -> list[dict[str, Any]]:
    """Return recipe metadata and normalized RTL geometry for each supported count."""
    result = []
    counts = [panel_count] if panel_count is not None else range(3, 8)
    for count in counts:
        for recipe in _variants(RECIPES, skew):
            if count not in recipe["supported_panel_counts"]:
                continue
            panels = _build(recipe.get("source_id", recipe["id"]), 1024, 1536, count, 24)
            try:
                if "skew" in recipe:
                    panels = _skew_slots(
                        panels, recipe["skew"]["angle"], 24, recipe["skew"].get("axis", "auto")
                    )
            except ValueError:
                continue
            normalized = []
            for order, panel in enumerate(panels, 1):
                if panel["type"] == "quad":
                    shape = {"type": "quad", "points": [[x / 1024, y / 1536] for x, y in panel["points"]]}
                else:
                    shape = _rect(panel["x"] / 1024, panel["y"] / 1536, panel["w"] / 1024, panel["h"] / 1536)
                normalized.append({**shape, "order": order})
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
    # Two-decimal skew vertices can shorten a true edge distance by <0.02 px.
    tolerance = 0.02
    for index, slot in enumerate(slots):
        convex_polygon(slot)
        x, y, w, h = bbox_xywh(slot)
        if not (x >= -tolerance and y >= -tolerance and w > 0 and h > 0):
            raise ValueError("版式包含无效格子")
        if x + w > width + tolerance or y + h > height + tolerance:
            raise ValueError("版式超出画布")
        for other in slots[index + 1 :]:
            if polygons_overlap(slot, other) or shape_distance(slot, other) < gap - tolerance:
                raise ValueError("版式重叠或格间距不足")


def _inset_quad(shape: dict[str, Any], distance: float) -> dict[str, Any]:
    points = convex_polygon(shape)
    edges = []
    for a, b in zip(points, [*points[1:], points[0]], strict=True):
        nx, ny = a[1] - b[1], b[0] - a[0]
        edges.append((nx, ny, nx * a[0] + ny * a[1] + distance * hypot(nx, ny)))
    inset = []
    for index, (a, b, c) in enumerate(edges):
        d, e, f = edges[index - 1]
        denominator = a * e - b * d
        inset.append([(c * e - b * f) / denominator, (a * f - c * d) / denominator])
    return {"type": "quad", "points": inset}


def _custom_slots(
    panels: list[dict[str, Any]], width: int, height: int, gap: int, *, inset_quads: bool = False
) -> list[dict[str, Any]]:
    slots = []
    for panel in panels:
        if panel.get("type", "rect") == "quad":
            shape = {
                "type": "quad",
                "points": [[float(x) * width, float(y) * height] for x, y in panel["points"]],
            }
            slots.append(_inset_quad(shape, gap / 2) if inset_quads else shape)
        else:
            slots.append(
                _rect(
                    float(panel["x"]) * width + gap / 2,
                    float(panel["y"]) * height + gap / 2,
                    float(panel["w"]) * width - gap,
                    float(panel["h"]) * height - gap,
                )
            )
    if all("order" in panel for panel in panels):
        return [slots[i] for i in sorted(range(len(panels)), key=lambda i: panels[i]["order"])]
    return sorted(slots, key=lambda p: (shape_bbox(p)[1], -shape_bbox(p)[0]))


def suggest_layouts(
    panel_count: int,
    *,
    width: int = 1024,
    height: int = 1536,
    importance: Iterable[int] | None = None,
    user_templates: str | Path | None = None,
    candidates: int = 6,
    gap: int = 24,
    reading_direction: str = "rtl",
    pick: str | None = None,
    skew: float | None = None,
) -> list[dict[str, Any]]:
    if panel_count < 1 or width <= 0 or height <= 0 or gap < 0:
        raise ValueError("格数和画布尺寸必须大于 0，间距不能小于 0")
    if reading_direction not in {"rtl", "ltr"}:
        raise ValueError("reading_direction 必须是 rtl 或 ltr")
    if skew is not None and (not isfinite(skew) or abs(skew) >= 45):
        raise ValueError("斜切角度必须在 -45 到 45 度之间")
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
    templates = _variants(templates, skew)
    if pick and skew not in {None, 0} and not pick.endswith("-skew"):
        pick += "-skew"
    if pick:
        templates = [recipe for recipe in templates if recipe.get("id") == pick]
        if not templates:
            raise ValueError(f"找不到适用于 {panel_count} 格的模板：{pick}")
    values = list(importance or [1] * panel_count)
    values = (values + [1] * panel_count)[:panel_count]
    result = []
    for recipe in templates:
        if "panels" in recipe:
            slots = _custom_slots(
                recipe["panels"], width, height, gap, inset_quads=recipe.get("source") == "reference"
            )
        else:
            slots = _build(recipe.get("source_id", recipe["id"]), width, height, panel_count, gap)
        if len(slots) != panel_count:
            raise ValueError("模板格数与请求格数不一致")
        try:
            if "skew" in recipe:
                slots = _skew_slots(slots, recipe["skew"]["angle"], gap, recipe["skew"].get("axis", "auto"))
        except ValueError:
            if pick:
                raise
            continue
        if reading_direction != recipe.get("reading_direction", "rtl"):
            slots = [_mirror(p, width) for p in slots]
        _check_slots(slots, width, height, gap)
        panels = [{**slot, "order": i} for i, slot in enumerate(slots, 1)]
        score = sum(
            abs(polygon_area(shape_polygon(p))) * value for p, value in zip(panels, values, strict=True)
        )
        result.append(
            {
                **{key: val for key, val in recipe.items() if key != "panels"},
                "template_id": recipe["id"],
                "family": recipe.get("family") or "custom",
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
    if not result:
        raise ValueError("当前尺寸和角度下没有可用版式，请减小角度或间距")
    if len(set(values)) > 1:
        result.sort(key=lambda item: -item["score"])
    if pick:
        return result[:1]
    return _diverse(result, candidates, values)


def _mirror(shape: dict[str, Any], width: int) -> dict[str, Any]:
    if shape["type"] == "quad":
        return {"type": "quad", "points": [[round(width - x, 2), y] for x, y in reversed(shape["points"])]}
    return {**shape, "x": width - shape["x"] - shape["w"]}


def _diverse(results: list[dict[str, Any]], count: int, importance: list[int]) -> list[dict[str, Any]]:
    chosen: dict[str, dict[str, Any]] = {}
    for result in results:
        family = result.get("family", result["template_id"])
        if family not in chosen:
            chosen[family] = result
    for family, winner in list(chosen.items()):
        if family in {"entry", "action", "payoff"}:
            variant = next((r for r in results if r.get("source_id") == winner["template_id"]), None)
            if variant is not None:
                chosen[family] = variant
    families = ["standard", "entry", "conversation", "action", "cinematic", "payoff", "quiet", "transition"]
    ordered = list(chosen.values())
    if len(set(importance)) == 1:
        ordered.sort(
            key=lambda item: (
                families.index(item["family"]) if item.get("family") in families else len(families)
            )
        )
    else:
        ordered.sort(key=lambda item: -item["score"])
    # User reference layouts remain discoverable among the default six candidates.
    ordered.sort(key=lambda item: item.get("source") != "reference")
    return ordered[: max(1, count)]


__all__ = ["builtin_templates", "load_user_templates", "suggest_layouts"]
