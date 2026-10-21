# soda-storyboard

`soda-storyboard` 是一个轻量的 Python 分镜单工具：用 JSON 描述一页日漫分镜，校验格子几何和角色引用，生成 Pillow 人物/文字草稿预览，并编译成 MOSS-Image 的 Layout Prompt JSON。

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

编译器将坐标四舍五入为整数，并限制在 `±W/2`、`±H/2` 内。object caption 优先使用 `caption_en`，否则拼接英文景别、角度、格子位置、人物 `appearance_en` + `age` 和画面描述。每格应写完整外观；保留旧中文 description 作为兼容回退，不自动调用翻译服务。

文字独立为 `texts`，每个 item 输出 `label: "text"`、英文样式/位置 `caption`、原文 `text`、`bbox`。原文可含换行。kind 支持 dialogue / narration / sfx / title / caption_tag，bubble 支持 speech / shout / thought / box / none，另有可空 panel_id、speaker_id、direction、bbox、style_hint。源页 bbox 是左上角像素矩形 x/y/w/h，省略时自动估算；竖排宽=列数×字宽×1.3，高=每列字数×字高×1.15，横排交换轴。页面 `text_font_size` 默认 42（按 1024 宽画布，随画布宽等比缩放），`text_max_chars` 默认 10，超过即换列/行。框形明显不符方向会 warning。旧 dialogue 和 sfx 继续编译，迁移原文到 texts 后应移除对应旧条目以免重复。

项目和页面可加 `style_prompt`（英文画风段落）、`tags`（字符串数组）。页面有设置则覆盖项目；未给画风时，编译器提供按 color_mode 区分彩色/黑白的英文兜底。插件会先让用户选择画风并保存。summary 以画风段落开头，接页面说明、tags、阅读方向和留白要求，有文字时要求清晰中文，无文字或使用 lettering 时追加 `no text, no speech bubbles`。meta 为 comic、multi_panel，彩色再加 digital_painting；canvas 为 multi_panel。

默认画面 item 含 label、caption、bbox，文字额外含 text。`compile --with-ids` 保留调试 ID，并生成 `.map.json`，生产输出不推荐使用。项目和页面仍可设置 `text_direction`（默认 vertical）、`color_mode`（默认 monochrome）；旧 style_prefix 也保留。`--size-check` 的核对只出现在命令 `--json` 报告和 map 文件中，`--output` 文件只有 summary、items、bbox_coord_space、bbox_format 四个顶层字段。

## 人物与文字草稿

每格可选 `figures` 数组，指定 character_id、pose、position（0～1 或 left / center / right）、facing（left / right / front / back）、可空 framing（full / waist / bust / face）。缺省时按 character_ids 自动排开，RTL 第一个角色在右边；远景/全景画全身，中景到腰，近景到胸，特写画头。角色卡可加 age 和 figure_hint: skirt。

姿势预设为 stand、walk、run、sit、crouch、wave、point、arms_up、hands_clasped、hand_on_chin、lie、back_view；未知值 warning 并回退 stand。Pillow 绘制圆头十字参考线、躯干、四肢及角色名，裁在格子内，不调用图像模型。草稿稳定使用青色格子/格内人物、红色跨格人物/标题、绿色文字框，原文按方向绘制。

```bash
uv run soda-storyboard preview examples/pudding/pages/pudding.json --output examples/pudding/pudding.sketch.png --json
uv run soda-storyboard preview examples/pudding/pages/pudding.json --style boxes --output examples/pudding/pudding.boxes.png --json
uv run soda-storyboard compile examples/pudding/pages/pudding.json --output examples/pudding/pudding.moss.json --json
```

`preview` 默认 sketch；`--style boxes` 保留原纯框线版。`examples/pudding/` 是参考 JSON 的反向分镜示例，编译得到相同条目种类、数量、原文和 bbox，caption 可不同。为草稿每格都有人物，第 4 格把纯道具特写改成妹妹捧空布丁杯的特写；输出几何与条目结构仍保持参考一致。

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

