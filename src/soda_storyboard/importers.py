"""Explainable, offline imports of MOSS layouts and loose text storyboards."""

from __future__ import annotations

import copy
import json
import math
import re
from typing import Any

from .canvas_sizes import infer_dimensions
from .models import ObjectBox, Page, Panel, RectShape, Text
from .moss_roundtrip import entity_hash
from .templates import suggest_layouts

# ruff: noqa: RUF001, PLR2004 -- untrusted heterogeneous document boundary and geometry formats.


def _report() -> dict:
    return {"guesses": [], "unrecognized_items": [], "warnings": []}


def _size(raw: dict, items: list[dict], report: dict) -> tuple[int, int]:
    canvas = raw.get("canvas", raw.get("canvas_size", {}))
    if not isinstance(canvas, dict):
        canvas = dict(zip(("width", "height"), canvas, strict=False)) if isinstance(canvas, list) else {}
    width = raw.get("canvas_width", raw.get("width", canvas.get("width")))
    height = raw.get("canvas_height", raw.get("height", canvas.get("height")))
    if width and height:
        return int(width), int(height)
    inferred = infer_dimensions({**raw, "items": items})
    report["guesses"].append(
        f"画布尺寸缺失；按 bbox 范围和纵横比吸附到 {inferred[0]}×{inferred[1]}，请核对原尺寸。"
    )
    return int(width or inferred[0]), int(height or inferred[1])


def _rect(box: list, width: int, height: int, fmt: str, space: str) -> RectShape:
    if fmt not in {"xyxy", "xywh", "yxyx"}:
        message = f"Unsupported bbox format: {fmt}"
        raise ValueError(message)
    if len(box) != 4 or not all(
        isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        for value in box
    ):
        message = "bbox must contain four finite numbers"
        raise ValueError(message)
    a, b, c, d = box
    x, y, right, bottom = (
        (b, a, d, c) if fmt == "yxyx" else (a, b, a + c, b + d) if fmt == "xywh" else (a, b, c, d)
    )
    if space in {"normalized", "0-1", "relative"}:
        x, right, y, bottom = x * width, right * width, y * height, bottom * height
    elif space in {"normalized_1000", "0-1000"}:
        x, right, y, bottom = (
            x * width / 1000,
            right * width / 1000,
            y * height / 1000,
            bottom * height / 1000,
        )
    elif space in {"abs_centralized", "centered"}:
        x, right, y, bottom = x + width / 2, right + width / 2, y + height / 2, bottom + height / 2
    elif space not in {"top_left_pixels", "abs", "absolute"}:
        message = f"Unsupported coordinate space: {space}"
        raise ValueError(message)
    if right <= x or bottom <= y:
        message = "bbox must have positive width and height"
        raise ValueError(message)
    return RectShape(x, y, right - x, bottom - y)


def _contains(a: RectShape, b: RectShape) -> bool:
    return a.x <= b.x and a.y <= b.y and a.x + a.w >= b.x + b.w and a.y + a.h >= b.y + b.h


def _import_color(raw: dict, default: str, report: dict) -> str:
    if raw.get("color_mode") in {"color", "monochrome"}:
        return raw["color_mode"]
    captions = [str(raw.get("summary", {}))]
    captions.extend(str(item.get("caption", "")) for item in raw.get("items", []) if isinstance(item, dict))
    captions.extend(str(raw.get(key, "")) for key in ("panels", "shots", "frames", "description"))
    if re.search(
        r"\b(?:colou?red|full[ -]colou?r|colou?rful|digital_painting)\b|彩色|全彩",
        " ".join(captions),
        re.IGNORECASE,
    ):
        report["guesses"].append("源 summary / caption 表明彩色，color_mode 设为 color。")
        return "color"
    report["guesses"].append(f"源文件未声明颜色模式，沿用项目设置 {default}。")
    return default


