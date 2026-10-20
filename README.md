# soda-storyboard

`soda-storyboard` 是一个轻量的 Python 分镜单工具：用 JSON 描述一页日漫分镜，校验格子几何和角色引用，生成 Pillow 线框预览，并编译成 MOSS-Image 的 Layout Prompt JSON。

## 安装与运行

```bash
uv sync --all-groups
uv run soda-storyboard init my-story
uv run soda-storyboard validate examples/station/pages/station-turn.json --json
uv run soda-storyboard preview examples/station/pages/station-turn.json --output /tmp/station.png
uv run soda-storyboard compile examples/station/pages/station-turn.json --output /tmp/station.moss.json
```

也可以直接运行 `python -m soda_storyboard`。CLI 的 `--json` 会输出机器可读结果。

## 文件格式

项目目录包含 `project.json`、`pages/*.json`、`characters/*.json` 和可选的 `templates/*.json`。页文件使用 `soda-storyboard-page-v1`，画布尺寸必须是 16 的倍数。格子的 `shape` 支持左上角原点像素坐标的 `rect` 和四点 `quad`。`order` 从 1 连续编号；`dialogue_mode` 为 `moss_text` 时台词会编译为文字 item，`lettering` 时只编译画面 object。

角色卡可以记录触发词、LoRA 路径和强度、中文/英文外观、服装及参考图。校验器会报告越界、重叠、间距、顺序、台词长度、未知角色和多 LoRA 风险。

## MOSS bbox 规则

输出始终包含：

```json
{"bbox_coord_space": "abs_centralized", "bbox_format": "yxyx"}
```

每个 bbox 的顺序是 `[y_min, x_min, y_max, x_max]`。输入使用左上角原点；编译时减去画布中心 `(W/2, H/2)`，因此非方形画布也能保持正确的 x/y 顺序。

## 版式模板

`layout suggest --panels 5` 会给出大格开场、一大多小、横长条分段等候选；重要度较高的格子会优先占用面积更大的槽位。用户可以把同格式 JSON 放入项目的 `templates/` 目录，求解时会一并读取。

## 开发检查

```bash
uv run ruff format --check .
uv run ruff check .
uv run pytest
```