`cut` 的矩形连同白色格间距覆盖整行或整列；`panel_gap=0` 时直接拼接。MOSS 先按普通矩形生成，quad 由生产流程的 compose 裁剪。`.cut.json` 记录画布、坐标系、每格的 `panel_id`、`order`、原 `shape` / `quad`、`generation_rect`（左上角像素 `x,y,x2,y2`）和与 MOSS 相同的中心原点整数 `bbox`。例如输出 `page.moss.json` 对应 `page.moss.cut.json`。不指定 `--output` 时，旁路文件写在输入页旁，如 `page.cut.json`。没有 quad 的页不生成裁剪文件。

`--with-ids` 保留原来的 item 辅助 ID，同时写出同名 `.map.json`，列出每格、独立文字与出格图层。MOSS JSON 不包含 overlays 顶层字段，moss 模式会输出 character item。库函数 `compile_geometry_map(page, slant_mode="cut")` 可获得同样的映射数据。

对手工编辑的任意 quad，若中线矩形仍重叠，`cut` 会报错；可调整为共享分割线构图，或显式选 `rect` 查看外接矩形。`hint` 会在整数化后检查 bbox 有正面积，过窄的格子会报错。

## 人物出格图层

页文件可选新增 `overlays` 数组，旧文件不需要修改。每项结构如下：