def import_moss(raw: dict[str, Any], *, default_color_mode: str = "monochrome") -> tuple[Page, dict]:  # noqa: C901, PLR0912, PLR0915 -- classify heterogeneous MOSS entities, then record source order
    report = _report()
    items = raw.get("items", [])
    if not isinstance(items, list):
        message = "MOSS items must be an array"
        raise TypeError(message)
    width, height = _size(raw, [item for item in items if isinstance(item, dict)], report)
    fmt, space = raw.get("bbox_format", "yxyx"), raw.get("bbox_coord_space", "abs_centralized")
    if "bbox_format" not in raw or "bbox_coord_space" not in raw:
        report["guesses"].append(f"缺少坐标声明时按 MOSS {fmt} / {space} 解释。")
    boxes = {}
    for index, item in enumerate(items):
        try:
            rect = _rect(item["bbox"], width, height, fmt, space)
            x, y = max(0, rect.x), max(0, rect.y)
            right, bottom = min(width, rect.x + rect.w), min(height, rect.y + rect.h)
            if right <= x or bottom <= y:
                report["unrecognized_items"].append(
                    {"index": index, "reason": "bbox is outside the display canvas"}
                )
                continue
            boxes[index] = RectShape(x, y, right - x, bottom - y)
            if boxes[index] != rect:
                report["guesses"].append(
                    f"条目 {index + 1} 超出推断画布，显示框裁到画布内，原 bbox 仍无损保留。"
                )
        except (KeyError, ValueError, TypeError) as exc:
            report["unrecognized_items"].append({"index": index, "reason": str(exc)})
    objects = [
        index
        for index, item in enumerate(items)
        if isinstance(item, dict) and item.get("label") == "object" and index in boxes
    ]
    explicit = {
        index
        for index in objects
        if re.search(r"\bpanels?\b|格|コマ", str(items[index].get("caption", "")), re.IGNORECASE)
    }
    tiled = set()
    if not explicit:
        large = [index for index in objects if boxes[index].w * boxes[index].h >= width * height * 0.12]
        for index in large:
            a = boxes[index]
            if len(large) > 1 and all(
                index == other
                or min(a.x + a.w, boxes[other].x + boxes[other].w) <= max(a.x, boxes[other].x)
                or min(a.y + a.h, boxes[other].y + boxes[other].h) <= max(a.y, boxes[other].y)
                for other in large
            ):
                tiled.add(index)
        if tiled:
            report["guesses"].append("未发现格子关键词；将互不包含、无重叠的平铺大框识别为格子。")
    panel_indices = explicit or tiled
    page = Page(
        page_id=str(raw.get("page_id", raw.get("id", "imported-moss"))),
        canvas_width=width,
        canvas_height=height,
        panel_gap=0,
        description=str(raw.get("summary", {}).get("caption", "")),
        color_mode=_import_color(raw, default_color_mode, report),
    )
    entries = []
    for index, item in enumerate(items):
        kind, entity = "passthrough", None
        if index in boxes and isinstance(item, dict):
            rect, caption = boxes[index], str(item.get("caption", ""))
            if index in panel_indices:
                entity = Panel(
                    str(item.get("panel_id", f"moss-panel-{index + 1}")),
                    len(page.panels) + 1,
                    rect,
                    description=caption,
                )
                page.panels.append(entity)
                kind = "panel"
            elif item.get("label") == "text":
                direction = "vertical" if rect.h > rect.w * 1.5 else "horizontal"
                if re.search(r"horizontal|横排", caption, re.IGNORECASE):
                    direction = "horizontal"
                elif re.search(r"vertical|竖排|竖写", caption, re.IGNORECASE):
                    direction = "vertical"
                else:
                    report["guesses"].append(f"文字条目 {index + 1} 未写方向；按框比例推断为 {direction}。")
                text_kind = (
                    "narration"
                    if re.search(r"narration|旁白", caption, re.IGNORECASE)
                    else "title"
                    if re.search(r"title|标题", caption, re.IGNORECASE)
                    else "dialogue"
                )
                entity = Text(
                    str(item.get("text_id", f"moss-text-{index + 1}")),
                    str(item.get("text", "")),
                    kind=text_kind,
                    direction=direction,
                    bubble="none",
                    bbox=rect,
                    style_hint=caption,
                )
                page.texts.append(entity)
                kind = "text"
            elif item.get("label") in {"character", "object"}:
                entity = ObjectBox(f"moss-object-{index + 1}", rect, caption, label=item["label"])
                page.objects.append(entity)
                kind = "object"
            else:
                report["unrecognized_items"].append({"index": index, "reason": "未知 label，按原顺序透传"})
        entries.append(
            {
                "kind": kind,
                "id": entity.id if entity else None,
                "item": copy.deepcopy(item),
                "snapshot": entity_hash(entity.to_dict()) if entity else None,
            }
        )
    # Parent inference is descriptive only; no invented character identities or joints.
    for entity in [*page.texts, *page.objects]:
        rect = entity.bbox if isinstance(entity, Text) else entity.rect
        containing = [panel for panel in page.panels if _contains(RectShape.from_dict(panel.shape), rect)]
        if containing:
            entity.panel_id = min(containing, key=lambda panel: panel.bbox[2] * panel.bbox[3]).id
    by_id = {
        (kind, entity.id): entity
        for kind, entities in (("panel", page.panels), ("text", page.texts), ("object", page.objects))
        for entity in entities
    }
    for entry in entries:
        if entry["kind"] != "passthrough":
            entry["snapshot"] = entity_hash(by_id[entry["kind"], entry["id"]].to_dict())
    page.extra["moss_import"] = {
        "entries": entries,
        "summary": copy.deepcopy(raw.get("summary", {})),
        "top_level": {
            key: copy.deepcopy(value) for key, value in raw.items() if key not in {"summary", "items"}
        },
        "declared_fields": list(raw),
    }
    page.extra["canvas_mode"] = "panels" if page.panels else "single"
    report.update(
        canvas=[width, height],
        panel_count=len(page.panels),
        text_count=len(page.texts),
        object_count=len(page.objects),
        preserved_items=len(items),
    )
    report["guesses"].append("人物只保留原框和描述，不推测角色身份、关节或 OCR 内容。")
    return page, report


