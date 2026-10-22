"""Validation rules for a soda-storyboard page.

The validator deliberately accepts both the public dataclasses and plain JSON
dictionaries.  Keeping the boundary duck typed makes it useful to the CLI,
editor, and callers which load a page without constructing a model first.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass
from dataclasses import field as dc_field
from math import isfinite
from typing import Any

from .captions import caption_notices
from .figure_semantics import figure_page_box
from .figures import panel_figures
from .geometry import convex_polygon, polygons_overlap, shape_distance
from .lettering import layout_texts
from .models import Character, Page


def _get(value: Any, key: str, default: Any = None) -> Any:
    """Read a field from a mapping, dataclass/model, or object."""

    if isinstance(value, Mapping):
        return value.get(key, default)
    return getattr(value, key, default)


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    try:
        return asdict(value)
    except (TypeError, ValueError):
        return {
            name: getattr(value, name)
            for name in dir(value)
            if not name.startswith("_") and not callable(getattr(value, name, None))
        }


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def canvas_size(page: Any) -> tuple[float, float]:
    """Return ``(width, height)`` from a Page-like object."""

    width = _get(page, "canvas_width")
    height = _get(page, "canvas_height")
    canvas = _get(page, "canvas")
    if canvas is not None:
        width = width or _get(canvas, "width")
        height = height or _get(canvas, "height")
    size = _get(page, "canvas_size")
    if size and (width is None or height is None):
        if isinstance(size, Mapping):
            width = width or size.get("width")
            height = height or size.get("height")
        elif isinstance(size, (list, tuple)) and len(size) >= 2:
            width = width or size[0]
            height = height or size[1]
    return _number(width), _number(height)


def _points(value: Any) -> list[tuple[float, float]]:
    if value is None:
        return []
    if isinstance(value, Mapping):
        value = value.get("points") or value.get("corners") or value.get("vertices")
    result: list[tuple[float, float]] = []
    if isinstance(value, Iterable) and not isinstance(value, (str, bytes, Mapping)):
        for point in value:
            if isinstance(point, Mapping):
                x = point.get("x", point.get("X"))
                y = point.get("y", point.get("Y"))
            elif isinstance(point, (list, tuple)) and len(point) >= 2:
                x, y = point[:2]
            else:
                x, y = _get(point, "x"), _get(point, "y")
            if x is not None and y is not None:
                result.append((_number(x), _number(y)))
    return result


def panel_bbox(panel: Any) -> tuple[float, float, float, float]:
    """Return a panel bounding box as ``(x, y, width, height)``."""

    method = getattr(panel, "bounding_box", None)
    if callable(method):
        try:
            box = method()
            parsed = _coerce_box(box)
            if parsed is not None:
                return parsed
        except (TypeError, ValueError):
            pass

    shape = _get(panel, "shape", panel)
    if shape is None:
        return 0.0, 0.0, 0.0, 0.0
    # A Rect/shape object can expose x/y/w/h directly.
    x = _get(shape, "x")
    y = _get(shape, "y")
    w = _get(shape, "w", _get(shape, "width"))
    h = _get(shape, "h", _get(shape, "height"))
    if x is not None and y is not None and w is not None and h is not None:
        return _number(x), _number(y), _number(w), _number(h)

    # Some JSON representations put a rectangle under ``rect``.
    rect = _get(shape, "rect")
    if rect is not None and rect is not shape:
        return panel_bbox(rect)

    # Quad/polygon representations use points/corners/vertices.  The quad's
    # enclosing rectangle is what MOSS accepts for a panel item.
    pts = _points(shape)
    if len(pts) < 2:
        pts = _points(_get(panel, "points"))
    if pts:
        xs = [point[0] for point in pts]
        ys = [point[1] for point in pts]
        xmin, xmax = min(xs), max(xs)
        ymin, ymax = min(ys), max(ys)
        return xmin, ymin, xmax - xmin, ymax - ymin

    # A few early drafts used x1/y1/x2/y2 for a rectangle.
    x1, y1 = _get(shape, "x1"), _get(shape, "y1")
    x2, y2 = _get(shape, "x2"), _get(shape, "y2")
    if None not in (x1, y1, x2, y2):
        xmin, xmax = sorted((_number(x1), _number(x2)))
        ymin, ymax = sorted((_number(y1), _number(y2)))
        return xmin, ymin, xmax - xmin, ymax - ymin
    return 0.0, 0.0, 0.0, 0.0


def _coerce_box(box: Any) -> tuple[float, float, float, float] | None:
    if isinstance(box, Mapping):
        x = box.get("x", box.get("x_min", box.get("xmin")))
        y = box.get("y", box.get("y_min", box.get("ymin")))
        w = box.get("w", box.get("width"))
        h = box.get("h", box.get("height"))
        if None not in (x, y, w, h):
            return _number(x), _number(y), _number(w), _number(h)
        x2 = box.get("x_max", box.get("xmax"))
        y2 = box.get("y_max", box.get("ymax"))
        if None not in (x, y, x2, y2):
            return _number(x), _number(y), _number(x2) - _number(x), _number(y2) - _number(y)
    if isinstance(box, (list, tuple)) and len(box) >= 4:
        return tuple(_number(item) for item in box[:4])  # type: ignore[return-value]
    return None


def _panels(page: Any) -> list[Any]:
    value = _get(page, "panels", [])
    if value is None:
        return []
    return list(value)


def _panel_id(panel: Any, index: int) -> str:
    return str(_get(panel, "id", _get(panel, "panel_id", index + 1)))


def _character_map(characters: Any) -> dict[str, Any]:
    if characters is None:
        return {}
    if isinstance(characters, Mapping):
        return {str(key): value for key, value in characters.items()}
    result: dict[str, Any] = {}
    for character in characters:
        identifier = _get(character, "id")
        if identifier is not None:
            result[str(identifier)] = character
    return result


def _character_ids(panel: Any) -> list[str]:
    values = _get(panel, "character_ids", _get(panel, "characters", [])) or []
    if isinstance(values, str):
        values = [values]
    result: list[str] = []
    for value in values:
        if isinstance(value, Mapping):
            value = value.get("id", value.get("character_id"))
        else:
            value = _get(value, "id", value)
        if value is not None:
            result.append(str(value))
    for figure in _get(panel, "figures", []):
        identifier = str(_get(figure, "character_id", ""))
        if identifier and identifier not in result:
            result.append(identifier)
    return result


def _has_lora(character: Any) -> bool:
    lora = _get(character, "lora")
    if not lora:
        # Permit the compact JSON form ``lora_path`` too.
        return bool(_get(character, "lora_path"))
    if isinstance(lora, str):
        return bool(lora.strip())
    if isinstance(lora, Mapping):
        return bool(lora.get("path") or lora.get("file") or lora.get("name"))
    return bool(_get(lora, "path", _get(lora, "file")))


def _dialogues(panel: Any) -> list[Any]:
    values = _get(panel, "dialogue", _get(panel, "dialogues", [])) or []
    if isinstance(values, (str, Mapping)):
        values = [values]
    return list(values)


@dataclass(slots=True)
class ValidationIssue:
    """One validation finding.

    ``severity`` is either ``error`` or ``warning``.  ``code`` is stable for
    callers; ``message`` is intentionally human-readable for the CLI.
    """

    severity: str
    code: str
    message: str
    panel_id: str | None = None
    field: str | None = None
    details: dict[str, Any] = dc_field(default_factory=dict)

    @property
    def is_error(self) -> bool:
        return self.severity == "error"

    def to_dict(self) -> dict[str, Any]:
        result = {
            "severity": self.severity,
            "code": self.code,
            "message": self.message,
        }
        if self.panel_id is not None:
            result["panel_id"] = self.panel_id
        if self.field is not None:
            result["field"] = self.field
        if self.details:
            result["details"] = self.details
        return result

    def __getitem__(self, key: str) -> Any:
        return self.to_dict()[key]


@dataclass(slots=True)
class ValidationReport:
    issues: list[ValidationIssue] = dc_field(default_factory=list)

    @property
    def errors(self) -> list[ValidationIssue]:
        return [issue for issue in self.issues if issue.severity == "error"]

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [issue for issue in self.issues if issue.severity == "warning"]

    @property
    def valid(self) -> bool:
        return not self.errors

    @property
    def ok(self) -> bool:
        return self.valid

    @property
    def exit_code(self) -> int:
        return 1 if self.errors else 0

    def add(
        self,
        severity: str,
        code: str,
        message: str,
        *,
        panel_id: str | None = None,
        field_name: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> ValidationIssue:
        issue = ValidationIssue(
            severity,
            code,
            message,
            panel_id,
            field_name,
            details or {},
        )
        self.issues.append(issue)
        return issue

    def to_dict(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "exit_code": self.exit_code,
            "errors": [issue.to_dict() for issue in self.errors],
            "warnings": [issue.to_dict() for issue in self.warnings],
            "issues": [issue.to_dict() for issue in self.issues],
        }

    def __bool__(self) -> bool:
        return self.valid


def _order(panel: Any, index: int) -> float:
    value = _get(panel, "order", index + 1)
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(index + 1)


def _dialogue_text(dialogue: Any) -> str:
    if isinstance(dialogue, str):
        return dialogue
    return str(_get(dialogue, "text", _get(dialogue, "content", "")) or "")


def _position_map(panel: Any) -> dict[str, float]:
    """Extract optional per-character x positions for continuity checks."""

    positions = _get(
        panel,
        "character_positions",
        _get(panel, "positions", _get(panel, "character_position")),
    )
    result: dict[str, float] = {}
    if isinstance(positions, Mapping):
        for identifier, value in positions.items():
            if isinstance(value, Mapping):
                value = value.get("x", value.get("center_x", value.get("left")))
            if value is not None:
                result[str(identifier)] = _number(value)
    elif isinstance(positions, Iterable) and not isinstance(positions, (str, bytes)):
        for value in positions:
            identifier = _get(value, "character_id", _get(value, "id"))
            x = _get(value, "x", _get(value, "center_x", _get(value, "left")))
            if identifier is not None and x is not None:
                result[str(identifier)] = _number(x)
    return result


def _reading_mismatch(page: Any, panels: list[Any], boxes: list[tuple[float, float, float, float]]) -> bool:
    if len(panels) < 2:
        return False
    direction = str(_get(page, "reading_direction", "rtl") or "rtl").lower()
    rtl = direction != "ltr"
    entries = []
    for index, (panel, box) in enumerate(zip(panels, boxes, strict=True)):
        x, y, w, h = box
        entries.append((panel, index, x + w / 2, y + h / 2, w, h))
    # Look at panels on the same visual row first. This avoids inventing a
    # reading order for a deliberately staggered diagonal composition.
    for left in entries:
        for right in entries:
            if left[1] >= right[1]:
                continue
            _, _, cx1, cy1, _, h1 = left
            _, _, cx2, cy2, _, h2 = right
            if abs(cy1 - cy2) > min(h1, h2) * 0.55:
                continue
            expected_first = cx1 > cx2 if rtl else cx1 < cx2
            actual_first = _order(left[0], left[1]) < _order(right[0], right[1])
            if expected_first != actual_first:
                return True
    # When the page has rows, the first panel should begin near the top row and
    # on the reading side (upper right for rtl, upper left for ltr).
    top_y = min(item[3] for item in entries)
    row = [item for item in entries if item[3] <= top_y + max(item[5] for item in entries) * 0.55]
    first = min(entries, key=lambda item: _order(item[0], item[1]))
    if row:
        expected = max(row, key=lambda item: item[2]) if rtl else min(row, key=lambda item: item[2])
        if first[1] != expected[1]:
            return True
    return False


def validate_page(
    page: Any,
    characters: Mapping[str, Any] | Iterable[Any] | None = None,
    *,
    max_dialogue_chars: int = 20,
    min_gap: float | None = None,
    geometry_tolerance: float | None = None,
) -> ValidationReport:
    """Validate a page and return structured errors/warnings.

    ``characters`` may be a mapping or an iterable of Character objects.  A
    missing character table only disables reference and LoRA checks; geometry
    and dialogue checks still run.
    """

    if geometry_tolerance is None:
        geometry_tolerance = _get(
            page, "geometry_tolerance", _get(page, "extra", {}).get("geometry_tolerance", 0.5)
        )
    tolerance = float(geometry_tolerance)
    if not isfinite(tolerance) or tolerance < 0:
        message = "geometry_tolerance must be finite and nonnegative"
        raise ValueError(message)
    report = ValidationReport()
    panels = _panels(page)
    width, height = canvas_size(page)
    if width <= 0 or height <= 0:
        report.add("error", "invalid_canvas", "画布宽高必须为正数", field_name="canvas")

    char_map = _character_map(characters)
    if isinstance(page, Page):
        caption_page = page
    else:
        try:
            caption_page = Page.from_dict(_as_dict(page))
        except (ValueError, TypeError, KeyError):
            caption_page = None
    if caption_page is not None:
        caption_characters = {
            key: value if isinstance(value, Character) else Character.from_dict(_as_dict(value))
            for key, value in char_map.items()
        }
        for panel in caption_page.panels:
            for notice in caption_notices(panel, caption_page, caption_characters):
                report.add(
                    "warning", notice["code"], notice["message"], panel_id=panel.id, field_name="description"
                )
    boxes: list[tuple[float, float, float, float]] = []
    orders: list[float] = []
    for index, panel in enumerate(panels):
        panel_id = _panel_id(panel, index)
        box = panel_bbox(panel)
        boxes.append(box)
        orders.append(_order(panel, index))
        x, y, w, h = box
        if w <= 0 or h <= 0:
            report.add(
                "error",
                "invalid_panel_bounds",
                f"格 {panel_id} 的宽高必须为正数",
                panel_id=panel_id,
                field_name="shape",
            )
        if x < -tolerance or y < -tolerance or x + w > width + tolerance or y + h > height + tolerance:
            report.add(
                "error",
                "panel_out_of_bounds",
                f"格 {panel_id} 超出画布范围",
                panel_id=panel_id,
                field_name="shape",
                details={"bbox": [x, y, w, h], "canvas": [width, height]},
            )

        ids = _character_ids(panel)
        if char_map:
            for identifier in ids:
                if identifier not in char_map:
                    report.add(
                        "error",
                        "unknown_character",
                        f"格 {panel_id} 引用了不存在的角色 {identifier}",
                        panel_id=panel_id,
                        field_name="character_ids",
                        details={"character_id": identifier},
                    )
        for dialogue in _dialogues(panel):
            text = _dialogue_text(dialogue)
            if len(text.strip()) > max_dialogue_chars:
                report.add(
                    "warning",
                    "dialogue_too_long",
                    f"格 {panel_id} 有一句台词超过 {max_dialogue_chars} 字",
                    panel_id=panel_id,
                    field_name="dialogue",
                    details={"length": len(text.strip()), "limit": max_dialogue_chars},
                )

    # Orders are intentionally checked after collecting all panels so duplicate
    # and missing values are reported together.
    expected_orders = list(range(1, len(panels) + 1))
    if any(order != int(order) for order in orders) or sorted(orders) != expected_orders:
        report.add(
            "error",
            "order_not_contiguous",
            "格子的 order 必须从 1 开始连续且不能重复",
            field_name="order",
            details={"orders": orders, "expected": expected_orders},
        )

    configured_gap = min_gap
    if configured_gap is None:
        configured_gap = _get(page, "panel_gap", _get(page, "gutter", 0)) or 0
    configured_gap = max(0.0, _number(configured_gap))
    _validate_polygons(panels, boxes, configured_gap, report, tolerance)
    _validate_overlays(page, panels, char_map, report, tolerance)
    object_ids = set()
    panel_ids = {_get(panel, "id") for panel in panels}
    for item in _get(page, "objects", []):
        identifier = _get(item, "id")
        if identifier in object_ids:
            report.add("error", "duplicate_object_id", "物件框 id 不能重复", field_name="objects")
        object_ids.add(identifier)
        parent = _get(item, "panel_id")
        if parent is not None and parent not in panel_ids:
            report.add("error", "unknown_object_panel", "物件框引用了不存在的格子", field_name="objects")
        x, y, w, h = panel_bbox({"shape": _get(item, "rect", {})})
        if not _get(item, "id") or _get(item, "label", "object") not in {"object", "character"}:
            report.add(
                "error", "invalid_object", "物件框需要 id 和 object / character 类型", field_name="objects"
            )
        if (
            w <= 0
            or h <= 0
            or x < -tolerance
            or y < -tolerance
            or x + w > width + tolerance
            or y + h > height + tolerance
        ):
            report.add("error", "object_out_of_bounds", "物件框必须在画布内且宽高为正", field_name="objects")

    if _reading_mismatch(page, panels, boxes):
        direction = str(_get(page, "reading_direction", "rtl") or "rtl").lower()
        side = "右上" if direction != "ltr" else "左上"
        report.add(
            "warning",
            "reading_order_mismatch",
            f"格子 order 与{direction}阅读方向不符，第一格应接近{side}",
            field_name="order",
        )

    # The page-level LoRA warning reflects the observed MOSS limitation: two
    # active character LoRAs can bleed into one another even when panels are
    # otherwise valid.
    if char_map:
        page_lora_ids = {
            identifier
            for panel in panels
            for identifier in _character_ids(panel)
            if identifier in char_map and _has_lora(char_map[identifier])
        }
        page_lora_ids.update(
            identifier
            for overlay in _get(page, "overlays", [])
            if (identifier := _get(overlay, "character_id", "")) in char_map
            and _has_lora(char_map[identifier])
        )
        if len(page_lora_ids) >= 2:
            report.add(
                "warning",
                "multiple_lora_characters_page",
                "本页出现多个带 LoRA 的角色，整页出图可能互相吞掉特征",
                field_name="character_ids",
                details={"character_ids": sorted(page_lora_ids)},
            )
        for index, panel in enumerate(panels):
            ids = [
                identifier
                for identifier in _character_ids(panel)
                if identifier in char_map and _has_lora(char_map[identifier])
            ]
            if len(ids) >= 2:
                report.add(
                    "warning",
                    "multiple_lora_characters_panel",
                    f"格 {_panel_id(panel, index)} 同时包含多个带 LoRA 的角色，建议逐格重画",
                    panel_id=_panel_id(panel, index),
                    field_name="character_ids",
                    details={"character_ids": ids},
                )

        # If callers provide explicit x positions, report left/right swaps. The
        # optional field keeps the base v1 format compact while enabling this
        # continuity check in editors that track blocking.
        positions = [_position_map(panel) for panel in panels]
        swaps = 0
        for first_index, first_positions in enumerate(positions):
            for second_positions in positions[first_index + 1 :]:
                common = sorted(set(first_positions) & set(second_positions))
                for left_index, left_id in enumerate(common):
                    for right_id in common[left_index + 1 :]:
                        before = first_positions[left_id] - first_positions[right_id]
                        after = second_positions[left_id] - second_positions[right_id]
                        if before * after < 0:
                            swaps += 1
        if swaps:
            report.add(
                "warning",
                "character_position_swap",
                "同一页角色左右站位发生对调，请检查视线连续性",
                field_name="character_positions",
                details={"swap_count": swaps},
            )

    _validate_storytelling(page, char_map, report, max_dialogue_chars=max_dialogue_chars, tolerance=tolerance)
    if caption_page is not None:
        _validate_text_figure_overlap(caption_page, char_map, report)
    if _get(page, "extra", {}).get("moss_import") or _get(page, "moss_import"):
        for issue in report.issues:
            if issue.code == "panel_overlap":
                issue.severity = "warning"
                issue.message = "导入的 MOSS 格子存在重叠，原布局已保留，请核对"
    return report


def _validation_shape(panel: Any, box: tuple[float, float, float, float]) -> dict[str, Any]:
    points = _points(_get(panel, "shape", panel))
    if points:
        return {"type": "quad", "points": points}
    x, y, w, h = box
    return {"type": "rect", "x": x, "y": y, "w": w, "h": h}


def _validate_polygons(
    panels: list[Any],
    boxes: list[tuple[float, float, float, float]],
    gap: float,
    report: ValidationReport,
    tolerance: float,
) -> None:
    shapes = []
    for panel, box in zip(panels, boxes, strict=True):
        shape = _validation_shape(panel, box)
        try:
            convex_polygon(shape)
        except ValueError as exc:
            report.add("error", "invalid_panel_polygon", str(exc), field_name="shape")
            shape = None
        shapes.append(shape)
    for index, first in enumerate(shapes):
        for second in shapes[index + 1 :]:
            if first is None or second is None:
                continue
            if polygons_overlap(first, second, tolerance=tolerance):
                report.add(
                    "error", "panel_overlap", "格子之间存在重叠", details={"first": first, "second": second}
                )
            elif shape_distance(first, second) + tolerance + 1e-7 < gap:
                report.add(
                    "error",
                    "panel_gap_too_small",
                    "格子间距小于设定值",
                    details={"distance": shape_distance(first, second), "minimum": gap},
                )


def _validate_overlays(
    page: Any, panels: list[Any], characters: dict[str, Any], report: ValidationReport, tolerance: float
) -> None:
    width, height = canvas_size(page)
    panel_ids = {_panel_id(panel, i) for i, panel in enumerate(panels)}
    seen = set()
    for overlay in _get(page, "overlays", []):
        if _get(overlay, "mode", "layer") not in {"moss", "layer"}:
            report.add(
                "error", "invalid_overlay_mode", "overlay.mode 必须为 moss 或 layer", field_name="overlays"
            )
        identifier = _get(overlay, "id", "")
        if not identifier or identifier in seen:
            report.add("error", "invalid_overlay_id", "出格图层 id 不能为空或重复", field_name="overlays")
        seen.add(identifier)
        parent = _get(overlay, "panel_id")
        if parent and parent not in panel_ids:
            report.add("error", "unknown_overlay_panel", "出格图层引用了不存在的格子", field_name="overlays")
        if _get(overlay, "character_id", "") not in characters:
            report.add(
                "error", "unknown_overlay_character", "出格图层引用了不存在的角色", field_name="overlays"
            )
        x, y, w, h = panel_bbox({"shape": _get(overlay, "rect", {})})
        if not (
            w > 0
            and h > 0
            and -tolerance <= x
            and x + w <= width + tolerance
            and -tolerance <= y
            and y + h <= height + tolerance
        ):
            report.add("error", "overlay_out_of_bounds", "出格图层必须在画布内", field_name="overlays")
        if _get(overlay, "status", "planned") not in {"planned", "approved"}:
            report.add("error", "invalid_overlay_status", "出格图层状态无效", field_name="overlays")
        if _number(_get(overlay, "z_index", 1)) < 1:
            report.add("error", "invalid_overlay_layer", "出格图层层级必须高于格子", field_name="overlays")


def _validate_storytelling(
    page: Any,
    characters: dict[str, Any],
    report: ValidationReport,
    *,
    max_dialogue_chars: int,
    tolerance: float,
) -> None:
    from .models import POSES  # noqa: PLC0415

    panel_ids = {_panel_id(panel, i) for i, panel in enumerate(_panels(page))}
    width, height = canvas_size(page)
    if _number(_get(page, "text_font_size", 42)) <= 0 or _number(_get(page, "text_max_chars", 10)) < 1:
        report.add("error", "invalid_text_metrics", "文字字号和每列字数必须为正数", field_name="texts")
    seen = set()
    for text in _get(page, "texts", []):
        identifier = _get(text, "id", "")
        if not identifier or identifier in seen:
            report.add("error", "invalid_text_id", "文字 id 不能为空或重复", field_name="texts")
        seen.add(identifier)
        if (
            _get(text, "kind", "dialogue") == "dialogue"
            and len(_dialogue_text(text).strip()) > max_dialogue_chars
        ):
            report.add(
                "warning",
                "dialogue_too_long",
                f"文字 {identifier} 的台词超过 {max_dialogue_chars} 字",
                field_name="texts.text",
                details={"text_id": identifier},
            )
        parent = _get(text, "panel_id")
        if parent and parent not in panel_ids:
            report.add("error", "unknown_text_panel", "文字引用了不存在的格子", field_name="texts")
        speaker = _get(text, "speaker_id")
        if speaker and characters and speaker not in characters:
            report.add("error", "unknown_text_speaker", "文字引用了不存在的说话人", field_name="texts")
        for key, choices in (
            ("kind", {"dialogue", "narration", "sfx", "title", "caption_tag"}),
            ("bubble", {"speech", "shout", "thought", "box", "none"}),
            ("direction", {None, "vertical", "horizontal"}),
        ):
            if _get(text, key) not in choices:
                report.add("error", "invalid_text_field", f"文字 {key} 值无效", field_name=f"texts.{key}")
        direction = _get(text, "direction") or _get(page, "text_direction", "vertical")
        raw_box = _get(text, "bbox")
        box = (
            _coerce_box(raw_box)
            if isinstance(raw_box, (Mapping, list, tuple))
            else (
                (_get(raw_box, "x"), _get(raw_box, "y"), _get(raw_box, "w"), _get(raw_box, "h"))
                if raw_box
                else None
            )
        )
        if box:
            x, y, w, h = box
            if not (
                w > 0
                and h > 0
                and -tolerance <= x
                and x + w <= width + tolerance
                and -tolerance <= y
                and y + h <= height + tolerance
            ):
                report.add(
                    "error", "text_out_of_bounds", "文字框必须在画布内且宽高为正", field_name="texts.bbox"
                )
            if (direction == "vertical" and w > h * 1.5) or (direction == "horizontal" and h > w * 1.5):
                report.add(
                    "warning",
                    "text_direction_bbox_mismatch",
                    "文字方向与框形明显不符",
                    field_name="texts.bbox",
                    details={"text_id": identifier},
                )
    for index, panel in enumerate(_panels(page)):
        for figure in _get(panel, "figures", []):
            panel_id = _panel_id(panel, index)
            if _get(figure, "pose", "stand") not in POSES:
                report.add(
                    "warning",
                    "unknown_figure_pose",
                    "未知 pose，预览将退回 stand",
                    panel_id=panel_id,
                    field_name="figures.pose",
                )
            position = _get(figure, "position", "center")
            if isinstance(position, str):
                valid = position in {"left", "center", "right"}
            else:
                valid = (
                    isinstance(position, (int, float))
                    and not isinstance(position, bool)
                    and 0 <= position <= 1
                )
            if not valid:
                report.add(
                    "error",
                    "invalid_figure_position",
                    "人物位置必须是 0~1 或 left/center/right",
                    panel_id=panel_id,
                    field_name="figures.position",
                )
            if _get(figure, "facing", "front") not in {"left", "right", "front", "back"}:
                report.add(
                    "error",
                    "invalid_figure_facing",
                    "人物朝向无效",
                    panel_id=panel_id,
                    field_name="figures.facing",
                )
            if _get(figure, "framing") not in {None, "full", "waist", "bust", "face"}:
                report.add(
                    "error",
                    "invalid_figure_framing",
                    "人物取景范围无效",
                    panel_id=panel_id,
                    field_name="figures.framing",
                )
            identifier = _get(figure, "character_id", "")
            if characters and identifier not in characters:
                report.add(
                    "error",
                    "unknown_figure_character",
                    "人物引用了不存在的角色",
                    panel_id=panel_id,
                    field_name="figures.character_id",
                )


def _validate_text_figure_overlap(page: Page, characters: dict[str, Any], report: ValidationReport) -> None:
    """Warn when at least a fifth of a dialogue/narration box covers a figure.

    This uses the shared editor footprint, not a guessed face location. It
    never moves a declared box or upgrades a visual concern into an error.
    """
    threshold = 0.2
    panels = {panel.id: panel for panel in page.panels}
    try:
        texts = layout_texts(page)
    except (ValueError, TypeError, OverflowError, ZeroDivisionError):
        # Invalid canvas/text geometry is reported by the regular validator.
        return
    for text in texts:
        if text.kind not in {"dialogue", "narration"} or text.bbox is None:
            continue
        box = text.bbox
        area = box.w * box.h
        if box.w <= 0 or box.h <= 0:
            continue
        candidates = [panels[text.panel_id]] if text.panel_id in panels else page.panels
        for panel in candidates:
            for figure in panel_figures(panel, page):
                try:
                    left, top, right, bottom = figure_page_box(figure, panel)
                except (ValueError, TypeError, KeyError, OverflowError):
                    # Existing geometry/figure validation reports malformed input.
                    continue
                overlap = max(0, min(box.x + box.w, right) - max(box.x, left)) * max(
                    0, min(box.y + box.h, bottom) - max(box.y, top)
                )
                ratio = overlap / area
                if ratio <= threshold:
                    continue
                character_id = figure.character_id
                name = _get(characters.get(character_id), "display_name", character_id)
                mismatch = bool(text.speaker_id and text.speaker_id != character_id)
                message = f"第 {panel.order} 格文字可能遮挡人物：{name}"
                if mismatch:
                    speaker = _get(characters.get(text.speaker_id), "display_name", text.speaker_id)
                    message += f"（说话人 {speaker}，被遮挡人物 {name}）"
                report.add(
                    "warning",
                    "text_overlaps_figure",
                    message,
                    panel_id=panel.id,
                    field_name="texts.bbox",
                    details={
                        "text_id": text.id,
                        "character_id": character_id,
                        "speaker_id": text.speaker_id,
                        "speaker_mismatch": mismatch,
                        "overlap_ratio": ratio,
                        "threshold": threshold,
                    },
                )


# Short aliases used by integrations and the CLI.
validate = validate_page
Issue = ValidationIssue
Report = ValidationReport


__all__ = [
    "Issue",
    "Report",
    "ValidationIssue",
    "ValidationReport",
    "canvas_size",
    "panel_bbox",
    "validate",
    "validate_page",
]