```json
{
  "id": "dash",
  "mode": "layer",
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

overlay 新增 `mode`：新建时应显式写 `moss`（Python Overlay 构造默认值），预览用红色大号人物，编译为 `label: "character"` 让 MOSS 直接画出跨格人物；`layer` 保留原有绿色虚线框和后期叠加规划。旧 JSON 缺省 mode 仍读成 layer，以保持兼容。两者都不参与格间重叠检查；preview 不读取 image_path，生产流程通过 cutout / compose 生成、裁剪和叠加图层。

跨格主角是可选手法，多数页没有；仅在人物登场、情绪高潮或强调人物时提议并说明理由，日常对话、动作戏默认普通格子。斜切“先生成再裁”实测效果有限，功能保留。JSON 写法比底模和步数更影响成图；Base、SFT 都可用，SFT 偶有手部问题，草稿可用 25 步、定稿 50 步质量档。直接驱动 ComfyUI 的命令见下方“出图”章节。

完整示例位于 `examples/slanted/`：上排三个斜切格，下方两条横格，加一个跨格图层。

```bash
uv run soda-storyboard validate examples/slanted/pages/platform-dash.json --json
uv run soda-storyboard preview examples/slanted/pages/platform-dash.json --output examples/slanted/platform-dash.png
uv run soda-storyboard compile examples/slanted/pages/platform-dash.json --output examples/slanted/platform-dash.moss.json --with-ids
```

## 安装插件（Codex 优先，Claude Code 兼容）

插件包根目录是 `skill/`，共用文件为 `skill/skills/soda-storyboard/SKILL.md`。这与早期计划中的 `skill/SKILL.md` 不同，是为遵守官方的 `skills/<名称>/SKILL.md` 结构；示例对话仍在 [skill/examples/station-dialogue.md](skill/examples/station-dialogue.md)。包内附带格式 schema、中文知识笔记及完整 NOTICE，不依赖安装后还能访问本仓库的 docs。插件调用本地 CLI，无需账号登录；确认分镜后可通过 CLI 连接本机 ComfyUI 生成图片。

### 前置条件与命令行安装

需要 Python 3.12+、uv，以及支持本地插件的 Codex 桌面端或 Claude Code。以下命令由用户自行执行，本任务不会修改全局配置。PowerShell 示例（macOS/Linux 按相同路径含义换成自己的 shell 写法）：

```powershell
Set-Location "E:/个人开发项目/soda-storyboard"
uv sync --all-groups
uv tool install --editable . --python 3.12
soda-storyboard --help
```

uv tool 的可执行目录需已加入 PATH；不在 PATH 时，按 uv 给出的提示处理。也可仅用 `uv run --directory "<仓库绝对路径>" soda-storyboard`，但这会切换工作目录，故事项目、页面、图片和输出路径都应改为绝对路径，避免写进仓库或插件缓存。CLI 安装和插件安装是两个步骤，安装 skill 不会自动安装 Python 程序。

### Codex 安装、启用、调用与更新

`skill/plugin.json` 使用官方推荐的 portable Agent Plugins 清单；`skill/.codex-plugin/plugin.json` 提供仍受支持的 Codex 兼容清单。两者都指向同一个标准 skills 目录；这是需要本地执行器的桌面插件，不是网页端纯对话插件。

包内 `skill/.agents/plugins/marketplace.json` 定义一个本地 marketplace，其 `source.path` 为相对于该 marketplace 根目录的 `./`。使用完整包目录作为根，而不是把 `.agents/plugins` 当根：

```powershell
codex plugin marketplace add "E:/个人开发项目/soda-storyboard/skill"
```

随后重启 Codex 桌面端，打开 Plugins Directory，选择“Soda Storyboard 本地插件”来源，安装并启用 Soda Storyboard，再开新聊天。桌面端可在输入框用 `@` 选择该 skill；Codex CLI/IDE 可用 `/skills` 找到它或用 `$soda-storyboard` 显式调用。名称可能带插件命名空间，以界面实际显示为准，也可以直接说“用 Soda Storyboard 帮我拆一页分镜”。

部分 Codex CLI 版本提供 `codex plugin add soda-storyboard@soda-storyboard-local --json`；本机 `codex plugin add --help` 已确认该命令存在。不过当前官方打包指南仍推荐桌面端安装、测试本地插件，因此以以上桌面流程为主，不能把 CLI 子命令存在当成桌面已加载的证明。

更新时先更新本地仓库、重新执行 uv sync；可编辑 CLI 会使用新源码。更新 marketplace 指向的 `skill/` 内容后，按官方本地插件说明重启桌面端，在目录中确认版本并重新开聊天。若宿主使用缓存副本而仍显示旧版本，在目录中重新安装该本地插件；不要只刷新当前对话就认为缓存已更新。发布新包时应同步提升三份 manifest 的 version。

### Claude Code 安装、启用、调用与更新

`skill/.claude-plugin/plugin.json` 是 Claude Code 的独立适配清单，自动发现同一份 `skills/soda-storyboard/SKILL.md`，没有复制一套工作流。先在 shell 临时加载一个会话，不必安装：

```powershell
claude --plugin-dir "E:/个人开发项目/soda-storyboard/skill"
```

会话中输入 `/soda-storyboard:soda-storyboard` 调用；也可自然语言请求。临时加载更新后重新启动该命令即可。需要持久安装时，在自己的故事项目目录执行以下用户操作（不要在插件缓存里执行）：

```powershell
claude plugin marketplace add "E:/个人开发项目/soda-storyboard/skill"
claude plugin install soda-storyboard@soda-storyboard-local --scope local
```

再新开 Claude Code，或在已有交互会话执行 `/reload-plugins`。如插件已被禁用，可执行 `claude plugin enable soda-storyboard@soda-storyboard-local --scope local`。本地 scope 只为当前项目的当前用户启用；不修改团队共享设置。更新本地仓库后执行 `claude plugin update soda-storyboard@soda-storyboard-local`，再 `/reload-plugins` 或新开会话。也可始终使用临时 `--plugin-dir`，避免持久安装。

可用 `claude plugin validate "E:/个人开发项目/soda-storyboard/skill"` 检查清单。此检查和动态加载仍需用户机器上安装 Claude Code；开发环境中没有该可执行文件。

### 最短使用示例

“用 Soda Storyboard 帮我把‘女孩在车站听见熟悉的声音，回头却没说出口’拆成一页日漫，先给我几个方案。”

AI 会先让你选拆格，再展示 4～6 张版式线框供选择，之后逐格调整。可以说“只把第 3 格改成从背后看”；你确认整页满意后，才编译并给出要粘进 Soda-MOSS v2“JSON直通”框的布局 JSON。风格前缀由你指定，插件不会擅自补风格。你也可以同意由插件直接调用本机 ComfyUI 出草稿，再逐步进行重画、裁剪、排字和出格图层叠加。

### 新增角色管理

```shell
soda-storyboard character new --project my-story --id girl --name "澪" --lora "models/girl.safetensors" --outfit "浅色校服" --reference "refs/front.png" --json
soda-storyboard character set girl --project my-story --lora-strength 0.75 --appearance-zh "黑色短发" --json
soda-storyboard character list --project my-story --json
```

`new` 新建 LoRA 默认强度为 0.8；`set` 的 id 是位置参数，只改给出的字段。改路径而没给强度时保留已有强度；没 LoRA 不能单设强度。trigger、outfit、reference 都可重复，set 时用给出的整个列表替换，未给列表原样保留。set 按角色 id 查找，不要求文件名与 id 相同，也不会为不存在的角色新建文件。LoRA 和参考图路径只保存，不搜索或读取对应模型/图片。

### 文档来源与验证边界

官方文档查阅日期：**2026-10-21**。清单结构、路径边界、安装与调用方式依据下列已读取页面，未按记忆猜格式：

- [OpenAI：Package your plugin](https://developers.openai.com/plugins/build/plugins)：portable 清单、Codex 兼容清单、本地 marketplace、桌面安装与更新。
- [OpenAI：Agent Skills](https://developers.openai.com/codex/skills/)：标准 SKILL.md、技能发现与调用；[桌面专用插件](https://developers.openai.com/plugins/deploy/desktop-only)：requires_local_executor。
- [Claude Code：插件清单](https://code.claude.com/docs/en/plugins-reference)：独立清单、标准目录、路径约束与 validate。
- [Claude Code：安装管理](https://code.claude.com/docs/en/discover-plugins)：plugin-dir、local scope、reload、启用与更新。

本轮实际验证包括官方 skill-creator 静态校验、清单路径与身份一致性、包内引用和 schema、自文档提取的全部 CLI 命令与 argparse 严格核对、示例 JSON 的逐格修改和编译，以及角色读写测试。当前宿主没有实际安装/加载这个新插件：本任务禁止修改全局配置，且当前聊天不能据此证明新会话的插件发现；Claude Code 也未安装。以上替代验证不等于动态宿主验收，最终应由用户按安装步骤在新聊天中确认名称出现、能调用且会停在三个确认点。

## 出图

需要本机 ComfyUI（默认 `http://127.0.0.1:8190`）及 MOSS 模型。程序通过 HTTP 提交、轮询、上传和下载，不需要 requests / websocket。以下 `my-story` 是已有故事项目目录，`station-turn` 是页面 id，也可传 `my-story/pages/station-turn.json`。

