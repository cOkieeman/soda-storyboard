"""Command line interface for soda-storyboard."""

from __future__ import annotations

import argparse
import json
import re
import sys
from copy import deepcopy
from math import isfinite
from pathlib import Path
from typing import Any

from .compiler import compile_geometry_map, compile_page, size_check_report
from .geometry import bbox_overlap, bbox_xywh, shape_bbox, skew_rectangles
from .io import load_characters, load_page, load_project, read_json, write_json
from .models import Character, Lora, Page, Panel, Project
from .preview import render_preview
from .server.common import APIError
from .templates import builtin_templates, suggest_layouts
from .validation import validate_page


def _json_print(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def _emit(value: Any, as_json: bool) -> None:
    if as_json:
        _json_print(value)
        return
    if isinstance(value, dict) and "valid" in value:
        state = "通过" if value["valid"] else "失败"
        print(f"校验{state}：{len(value.get('errors', []))} 个错误，{len(value.get('warnings', []))} 个警告")
        for issue in value.get("errors", []) + value.get("warnings", []):
            print(f"- [{issue['severity']}] {issue['message']}")
    elif isinstance(value, dict) and "items" in value:
        print(f"已生成 MOSS 布局：{len(value['items'])} 个条目")
    elif isinstance(value, list):
        for item in value:
            source = " [来自参考页]" if item.get("source") == "reference" else ""
            print(f"{item.get('template_id', item.get('id', ''))}: {item.get('name', '')}{source}")
    else:
        print(value)


def _default_page(project: Project, page_id: str, panels: int) -> Page:
    return Page(
        page_id=page_id,
        canvas_width=project.default_canvas_width,
        canvas_height=project.default_canvas_height,
        reading_direction=project.reading_direction,
        style_prefix=project.default_style_prefix,
        dialogue_mode=project.default_dialogue_mode,
        text_direction=project.text_direction,
        color_mode=project.color_mode,
        style_prompt=project.style_prompt,
        tags=list(project.tags),
        panels=[
            Panel(
                id=f"panel-{index}",
                order=index,
                shape={"type": "rect", "x": 0, "y": 0, "w": 1, "h": 1},
                description="",
            )
            for index in range(1, panels + 1)
        ],
    )


def _project_for(path: Path) -> Project:
    project_path = path / "project.json" if path.is_dir() else path.parent.parent / "project.json"
    if project_path.exists():
        return load_project(project_path)
    return Project(name=path.name if path.is_dir() else "soda-storyboard")


def command_init(args: argparse.Namespace) -> int:
    root = Path(args.directory)
    root.mkdir(parents=True, exist_ok=True)
    for directory in ("pages", "characters", "templates"):
        (root / directory).mkdir(exist_ok=True)
    (root / ".soda").mkdir(exist_ok=True)
    (root / ".soda/.gitignore").write_text("*\n!.gitignore\n", encoding="utf-8")
    project = Project(
        name=args.name or root.name,
        default_canvas_width=args.width,
        default_canvas_height=args.height,
        reading_direction=args.direction,
    )
    write_json(root / "project.json", project)
    result = {"project": str(root / "project.json"), "directories": ["pages", "characters", "templates"]}
    _emit(result, args.json)
    return 0


def command_page_new(args: argparse.Namespace) -> int:
    root = Path(args.project)
    project = _project_for(root)
    page = Page(
        page_id=args.id,
        canvas_width=args.width or project.default_canvas_width,
        canvas_height=args.height or project.default_canvas_height,
        reading_direction=args.direction or project.reading_direction,
        style_prefix=args.style if args.style is not None else project.default_style_prefix,
        description=args.description,
        dialogue_mode=args.dialogue_mode or project.default_dialogue_mode,
        text_direction=args.text_direction or project.text_direction,
        color_mode=args.color_mode or project.color_mode,
        style_prompt=project.style_prompt,
        tags=list(project.tags),
    )
    target = Path(args.output) if args.output else root / "pages" / f"{args.id}.json"
    write_json(target, page)
    _emit({"path": str(target), "page": page.to_dict()}, args.json)
    return 0


def command_character_new(args: argparse.Namespace) -> int:
    root = Path(args.project)
    character = Character(
        id=args.id,
        display_name=args.name or args.id,
        trigger_words=args.trigger or [],
        appearance_zh=args.appearance_zh,
        appearance_en=args.appearance_en,
        role_en=args.role_en,
        lora=_character_lora(args, None),
        clothing=args.outfit or [],
        reference_images=args.reference or [],
    )
    target = Path(args.output) if args.output else root / "characters" / f"{args.id}.json"
    write_json(target, character)
    _emit({"path": str(target), "character": character.to_dict()}, args.json)
    return 0


def _character_lora(args: argparse.Namespace, current: Lora | None) -> Lora | None:
    if args.lora is None and args.lora_strength is None:
        return current
    path = args.lora if args.lora is not None else current.path if current else ""
    if not path.strip():
        raise ValueError("请提供 --lora 路径；没有 LoRA 时不能单独设置强度")
    strength = args.lora_strength if args.lora_strength is not None else current.strength if current else 0.8
    if not isfinite(strength):
        raise ValueError("LoRA 强度必须为有限数值")
    return Lora(path, strength)


def _set_alias(payload: dict[str, Any], keys: tuple[str, ...], value: Any) -> None:
    existing = [key for key in keys if key in payload]
    for key in existing or [keys[0]]:
        payload[key] = value


def _set_appearance(payload: dict[str, Any], language: str, value: str) -> None:
    flat_key = f"appearance_{language}"
    appearance = payload.get("appearance")
    if flat_key in payload:
        payload[flat_key] = value
    if isinstance(appearance, dict):
        keys = ("zh", "cn") if language == "zh" else ("en",)
        _set_alias(appearance, keys, value)
    elif isinstance(appearance, str) and language == "zh":
        payload["appearance"] = value
    elif flat_key not in payload:
        payload["appearance"] = {
            **({"zh": appearance} if isinstance(appearance, str) else {}),
            language: value,
        }


def _set_lora(payload: dict[str, Any], args: argparse.Namespace, lora: Lora | None) -> None:
    if lora is None or (args.lora is None and args.lora_strength is None):
        return
    existing = payload.get("lora")
    if isinstance(existing, dict):
        if args.lora is not None:
            _set_alias(existing, ("path", "model", "file"), lora.path)
        if args.lora_strength is not None:
            existing["strength"] = lora.strength
    elif existing is None and payload.get("lora_path"):
        if args.lora is not None:
            payload["lora_path"] = lora.path
        if args.lora_strength is not None:
            payload["lora_strength"] = lora.strength
    elif isinstance(existing, str) and args.lora_strength is None:
        payload["lora"] = lora.path
    else:
        payload["lora"] = lora.to_dict()


def _patch_character(payload: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    updated = deepcopy(payload)
    for option, keys in (
        ("name", ("display_name", "name")),
        ("role_en", ("role_en",)),
        ("trigger", ("trigger_words", "triggers")),
        ("outfit", ("clothing",)),
        ("reference", ("reference_images", "references")),
    ):
        value = getattr(args, option)
        if value is not None:
            _set_alias(updated, keys, value)
    for language in ("zh", "en"):
        value = getattr(args, f"appearance_{language}")
        if value is not None:
            _set_appearance(updated, language, value)
    _set_lora(updated, args, _character_lora(args, Character.from_dict(payload).lora))
    Character.from_dict(updated)
    return updated


def command_character_set(args: argparse.Namespace) -> int:
    for path in sorted((Path(args.project) / "characters").glob("*.json")):
        payload = read_json(path)
        if payload.get("id") == args.id:
            updated = _patch_character(payload, args)
            if updated != payload:
                write_json(path, updated)
            _emit({"path": str(path), "character": Character.from_dict(updated).to_dict()}, args.json)
            return 0
    message = f"项目中找不到角色 id：{args.id}"
    raise FileNotFoundError(message)


def command_character_list(args: argparse.Namespace) -> int:
    characters = load_characters(Path(args.project) / "characters")
    cards = [character.to_dict() for character in characters.values()]
    if args.json:
        _json_print(cards)
    else:
        for character in characters.values():
            print(f"{character.id}: {character.display_name}")
    return 0


def _character_options(parser: argparse.ArgumentParser, *, editing: bool = False) -> None:
    parser.add_argument("--project", default=".")
    parser.add_argument("--name")
    parser.add_argument("--trigger", action="append")
    parser.add_argument("--appearance-zh", default=None if editing else "")
    parser.add_argument("--appearance-en", default=None if editing else "")
    parser.add_argument("--role-en", help="英文简短称呼，例如 the older sister")
    parser.add_argument("--lora", help="LoRA 文件路径；只记录用户给出的路径，不搜索磁盘")
    parser.add_argument("--lora-strength", type=float, help="LoRA 强度；新建 LoRA 默认 0.8")
    parser.add_argument("--outfit", action="append", help="服装描述；可重复；set 时替换整个服装列表")
    parser.add_argument("--reference", action="append", help="参考图路径；可重复；set 时替换整个参考图列表")
    parser.add_argument("--json", action="store_true")


def command_page_skew(args: argparse.Namespace) -> int:
    path = Path(args.page)
    payload = read_json(path)
    ids = [identifier.strip() for identifier in args.panels.split(",") if identifier.strip()]
    panels = {panel["id"]: panel for panel in payload["panels"]}
    if len(ids) <= 1 or len(set(ids)) != len(ids) or not set(ids) <= panels.keys():
        raise ValueError("--panels 需要至少两个不同的、已存在的格子 id")
    selected = [panels[identifier]["shape"] for identifier in ids]
    bounds = [shape_bbox(shape) for shape in selected]
    group = (
        min(b[0] for b in bounds),
        min(b[1] for b in bounds),
        max(b[2] for b in bounds),
        max(b[3] for b in bounds),
    )
    group_box = (group[0], group[1], group[2] - group[0], group[3] - group[1])
    if any(
        bbox_overlap(group_box, bbox_xywh(panel["shape"]))
        for identifier, panel in panels.items()
        if identifier not in ids
    ):
        raise ValueError("选中的格子之间还有其他格子，请选择完整的相邻组")
    page = Page.from_dict(payload)
    quads = skew_rectangles(selected, angle=args.angle, gap=page.panel_gap, axis=args.axis)
    for identifier, quad in zip(ids, quads, strict=True):
        panels[identifier]["shape"] = quad
    report = validate_page(Page.from_dict(payload), _characters_near(path))
    if report.errors:
        raise ValueError(report.errors[0].message)
    write_json(path, payload)
    _emit({"path": str(path), "panels": ids, "angle": args.angle}, args.json)
    return 0


def command_template_list(args: argparse.Namespace) -> int:
    templates = builtin_templates(args.panels)
    _emit(templates, args.json)
    return 0


def command_layout_suggest(args: argparse.Namespace) -> int:
    if args.panels is None and not args.page:
        raise ValueError("layout suggest 需要 --panels 或 --page")
    page = load_page(args.page) if args.page else None
    if args.write_page and page is None:
        raise ValueError("--write-page 需要同时提供 --page")
    if page is not None and args.panels is not None and args.panels != len(page.panels):
        raise ValueError("--panels 与页文件格数不一致")
    panel_count = args.panels if args.panels is not None else len(page.panels)
    width = page.canvas_width if page else args.width
    height = page.canvas_height if page else args.height
    importance = (
        _parse_importance(args.importance)
        if args.importance
        else [panel.importance for panel in sorted(page.panels, key=lambda panel: panel.order)]
        if page
        else None
    )
    results = suggest_layouts(
        panel_count,
        width=width,
        height=height,
        importance=importance,
        user_templates=args.templates,
        candidates=args.candidates,
        gap=args.gap if args.gap is not None else page.panel_gap if page else 24,
        reading_direction=args.direction or (page.reading_direction if page else "rtl"),
        pick=args.pick,
        skew=args.skew,
    )
    if args.preview_dir:
        for index, result in enumerate(results, 1):
            preview_page = Page(
                canvas_width=width,
                canvas_height=height,
                panels=[
                    Panel(
                        id=f"panel-{p['order']}",
                        order=p["order"],
                        shape={k: v for k, v in p.items() if k != "order"},
                    )
                    for p in result["panels"]
                ],
            )
            safe_id = re.sub(r"[^\w.-]", "_", result["template_id"])
            target = Path(args.preview_dir) / f"{index:02d}-{safe_id}.png"
            result["preview"] = str(render_preview(preview_page, target))
    if args.page:
        # Write only geometry in the original JSON, including legacy and unknown fields.
        payload = read_json(args.page)
        chosen = results[0]["panels"]
        for panel, shape in zip(
            sorted(payload["panels"], key=lambda panel: panel["order"]), chosen, strict=True
        ):
            panel["shape"] = {key: value for key, value in shape.items() if key != "order"}
        write_json(args.write_page or args.page, payload)
    if args.output:
        write_json(args.output, {"panel_count": panel_count, "candidates": results})
    _emit(results, args.json)
    return 0


def command_layout_extract(args: argparse.Namespace) -> int:
    from PIL import Image  # noqa: PLC0415

    from .extract import draw_extraction_preview, extract_layout, save_template  # noqa: PLC0415

    source = Path(args.image)
    result = extract_layout(source, direction=args.direction)
    output = Path(args.preview) if args.preview else source.with_name(f"{source.stem}.layout-preview.png")
    if output.resolve() == source.resolve():
        raise ValueError("预览输出不能覆盖参考原图")
    with Image.open(source) as image:
        result["preview"] = str(draw_extraction_preview(image, result, output))
    if args.save:
        result["template"] = str(save_template(result, Path(args.project) / "templates", name=args.name))
    _emit(result, args.json)
    return 0


def _characters_near(page_path: Path) -> dict[str, Character]:
    root = page_path.parent.parent
    return load_characters(root / "characters")


def command_validate(args: argparse.Namespace) -> int:
    path = Path(args.page)
    page = _page_for(path)
    report = validate_page(page, _characters_near(path), max_dialogue_chars=args.max_dialogue_chars)
    _emit(report.to_dict(), args.json)
    return report.exit_code


def command_preview(args: argparse.Namespace) -> int:
    path = Path(args.page)
    page = _page_for(path)
    output = args.output or str(path.with_suffix(".png"))
    rendered = render_preview(
        page, output, _characters_near(path), font=args.font, scale=args.scale, style=args.style
    )
    _emit({"path": str(rendered), "font": str(args.font or "auto")}, args.json)
    return 0


def _parse_size(value: str | None) -> tuple[int, int] | None:
    if not value:
        return None
    try:
        width, height = value.lower().replace("×", "x").split("x", 1)
        return int(width), int(height)
    except ValueError as exc:
        raise ValueError("尺寸应写成 WIDTHxHEIGHT，例如 1024x1536") from exc


def _parse_importance(value: str) -> list[int]:
    try:
        values = [int(item.strip()) for item in value.split(",") if item.strip()]
    except ValueError as exc:
        raise ValueError("重要度应写成逗号分隔的整数，例如 3,2,1") from exc
    if not values or any(item not in (1, 2, 3) for item in values):
        raise ValueError("每格重要度必须是 1、2 或 3")
    return values


def _page_for(path: Path) -> Page:
    payload = read_json(path)
    project = _project_for(path)
    payload.setdefault("text_direction", project.text_direction)
    payload.setdefault("color_mode", project.color_mode)
    if not payload.get("style_prompt"):
        payload["style_prompt"] = project.style_prompt
    payload.setdefault("tags", project.tags)
    return Page.from_dict(payload)


def command_compile(args: argparse.Namespace) -> int:
    path = Path(args.page)
    page = _page_for(path)
    target_size = _parse_size(args.size_check)
    compiled = compile_page(
        page,
        _characters_near(path),
        size_check=target_size,
        with_ids=args.with_ids,
        slant_mode=args.slant_mode,
    )
    if args.output:
        write_json(args.output, compiled)
    target = Path(args.output) if args.output else path
    if args.slant_mode == "cut" and any(panel.shape_type == "quad" for panel in page.panels):
        cut_map = compile_geometry_map(page, slant_mode="cut")
        write_json(
            target.with_suffix(".cut.json"),
            {key: value for key, value in cut_map.items() if key != "overlays"},
        )
    if args.with_ids:
        write_json(
            target.with_suffix(".map.json"),
            compile_geometry_map(page, slant_mode=args.slant_mode, size_check=target_size),
        )
    report = {**compiled, **({"size_check": size_check_report(page, target_size)} if target_size else {})}
    _emit(report, args.json)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="soda-storyboard", description="分镜单 v1 工具")
    subparsers = parser.add_subparsers(dest="command", required=True)

    init = subparsers.add_parser("init", help="初始化项目目录")
    init.add_argument("directory")
    init.add_argument("--name")
    init.add_argument("--width", type=int, default=1024)
    init.add_argument("--height", type=int, default=1536)
    init.add_argument("--direction", choices=("rtl", "ltr"), default="rtl")
    init.add_argument("--json", action="store_true")
    init.set_defaults(func=command_init)

    page = subparsers.add_parser("page", help="创建分镜页")
    page_sub = page.add_subparsers(dest="page_command", required=True)
    page_new = page_sub.add_parser("new")
    page_new.add_argument("--project", default=".")
    page_new.add_argument("--id", required=True)
    page_new.add_argument("--output")
    page_new.add_argument("--width", type=int)
    page_new.add_argument("--height", type=int)
    page_new.add_argument("--direction", choices=("rtl", "ltr"))
    page_new.add_argument("--style")
    page_new.add_argument("--description", default="")
    page_new.add_argument("--dialogue-mode", choices=("moss_text", "lettering"))
    page_new.add_argument("--text-direction", choices=("vertical", "horizontal"))
    page_new.add_argument("--color-mode", choices=("monochrome", "color"))
    page_new.add_argument("--json", action="store_true")
    page_new.set_defaults(func=command_page_new)
    page_skew = page_sub.add_parser("skew", help="倾斜相邻格子之间的共享分割线")
    page_skew.add_argument("page")
    page_skew.add_argument("--panels", required=True, help="逗号分隔的相邻格子 id")
    page_skew.add_argument("--angle", type=float, default=8)
    page_skew.add_argument("--axis", choices=("auto", "vertical", "horizontal"), default="auto")
    page_skew.add_argument("--json", action="store_true")
    page_skew.set_defaults(func=command_page_skew)

    character = subparsers.add_parser("character", help="创建角色卡")
    character_sub = character.add_subparsers(dest="character_command", required=True)
    character_new = character_sub.add_parser("new")
    _character_options(character_new)
    character_new.add_argument("--id", required=True)
    character_new.add_argument("--output")
    character_new.set_defaults(func=command_character_new)
    character_set = character_sub.add_parser("set", help="只修改给出的角色字段")
    character_set.add_argument("id")
    _character_options(character_set, editing=True)
    character_set.set_defaults(func=command_character_set)
    character_list = character_sub.add_parser("list", help="列出项目里的角色")
    character_list.add_argument("--project", default=".")
    character_list.add_argument("--json", action="store_true")
    character_list.set_defaults(func=command_character_list)

    template = subparsers.add_parser("template", help="查看模板")
    template_sub = template.add_subparsers(dest="template_command", required=True)
    template_list = template_sub.add_parser("list")
    template_list.add_argument("--panels", type=int)
    template_list.add_argument("--json", action="store_true")
    template_list.set_defaults(func=command_template_list)

    layout = subparsers.add_parser("layout", help="版式求解")
    layout_sub = layout.add_subparsers(dest="layout_command", required=True)
    extract = layout_sub.add_parser("extract", help="从参考页提取格子几何")
    extract.add_argument("image")
    extract.add_argument("--direction", choices=("rtl", "ltr"), default="rtl")
    extract.add_argument("--name")
    extract.add_argument("--save", action="store_true")
    extract.add_argument("--project", default=".")
    extract.add_argument("--preview")
    extract.add_argument("--json", action="store_true")
    extract.set_defaults(func=command_layout_extract)
    suggest = layout_sub.add_parser("suggest")
    suggest.add_argument("--panels", type=int)
    suggest.add_argument("--page")
    suggest.add_argument("--width", type=int, default=1024)
    suggest.add_argument("--height", type=int, default=1536)
    suggest.add_argument("--templates")
    suggest.add_argument("--importance", help="逗号分隔的每格重要度，例如 3,2,1,1,1")
    suggest.add_argument("--candidates", type=int, default=6)
    suggest.add_argument("--skew", type=float, help="斜切角度；0 只返回矩形，默认混合候选")
    suggest.add_argument("--gap", type=int)
    suggest.add_argument("--direction", choices=("rtl", "ltr"))
    suggest.add_argument("--pick", help="选择 template_id；--page 会写回所选候选，默认第一项")
    suggest.add_argument("--preview-dir", help="为每个候选生成线框 PNG")
    suggest.add_argument("--output")
    suggest.add_argument("--write-page")
    suggest.add_argument("--json", action="store_true")
    suggest.set_defaults(func=command_layout_suggest)

    validate = subparsers.add_parser("validate", help="校验分镜页")
    validate.add_argument("page")
    validate.add_argument("--max-dialogue-chars", type=int, default=20)
    validate.add_argument("--json", action="store_true")
    validate.set_defaults(func=command_validate)

    preview = subparsers.add_parser("preview", help="生成线框预览")
    preview.add_argument("page")
    preview.add_argument("--output")
    preview.add_argument("--font")
    preview.add_argument("--scale", type=float, default=1.0)
    preview.add_argument("--style", choices=("sketch", "boxes"), default="sketch")
    preview.add_argument("--json", action="store_true")
    preview.set_defaults(func=command_preview)

    compile_parser = subparsers.add_parser("compile", help="编译为 MOSS 布局 JSON")
    compile_parser.add_argument("page")
    compile_parser.add_argument("--output")
    compile_parser.add_argument("--size-check")
    compile_parser.add_argument("--with-ids", action="store_true", help="输出 panel_id、speaker_id 辅助字段")
    compile_parser.add_argument("--slant-mode", choices=("cut", "hint", "rect"), default="cut")
    compile_parser.add_argument("--json", action="store_true")
    compile_parser.set_defaults(func=command_compile)
    from .production.cli import register_commands  # noqa: PLC0415 -- optional command registration

    register_commands(subparsers)
    from .edit import register_command  # noqa: PLC0415 -- keep command registration together

    register_command(subparsers)
    return parser


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except (APIError, OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
        if getattr(args, "json", False):
            _json_print({"error": str(exc)})
        else:
            print(f"错误：{exc}", file=sys.stderr)
        return 2


__all__ = ["build_parser", "main"]