def _markdown(source: str) -> list[dict]:
    rows = []
    lines = source.splitlines()
    headers = None
    for raw_line in lines:
        line = raw_line.strip()
        if line.startswith("|"):
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if all(re.fullmatch(r"[:\- ]+", cell) for cell in cells):
                continue
            if headers is None:
                headers = cells
                continue
            values = dict(zip(headers, cells, strict=False))
            description = next(
                (
                    value
                    for key, value in values.items()
                    if re.search(r"画面|描述|内容|description|prompt", key, re.IGNORECASE)
                ),
                cells[1] if len(cells) > 1 else cells[0],
            )
            dialogue = next(
                (
                    value
                    for key, value in values.items()
                    if re.search(r"台词|对白|dialogue|lines", key, re.IGNORECASE)
                ),
                "",
            )
            rows.append({"description": description, "lines": [dialogue] if dialogue else []})
        elif match := re.match(r"^(?:[-*+]\s+|\d+[.)、]\s*)(.+)", line):
            rows.append({"description": match[1]})
    return rows


def import_storyboard(  # noqa: C901 -- heterogeneous source formats with explicit project inheritance
    source: str | dict | list, *, page_id: str | None = None, default_color_mode: str = "monochrome"
) -> tuple[Page, dict]:
    if isinstance(source, str):
        content = re.sub(r"^```(?:json)?\s*|\s*```$", "", source.strip(), flags=re.IGNORECASE)
        try:
            source = json.loads(content)
        except json.JSONDecodeError:
            frames = _markdown(source)
            if not frames:
                message = "No storyboard rows found; provide JSON, a Markdown table or a numbered list"
                raise ValueError(message) from None
            source = {"frames": frames}
    if isinstance(source, list):
        source = {"frames": source}
    if not isinstance(source, dict):
        message = "Storyboard must be an object or a frame list"
        raise TypeError(message)
    if "page" in source and isinstance(source["page"], dict):
        source = source["page"]
    if "items" in source:
        page, report = import_moss(source, default_color_mode=default_color_mode)
    elif source.get("format") == "soda-storyboard-page-v1":
        page, report = Page.from_dict(source), _report()
        report.update(canvas=[page.width, page.height], panel_count=len(page.panels))
        if "color_mode" not in source:
            page.color_mode = _import_color(source, default_color_mode, report)
    else:
        page, report = _loose_page(source)
        page.color_mode = _import_color(source, default_color_mode, report)
    if page_id:
        page.page_id = page_id
    return page, report