```shell
uv run soda-storyboard comfy config --project my-story --url http://127.0.0.1:8190 --model sft --preset draft --backend minimal --json
uv run soda-storyboard comfy check --project my-story --json
```

`comfy config` 不带设置参数时查看配置；配置存入 `project.json` 的 `comfy`。可用 `--base` / `--sft` 改对应 UNET 文件名，用 `--clip` / `--vae` 改编码器和 VAE，用 `--timeout` 设置轮询超时秒数（默认 600），`--poll-interval` 设置轮询间隔（默认 1 秒）。模型文件名相对 ComfyUI 对应模型目录；默认值为：

- SFT：`MOSS-Image\MOSS-Image-SFT\moss_image_sft_int8_convrot.safetensors`。
- Base：`MOSS-Image\MOSS-Image-Base\moss_image_base_int8_convrot.safetensors`。
- CLIP：`qwen3.5_9b_w4a8_gptq.safetensors`（moss_image 类型）。
- VAE：`flux2-vae.safetensors`。

`comfy check` 只读取 `/object_info` 检查当前后端节点、模型及角色 LoRA 文件列表，不提交任务。无法连接、节点或模型缺失时输出中文原因并返回状态码 2；服务端报错保留原文。自定义节点未公开文件列表时会报告“无法确认”。

