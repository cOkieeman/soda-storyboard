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

除 `horizontal-rhythm` 保持 2～4 格外，其余 recipe 均扩展到 7 格。`vertical-rhythm` 在 4 格时为四个等高横条；`dialogue-stagger`、`ladder` 使用交替宽度形成错位构图。基础 recipe 保留矩形，另提供共享分割线的斜切变体。上游随机变体、语义技法建议、锁定、嵌套和出血修饰未移植，因为当前分镜模型没有对应语义输入。

```bash
uv run soda-storyboard template list --panels 5 --json
uv run soda-storyboard layout suggest --panels 5 --json
uv run soda-storyboard layout suggest --panels 5 --candidates 20 --preview-dir examples/station/layout-previews --json
uv run soda-storyboard layout suggest --page my-story/pages/page-01.json --pick hero-right --json
```

默认返回 6 个候选，同一 `family` 最多一个，混合矩形与斜切格；`--candidates` 调整数目，数量不超过可用家族数。先选各家族的适配候选，再按重要度排序；未指定重要度时覆盖网格、开场、对话、动作、电影横条和收尾家族。`--pick <template_id>` 精确选择一个，适用于同一家族中的其他 recipe。`--page` **直接写回所选候选的格子几何**（未指定 `--pick` 时取首项）；加 `--write-page <新路径>` 可另存，原页保留。写回按既有 `order` 匹配，保留 JSON 中所有其他字段和原有数组顺序；`--panels` 与页格数不同会报错。页面的画布、间距和阅读方向默认随页设置，也可用 `--gap`、`--direction` 覆盖求解设置。

候选里的格子含连续 `order` 和像素 `rect` / `quad` 几何。同一行 RTL 从右往左，LTR 从左往右；`hero-right` 在 LTR 下镜像到左侧，保持大格先读。重要度只影响候选排名，不调换格子的阅读位置。可把含归一化 `panels` 的 JSON 放入 `templates/`，通过 `--templates` 一并读取；自定义槽位按显式 `order` 或 RTL 阅读顺序排列，按 LTR 镜像，随后检查边界、真实多边形重叠和最短间距。自定义 quad 需自行包含留白。

## 斜切分镜

`layout suggest` 默认混合基础 recipe 和 `-skew` 变体（默认 8°）。`--skew 0` 只给矩形；`--skew 10` 只给 10° 斜切候选。`--pick hero-top-skew` 可指定斜切变体，基础 id 仍可选。`template list` 会列出基础及可用斜切变体；每个 3～7 格页至少提供两个斜切候选。

```bash
uv run soda-storyboard layout suggest --panels 5 --preview-dir examples/slanted/candidates --json
uv run soda-storyboard layout suggest --panels 5 --skew 10 --json
uv run soda-storyboard page skew my-story/pages/page-01.json --panels p1,p2 --angle 8
```

`page skew` 直接写回指定页，只替换选中格子的 shape，保留其他字段。选中格子必须是同一完整行或列的相邻矩形；中间不能漏选其他格子。`--axis vertical` 倾斜同行的竖分割线，`--axis horizontal` 倾斜同列的横分割线，默认自动识别。角度支持正负值，必须严格处于 -45°～45°；角度太大导致格子退化、越界或破坏间距时会报错，原文件不写入。四点按边界循环排列，可从任意顶点开始，但必须是非退化凸四边形。

变换保留整组外边界；相邻格共用平行的斜边，留白按斜线的垂直距离计算，不产生独立倾斜格子之间的大白楔。Python 库提供 `geometry.skew_rectangles(..., angle=8, gap=24, axis="auto")`。自定义矩形模板可加 `"skew": {"angle": 8, "axis": "vertical"}`，为其生成 `-skew` 变体；也可用数值简写角度。

## 斜切格编译与裁剪文件

```bash
uv run soda-storyboard compile examples/slanted/pages/platform-dash.json --output examples/slanted/platform-dash.moss.json
uv run soda-storyboard compile examples/slanted/pages/platform-dash.json --slant-mode hint --output examples/slanted/platform-dash.hint.json
uv run soda-storyboard compile examples/slanted/pages/platform-dash.json --slant-mode rect --json
```

`--slant-mode` 有三个值：

| 模式 | MOSS bbox | 提示词 | 旁路文件 |
| --- | --- | --- | --- |
| `cut`（默认） | 四条边中点界定的中线矩形，相邻格互不重叠 | 不自动添加斜切描述 | `<输出名>.cut.json` |
| `hint` | quad 内的最大面积轴对齐矩形，整数坐标向内取整 | summary 加斜分割线，object 加 `slanted panel` | 无裁剪文件 |
| `rect` | 原 quad 的外接矩形 | 不自动添加斜切描述 | 无裁剪文件，仅供调试，bbox 可能重叠 |

`cut` 的矩形连同白色格间距覆盖整行或整列；`panel_gap=0` 时直接拼接。MOSS 先按普通矩形生成，quad 留待第 3 阶段裁剪。`.cut.json` 记录画布、坐标系、每格的 `panel_id`、`order`、原 `shape` / `quad`、`generation_rect`（左上角像素 `x,y,x2,y2`）和与 MOSS 相同的中心原点整数 `bbox`。例如输出 `page.moss.json` 对应 `page.moss.cut.json`。不指定 `--output` 时，旁路文件写在输入页旁，如 `page.cut.json`。没有 quad 的页不生成裁剪文件。

`--with-ids` 保留原来的 item 辅助 ID，同时写出同名 `.map.json`，列出每格与出格图层。MOSS JSON 本身始终不包含 overlays。库函数 `compile_geometry_map(page, slant_mode="cut")` 可获得同样的映射数据。

对手工编辑的任意 quad，若中线矩形仍重叠，`cut` 会报错；可调整为共享分割线构图，或显式选 `rect` 查看外接矩形。`hint` 会在整数化后检查 bbox 有正面积，过窄的格子会报错。

## 人物出格图层

页文件可选新增 `overlays` 数组，旧文件不需要修改。每项结构如下：

```json
{
  "id": "dash",
  "panel_id": "p3",
  "character_id": "runner",
  "rect": {"type": "rect", "x": 130, "y": 420, "w": 310, "h": 340},
  "z_index": 2,
  "description": "人物从第 3 格冲出，盖住下方格子的边框。",
  "status": "planned",
  "image_path": null
}
```

`id`、`character_id`、`rect` 为必填字段；`panel_id` 可为 null，`image_path` 可为 null。`z_index` 默认为 1，正整数表示在格子上方，数值越大越靠前；`status` 为 `planned`（默认）或 `approved`。未知扩展字段读写保留。校验器检查重复 ID、引用、层级、状态和画布边界；overlay 可以跨越所属格子的边框，但不能超出画布，角色必须出现在提供的角色卡表中。

预览在所有格子上方绘制绿色虚线框并标注“出格”；当前只表示规划位置，不读取或合成 `image_path`。overlay 不参与格间重叠检查，也不进入 MOSS 提示词。透明人物图层的生成、quad 裁剪与最终叠加属于第 3 阶段。

完整示例位于 `examples/slanted/`：上排三个斜切格，下方两条横格，加一个跨格图层。

```bash
uv run soda-storyboard validate examples/slanted/pages/platform-dash.json --json
uv run soda-storyboard preview examples/slanted/pages/platform-dash.json --output examples/slanted/platform-dash.png
uv run soda-storyboard compile examples/slanted/pages/platform-dash.json --output examples/slanted/platform-dash.moss.json --with-ids
```

## 开发检查

```bash
uv run ruff format --check .
uv run ruff check .
uv run pytest
```
