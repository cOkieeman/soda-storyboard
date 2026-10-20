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

也可以直接运行 `python -m soda_storyboard`。CLI 的 stdout/stderr 始终使用 UTF-8，`--json` 会输出机器可读结果，Windows 默认 GBK 终端下也可按 UTF-8 解码。

## 文件格式

项目目录包含 `project.json`、`pages/*.json`、`characters/*.json` 和可选的 `templates/*.json`。页文件使用 `soda-storyboard-page-v1`，画布尺寸必须是 16 的倍数。格子的 `shape` 支持左上角原点像素坐标的 `rect` 和四点 `quad`。`order` 从 1 连续编号；`dialogue_mode` 为 `moss_text` 时台词会编译为文字 item，`lettering` 时只编译画面 object。

角色卡可以记录触发词、LoRA 路径和强度、中文/英文外观、服装及参考图。校验器会报告越界、重叠、间距、顺序、台词长度、未知角色和多 LoRA 风险。

## MOSS bbox 规则

输出始终包含：

```json
{"bbox_coord_space": "abs_centralized", "bbox_format": "yxyx"}
```

每个 bbox 的顺序是 `[y_min, x_min, y_max, x_max]`。输入使用左上角原点；编译时减去画布中心 `(W/2, H/2)`，因此非方形画布也能保持正确的 x/y 顺序。

编译器将坐标四舍五入为整数，并限制在 `±W/2`、`±H/2` 内。object caption 使用 `Panel N, close-up, eye-level: ...`；text caption 使用 `A white vertical speech bubble with Chinese text "……是你？"`，并按类型生成喊叫、思考或旁白框。summary 包含画风、整页说明和逐格简短景别；没有台词或使用 `lettering` 时追加 `no text, no speech bubbles`。

默认 item 只含 `label`、`caption`、`bbox`。`compile --with-ids` 可加回 `panel_id`、`speaker_id`，此模式适合调试，不建议直接交给 MOSS。项目和页面可设置 `text_direction`（`vertical`，默认；或 `horizontal`）、`color_mode`（`monochrome`，默认；或 `color`），页面覆盖项目设置。`page new` 也提供对应的 `--text-direction`、`--color-mode` 参数。

## 版式模板

版式几何移植自 manga-blueprint-studio 的 `layout-recipes.mjs`，完整 MIT 文本和移植边界见 [NOTICE](NOTICE)。保留上游 id、日文名、family、tags、hero 位置、说明和原始适用范围，新增中文名、中文说明与 `supported_panel_counts`。原始 14 个 recipe 全部移植；几何使用固定比例（上游 `mutation=0`），以下为原始范围：

| template_id | 中文名 | 日文名 | 原始格数 |
| --- | --- | --- | --- |
| balanced-grid | 均衡网格 | 均整グリッド | 1～6 |
| vertical-rhythm | 全宽横条纵向堆叠 | 縦リズム | 2～6 |
| horizontal-rhythm | 横向连续 | 横連続 | 2～4 |
| hero-bottom | 下段大格收尾 | 下段大ゴマ | 2～6 |
| hero-top | 上段大格开场 | 上段大ゴマ | 2～6 |
| hero-right | 阅读起点大格加侧边堆叠 | 右大ゴマ＋左積み | 2～5 |
| dialogue-stagger | 对话错位 | 会話段違い | 3～6 |
| action-step | 动作递进 | アクション段階 | 3～6 |
| detail-payoff | 细节到高潮 | ディテール→見せ場 | 3～6 |
| quiet-build | 安静铺陈 | 静かな積み上げ | 3～6 |
| wide-middle | 中央宽格 | 中央ワイド | 3～5 |
| ladder | 阶梯节奏 | 階段リズム | 4～6 |
| three-band | 三段构成 | 三段構成 | 3～6 |
| cinematic-stack | 电影横条堆叠 | シネマ縦積み | 2～6 |

除 `horizontal-rhythm` 保持 2～4 格外，其余 recipe 均扩展到 7 格。`vertical-rhythm` 在 4 格时为四个等高横条；`dialogue-stagger`、`ladder` 使用交替宽度形成错位构图。保留稳定矩形，不施加独立斜切。上游随机变体、语义技法建议、锁定、嵌套、出血和破格修饰未移植，因为当前分镜模型没有对应语义输入。

```bash
uv run soda-storyboard template list --panels 5 --json
uv run soda-storyboard layout suggest --panels 5 --json
uv run soda-storyboard layout suggest --panels 5 --candidates 20 --preview-dir examples/station/layout-previews --json
uv run soda-storyboard layout suggest --page my-story/pages/page-01.json --pick hero-right --json
```

默认返回 4 个候选；`--candidates` 调整数目，`--pick <template_id>` 精确选一个。`--page` **直接写回所选候选的格子几何**（未指定 `--pick` 时取首项）；加 `--write-page <新路径>` 可另存，原页保留。写回按既有 `order` 匹配，保留 JSON 中所有其他字段和原有数组顺序；`--panels` 与页格数不同会报错。页面的画布、间距和阅读方向默认随页设置，也可用 `--gap`、`--direction` 覆盖求解设置。

候选里的格子含连续 `order` 和像素矩形。同一行 RTL 从右往左，LTR 从左往右；`hero-right` 在 LTR 下镜像到左侧，保持大格先读。重要度只影响候选排名，不调换格子的阅读位置。可把含归一化 `panels` 矩形的 JSON 放入 `templates/`，通过 `--templates` 一并读取；自定义槽位按 RTL 阅读顺序排列、按 LTR 镜像，随后检查边界、重叠和间距。

## 开发检查

```bash
uv run ruff format --check .
uv run ruff check .
uv run pytest
```