| 预设 | 步数 | 采样器 / 调度器 | CFG | SLG | 1024×1536 参考耗时 |
| --- | --- | --- | --- | --- | --- |
| draft | 25 | er_sde / simple | 2.5 | 无 | 每张约 40 秒 |
| final | 50 | euler / simple | 3 | single_layers=22 | 每张约 80 秒 |

默认 minimal 使用最小节点图。可选 v2 后端通过 `comfy config --backend v2 --workflow` 导入用户指定的 API JSON：程序填入布局、尺寸、种子、模型、质量参数和输出路径，插入单个 LoRA，清空原人物堆叠并关闭 SeedVR2。导入的是 API 格式，不是前端画布格式；参考节点表在 `docs/tasks/refs/README.md`。单格重画始终使用 minimal。

```shell
uv run soda-storyboard comfy config --project my-story --backend v2 --workflow workflows/soda-moss-api.json --json
uv run soda-storyboard gen page station-turn --project my-story --seeds 4 --preset draft --model sft --lora auto --json
uv run soda-storyboard pick station-turn render.png --project my-story --json
uv run soda-storyboard plan station-turn --project my-story --json
```

gen 自动编译，不要求预先 compile。`--seeds N` 表示候选数量，每张随机选一个具体种子；preset 省略时 CLI 使用项目默认值。model 可选 base、sft 或自定义模型文件名；`--lora auto` 默认选出场最多的带 LoRA 角色（同票按 id），也可指定角色 id 或 none。一次最多加载一个人物 LoRA。结果存到 `pages/<页id>/renders/<时间>_<种子>.png`，记录种子、预设、模型、LoRA 和编译 JSON 哈希；返回 `meta.candidate_sheet` 是并排标种子的候选拼图。pick 的 render 参数换成返回的真实路径或唯一文件名；不接受未登记的图片。

plan 可在选图前查看，选图后会列出需要换人的格子及角色、swap / inpaint 模式、斜切、出格图层和排字。不同候选可以随时重新 pick，旧格子选择和派生页会失效；候选记录仍保留。

```shell
uv run soda-storyboard split station-turn --project my-story --json
uv run soda-storyboard redraw station-turn p3 --project my-story --mode detail --json
uv run soda-storyboard redraw station-turn p3 --project my-story --mode swap --character girl --denoise 0.85 --json
uv run soda-storyboard inpaint station-turn p1 --project my-story --character girl --denoise 0.85 --margin 24 --feather 16 --json
uv run soda-storyboard pick-panel station-turn p3 panel-render.png --project my-story --json
uv run soda-storyboard compose station-turn --project my-story --cut-inset 12 --border-width 3 --json
uv run soda-storyboard letter station-turn --project my-story --json
uv run soda-storyboard cutout station-turn hero --project my-story --json
uv run soda-storyboard cutout station-turn hero --project my-story --png refs/hero-transparent.png --json
uv run soda-storyboard export station-turn --project my-story --format png --json
uv run soda-storyboard export my-story --format pdf --json
```