def _loose_page(raw: dict) -> tuple[Page, dict]:
    report = _report()
    if not any(key in raw for key in ("panels", "frames", "shots")):
        message = "No panels / frames / shots found in storyboard"
        raise ValueError(message)
    frames = raw.get("panels", raw.get("frames", raw.get("shots", [])))
    if not isinstance(frames, list):
        message = "panels / frames / shots must be an array"
        raise TypeError(message)
    width, height = int(raw.get("canvas_width", 1024)), int(raw.get("canvas_height", 1536))
    if len(frames) > 7:
        message = "Text-only imports support up to seven panels per page; split the storyboard first"
        raise ValueError(message)
    page = Page(
        page_id=str(raw.get("id", "imported-storyboard")),
        canvas_width=width,
        canvas_height=height,
        panel_gap=0,
    )
    layout = suggest_layouts(len(frames), width=width, height=height, skew=0)[0]["panels"] if frames else []
    report["guesses"].append(
        "将 frames / shots / panels、prompt / description、lines / dialogue 统一为分镜字段。"
    )
    for index, raw_frame in enumerate(frames):
        frame = {"description": raw_frame} if isinstance(raw_frame, str) else raw_frame
        shape = frame.get("shape")
        if shape is None:
            box = frame.get("bbox", frame.get("rect"))
            if isinstance(box, dict):
                shape = {"type": "rect", **box}
            elif isinstance(box, list):
                fmt = frame.get("bbox_format", raw.get("bbox_format", "xyxy"))
                space = frame.get("bbox_coord_space", raw.get("bbox_coord_space"))
                if not space:
                    maximum = max(abs(value) for value in box)
                    space = (
                        "normalized"
                        if maximum <= 1
                        else "normalized_1000"
                        if maximum <= 1000 and "canvas_width" not in raw
                        else "top_left_pixels"
                    )
                    report["guesses"].append(
                        f"第 {index + 1} 格坐标按 {fmt} / {space} 解释；不明确的坐标请核对。"
                    )
                shape = _rect(box, width, height, fmt, space).to_dict()
            else:
                shape = {key: value for key, value in layout[index].items() if key != "order"}
                report["guesses"].append(f"第 {index + 1} 格没有坐标，套用现有版式模板。")
        panel = Panel(
            str(frame.get("id", f"p{index + 1}")),
            index + 1,
            shape,
            description=str(frame.get("description", frame.get("prompt", ""))),
        )
        page.panels.append(panel)
        lines = frame.get("dialogue", frame.get("lines", []))
        lines = [lines] if isinstance(lines, str) else lines
        for raw_line in lines:
            line = {"text": raw_line} if isinstance(raw_line, str) else raw_line
            page.texts.append(
                Text(
                    f"t{len(page.texts) + 1}",
                    str(line.get("text", line.get("content", ""))),
                    panel_id=panel.id,
                )
            )
    report.update(canvas=[width, height], panel_count=len(page.panels), text_count=len(page.texts))
    return page, report


__all__ = ["import_moss", "import_storyboard"]
