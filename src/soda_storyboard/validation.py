"""Validation rules for a soda-storyboard page.

The validator deliberately accepts both the public dataclasses and plain JSON
dictionaries.  Keeping the boundary duck typed makes it useful to the CLI,
editor, and callers which load a page without constructing a model first.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass
from dataclasses import field as dc_field
from math import hypot
from typing import Any


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
) -> ValidationReport:
    """Validate a page and return structured errors/warnings.

    ``characters`` may be a mapping or an iterable of Character objects.  A
    missing character table only disables reference and LoRA checks; geometry
    and dialogue checks still run.
    """

    report = ValidationReport()
    panels = _panels(page)
    width, height = canvas_size(page)
    if width <= 0 or height <= 0:
        report.add("error", "invalid_canvas", "画布宽高必须为正数", field_name="canvas")

    char_map = _character_map(characters)
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
        if x < 0 or y < 0 or x + w > width or y + h > height:
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

    for index, first in enumerate(boxes):
        x1, y1, w1, h1 = first
        for second in boxes[index + 1 :]:
            x2, y2, w2, h2 = second
            overlap_w = min(x1 + w1, x2 + w2) - max(x1, x2)
            overlap_h = min(y1 + h1, y2 + h2) - max(y1, y2)
            if overlap_w > 0 and overlap_h > 0:
                report.add(
                    "error",
                    "panel_overlap",
                    "格子之间存在重叠",
                    details={"first": list(first), "second": list(second)},
                )

    configured_gap = min_gap
    if configured_gap is None:
        configured_gap = _get(page, "panel_gap", _get(page, "gutter", 0)) or 0
    configured_gap = max(0.0, _number(configured_gap))
    if configured_gap:
        for index, first in enumerate(boxes):
            x1, y1, w1, h1 = first
            for second in boxes[index + 1 :]:
                x2, y2, w2, h2 = second
                overlap_w = min(x1 + w1, x2 + w2) - max(x1, x2)
                overlap_h = min(y1 + h1, y2 + h2) - max(y1, y2)
                if overlap_w > 0 and overlap_h > 0:
                    continue
                dx = max(x1 - (x2 + w2), x2 - (x1 + w1), 0.0)
                dy = max(y1 - (y2 + h2), y2 - (y1 + h1), 0.0)
                distance = dx if dx and not dy else dy if dy and not dx else hypot(dx, dy)
                if distance + 1e-9 < configured_gap:
                    report.add(
                        "error",
                        "panel_gap_too_small",
                        f"格子间距 {distance:g}px 小于设定的 {configured_gap:g}px",
                        details={"distance": distance, "minimum": configured_gap},
                    )

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

    return report


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