- split 按 bbox 切格，quad 使用外接矩形，并单独保存 quad-mask；文件放在 `pages/<页id>/panels/<格id>/`。
- redraw 的 detail 默认 denoise=0.45，swap 默认 0.85，swap 仅适用于单人格；两人同格使用 inpaint。单格提示词不带整页前缀。moss_text 下生成后贴回原文字框，防止高降噪改字。每次生成是独立候选，pick-panel 后才用于拼页。
- inpaint 按 figures 位置、余量和羽化生成遮罩，羽化后再次保护另一角色区域；支持 `figure.bbox` 精确指定人物范围（页面坐标 x/y/w/h）。返回 mask 路径供检查。位置推断不能替代真实人物分割，重叠人物需要人工调整范围。
- compose 输出 `composed.png`；把选定格子贴回底图，quad 向内缩进默认 12 像素、外部填白并重画格框。默认缩进和边框可通过 comfy config 持久设置。
- letter 输出 `lettered.png`，支持椭圆 speech、锯齿 shout、云形 thought、矩形 box 和无气泡 none，以及横排／竖排。按 Noto Sans CJK SC、思源黑体、微软雅黑顺序找字体，可用 `--font` 指定。默认处理 lettering 页或 `texts[].render_mode: "lettering"`；moss_text 页可重复传 `--text t1` 指定程序排字。
- cutout 只处理 mode=layer 的 overlay，使用角色 LoRA 和单人纯色背景提示词；先检查 BiRefNetRMBG、RMBG、Image Remove Background (rembg)。均缺失时提示安装 ComfyUI-RMBG / rembg，也可 `--png` 导入透明 PNG。抠图节点的必填参数需有默认值或枚举值，且需返回含 alpha 的 IMAGE；否则提示提供透明 PNG。图层按 z_index 置于文字之上，重新生成可用的 composed / lettered 成品。
- export 接受页 id、页 JSON 路径或项目目录，PNG 每页一张，PDF 合成一份。按 `project.json.pages` / `page_ids` 的声明顺序导出（字符串 id 或含 id/page_id 的对象）；未声明时按页面 order/page_number 再按自然 id 顺序。优先有效的 lettered，再 composed，最后选定底图，输出在 `exports/`。

所有生成命令先在 stderr 说明数量和参考耗时，`--json` 的 stdout 仅含结构化结果；超时提示任务号，服务端任务可能仍在运行，不自动重提。公共接口在 `production/api.py`，不打印、不读取 CLI 参数，可供 P4a 调用。开发测试使用标准库假服务器，不连接真实 ComfyUI，也不占用显卡；真实模型质量、显存及自定义抠图节点兼容性需在用户机器验收。

## 从参考页提取版式

```shell
uv run soda-storyboard layout extract reference.png --direction rtl --preview reference-overlay.png --json
uv run soda-storyboard layout extract reference.png --name "喜欢的分格" --save --project my-story --json
uv run soda-storyboard layout suggest --panels 5 --templates my-story/templates --json
```

默认只识别，预览写在原图旁的 `<文件名>.layout-preview.png`；支持 PNG / JPG / WebP，默认日漫从右往左，`--direction ltr` 改为从左往右。结果的 `shape` 是原图像素坐标，`normalized` 是 0～1 坐标，另含阅读顺序、形状和 confidence。预览里绿色实线表示可靠格框，橙色虚线表示低置信度，数字表示阅读顺序。先看叠加图确认，再用 `--save` 保存。

模板写入 `<项目>/templates/`，只包含几何、原图文件名、UTC 识别日期和格数，**不复制原图**。每次保存创建新模板，不覆盖已有模板。`layout suggest --templates` 会优先展示标有“来自参考页”的候选，也可用返回的 template_id 配合 `--pick` 选择。模板的阅读方向会随目标页方向调整；矩形和四边形都会按目标 gap 向内缩进。合成测试页和叠加图见 `examples/layout-extract/`，可用 `uv run python examples/layout-extract/generate_samples.py` 重建。

算法只使用 Pillow 和标准库：缩到长边最多 800 像素、中值去噪、自动灰度阈值、留白投影递归 XY 切分、连通格框凸包及四角直边拟合。排除面积小于 1.5% 的区域和圆形/嵌套气泡；不可靠的近似格框退回矩形并降低置信度。适合具有可见格框和留白的页面；无框、严重破损/重叠格框、跨格插画、复杂标题装饰、明显透视和大角度旋转可能漏检或误检，需要人工确认。单图上限 3200 万像素。

角色卡可选 `role_en`（CLI `character new/set --role-en "the older sister"`），文字 caption 优先用它，否则用 display_name。程序排字和草稿图共用竖排标点与均衡分列，显式换行保留；连续英文和数字整体缩放横排，两位数字占一个竖中横排单元。`.cut.json` 的像素坐标四舍五入到整数。

## 开发检查

```bash
uv run ruff format --check .
uv run ruff check .
uv run pytest
```
