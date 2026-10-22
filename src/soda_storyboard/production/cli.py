# ruff: noqa: RUF001, T201
# Only the CLI adapter prints results and progress.
# Chinese user-facing diagnostics intentionally use Chinese punctuation.
"""Thin argparse adapters for the print-free production API."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

from . import api
from .check import check
from .graphs import PRESETS
from .imaging import panel_size, working_size
from .state import PageState, configure

if TYPE_CHECKING:
    import argparse


def _context(args: argparse.Namespace) -> tuple[Path, str]:
    page = Path(args.page)
    if page.is_file() and page.suffix == ".json":
        return page.resolve().parent.parent, page.stem
    return Path(args.project), args.page


def _estimate(count: int, preset: str, width: int, height: int) -> None:
    steps = PRESETS[preset]["steps"]
    seconds = max(1, round(count * 40 * width * height / (1024 * 1536) * steps / 25))
    print(
        f"将生成 {count} 张图片，{width}×{height}、{steps} 步预计约 {seconds} 秒（排队和硬件会影响耗时）。",
        file=sys.stderr,
    )


def _panel_dimensions(state: PageState, panel_id: str) -> tuple[int, int]:
    state.panel(panel_id)
    panel = next(p for p in state.page.panels if p.id == panel_id)
    return working_size(*panel_size(panel))


def command(args: argparse.Namespace) -> int:  # noqa: C901, PLR0912, PLR0915 -- one thin branch per public operation
    action = args.production_action
    if action == "config":
        updates = {
            key: value
            for key, value in (
                (field, getattr(args, field))
                for field in (
                    "url",
                    "model",
                    "preset",
                    "backend",
                    "workflow",
                    "sft",
                    "base",
                    "clip",
                    "vae",
                    "timeout",
                    "poll_interval",
                    "cut_inset",
                    "border_width",
                )
            )
            if value is not None
        }
        result = configure(args.project, **updates)
    elif action == "check":
        result = check(args.project)
    elif action == "export":
        target = Path(args.target) if args.target else None
        if target and target.is_dir():
            result = api.export(target, fmt=args.format)
        elif target and target.is_file():
            result = api.export(target.resolve().parent.parent, [target.stem], fmt=args.format)
        else:
            result = api.export(args.project, [args.target] if args.target else None, fmt=args.format)
    else:
        root, page_id = _context(args)
        if action == "generate":
            state = PageState(root, page_id)
            preset = args.preset or state.config["preset"]
            count = len(args.seed) if args.seed else args.seeds
            _estimate(count, preset, state.page.canvas_width, state.page.canvas_height)
            result = api.generate_page(
                root,
                page_id,
                seeds=args.seeds,
                seed=args.seed,
                preset=preset,
                model=args.model,
                lora=args.lora,
            )
        elif action == "pick":
            result = api.pick_render(root, page_id, args.render)
        elif action == "plan":
            result = api.production_plan(root, page_id)
        elif action == "split":
            result = api.split_page(root, page_id)
        elif action == "redraw":
            state = PageState(root, page_id)
            _estimate(1, state.config["preset"], *_panel_dimensions(state, args.panel))
            result = api.redraw_panel(
                root,
                page_id,
                args.panel,
                mode=args.mode,
                character_id=args.character,
                denoise=args.denoise,
                seed=args.seed,
            )
        elif action == "inpaint":
            if not args.mask_only:
                state = PageState(root, page_id)
                _estimate(1, state.config["preset"], *_panel_dimensions(state, args.panel))
            result = api.inpaint_panel(
                root,
                page_id,
                args.panel,
                character_id=args.character,
                denoise=args.denoise,
                margin=args.margin,
                feather=args.feather,
                mask_only=args.mask_only,
                seed=args.seed,
            )
        elif action == "pick-panel":
            result = api.pick_panel(root, page_id, args.panel, args.render)
        elif action == "compose":
            result = api.compose_with_options(
                root, page_id, cut_inset=args.cut_inset, border_width=args.border_width
            )
        elif action == "letter":
            result = api.letter_with_options(root, page_id, font=args.font, text_ids=args.text)
        elif action == "cutout":
            if not args.png:
                state = PageState(root, page_id)
                overlay = next((o for o in state.page.overlays if o.id == args.overlay), None)
                if overlay:
                    _estimate(
                        1,
                        state.config["preset"],
                        *working_size(round(overlay.rect.w), round(overlay.rect.h)),
                    )
            result = api.cutout(root, page_id, args.overlay, png=args.png, seed=args.seed)
        else:
            msg = f"未知生产命令：{action}"
            raise ValueError(msg)
    _emit(result, as_json=args.json)
    return 2 if action == "check" and not result["ok"] else 0


def _emit(result: Any, *, as_json: bool) -> None:  # noqa: ANN401 -- CLI JSON result boundary
    if as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif isinstance(result, dict) and "ok" in result:
        print("ComfyUI 检查通过" if result["ok"] else "\n".join(result["errors"]))
    else:
        print(
            json.dumps(result, ensure_ascii=False, indent=2) if isinstance(result, (dict, list)) else result
        )


def _common(parser: argparse.ArgumentParser, action: str, *, page: bool = True) -> argparse.ArgumentParser:
    if page:
        parser.add_argument("page", help="页面 id 或 pages/<id>.json 路径")
    parser.add_argument("--project", default=".")
    parser.add_argument("--json", action="store_true")
    parser.set_defaults(func=command, production_action=action)
    return parser


def register_commands(subparsers: argparse._SubParsersAction) -> None:  # noqa: PLR0915 -- argparse declarations
    comfy = subparsers.add_parser("comfy", help="配置和检查 ComfyUI")
    comfy_sub = comfy.add_subparsers(dest="comfy_command", required=True)
    config = _common(comfy_sub.add_parser("config"), "config", page=False)
    for name in ("url", "model", "workflow", "sft", "base", "clip", "vae"):
        config.add_argument("--" + name)
    config.add_argument("--preset", choices=("draft", "final"))
    config.add_argument("--backend", choices=("minimal", "v2"))
    for name in ("timeout", "poll-interval", "cut-inset"):
        config.add_argument("--" + name, type=float)
    config.add_argument("--border-width", type=int)
    _common(comfy_sub.add_parser("check"), "check", page=False)
    gen = subparsers.add_parser("gen", help="生成候选图")
    gen_sub = gen.add_subparsers(dest="gen_command", required=True)
    generate = _common(gen_sub.add_parser("page"), "generate")
    generate.add_argument("--seeds", type=int, default=4, help="生成数量（每张使用一个随机种子）")
    generate.add_argument("--seed", type=int, action="append", help="指定种子，可重复；数量以种子列表为准")
    generate.add_argument("--preset", choices=("draft", "final"))
    generate.add_argument("--model", help="base / sft / 自定义模型文件名")
    generate.add_argument("--lora", default="auto", help="auto / none / 角色 id")
    pick = _common(subparsers.add_parser("pick", help="选定整页底图"), "pick")
    pick.add_argument("render")
    _common(subparsers.add_parser("plan", help="查看后续生产计划"), "plan")
    _common(subparsers.add_parser("split", help="按 bbox 切格并保存 quad 遮罩"), "split")
    redraw = _common(subparsers.add_parser("redraw", help="重画单格以修正细节"), "redraw")
    redraw.add_argument("panel")
    redraw.add_argument(
        "--mode",
        choices=("detail", "swap"),
        default="detail",
        help="detail 修细节；swap 为手动高级选项，不推荐用于换 LoRA 角色",
    )
    redraw.add_argument("--character")
    redraw.add_argument("--denoise", type=float)
    redraw.add_argument("--seed", type=int, help="指定可复现种子；省略时随机")
    inpaint = _common(subparsers.add_parser("inpaint", help="按 figures 局部修正人物细节"), "inpaint")
    inpaint.add_argument("panel")
    inpaint.add_argument("--character", required=True)
    inpaint.add_argument("--denoise", type=float, default=0.85)
    inpaint.add_argument("--margin", type=int, default=24)
    inpaint.add_argument("--feather", type=int, default=16)
    inpaint.add_argument("--seed", type=int, help="指定可复现种子；省略时随机")
    inpaint.add_argument(
        "--mask-only", action="store_true", help="只保存遮罩和叠加预览，不连接 ComfyUI 或提交采样"
    )
    panel_pick = _common(subparsers.add_parser("pick-panel", help="选定格子重画候选"), "pick-panel")
    panel_pick.add_argument("panel")
    panel_pick.add_argument("render")
    compose = _common(subparsers.add_parser("compose", help="拼页、斜切裁剪及叠加出格图层"), "compose")
    compose.add_argument("--cut-inset", type=float)
    compose.add_argument("--border-width", type=int)
    letter = _common(subparsers.add_parser("letter", help="程序绘制气泡和文字"), "letter")
    letter.add_argument("--font")
    letter.add_argument("--text", action="append", help="moss_text 页也可按文字 id 指定程序排字，可重复")
    cutout = _common(subparsers.add_parser("cutout", help="生成或导入透明出格人物并叠加"), "cutout")
    cutout.add_argument("overlay")
    cutout.add_argument("--png", help="已抠好的透明 PNG；使用此参数不调用 ComfyUI")
    cutout.add_argument("--seed", type=int, help="指定可复现种子；省略时随机")
    export = _common(subparsers.add_parser("export", help="按页序导出 PNG 或 PDF"), "export", page=False)
    export.add_argument("target", nargs="?", help="页 id、页 JSON、项目目录；省略时导出整个项目")
    export.add_argument("--format", choices=("png", "pdf"), default="png")
