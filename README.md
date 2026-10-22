# soda-storyboard

`soda-storyboard` 是一个轻量的 Python 分镜单工具：用 JSON 描述一页日漫分镜，校验格子几何和角色引用，生成 Pillow 人物/文字草稿预览，并编译成 MOSS-Image 的 Layout Prompt JSON。

## 安装

需要 Python 3.12+、[uv](https://docs.astral.sh/uv/) 和支持本地插件的 Codex 桌面端或 Claude Code。网页编辑器已随 Python 包发布，**不需要 Node，也不需要手动构建前端**。只有出图需要另外运行 ComfyUI 并准备 MOSS 模型；拆分镜、草稿和网页编辑可独立使用。

```powershell
uv tool install git+https://github.com/cOkieeman/soda-storyboard
soda-storyboard --help
```

uv 尚未找到 Python 3.12+ 时，可在安装命令末尾加 `--python 3.12`。安装后在新终端检查命令可用。更新使用同一条安装命令并加 `--force`。Git 安装需要 Git 和网络；本轮只做了离线构建与本地验证，没有在线验证从 GitHub 安装。

如果安装器提示工具目录不在 PATH，运行 `uv tool update-shell`，关闭并重开终端后再检查。也可直接使用安装器显示的工具目录下 `soda-storyboard.exe` 的绝对路径运行 `--help`（其他系统使用对应可执行文件）。不要将“包安装成功”当成当前终端已能找到命令。

### 在 Codex 和 Claude Code 中启用插件

Python CLI 和宿主插件分别安装。获取仓库中的 `skill/` 文件夹（例如下载 GitHub ZIP 并解压，或用下列命令），保留其中的隐藏清单目录；不需要构建前端。

```powershell
git clone https://github.com/cOkieeman/soda-storyboard
```

在 Codex 中，将下面路径换成实际解压/克隆后的绝对路径：

```powershell
codex plugin marketplace add "C:/你的目录/soda-storyboard/skill"
codex plugin add soda-storyboard@soda-storyboard-local
codex plugin list
```

重启 Codex 桌面端，在 Plugins Directory 选择“Soda Storyboard 本地插件”来源，安装并启用 Soda Storyboard，再开新聊天。输入 `@` 找到插件技能；CLI/IDE 可用 `/skills` 或 `$soda-storyboard` 调用，名称以宿主界面为准。

上面的命令行方式可代替目录中的安装操作。`plugin add` 的格式是 `插件名@市场id`，本仓库市场 id 为 `soda-storyboard-local`；以添加市场源后的实际结果为准。`plugin list --json` 可核对 `installed`（文件已安装）和 `enabled`（宿主已启用）。这两项不证明旧聊天已加载：重启宿主并开新会话，能在 `@` 或技能列表中选择并调用，才完成“新会话已加载”的检查。已安装时在目录中核对状态即可，不必重复安装。

Claude Code 需要先安装 Claude Code CLI，并确认 `claude --help` 可用，然后可以临时加载：

```powershell
claude --plugin-dir "C:/你的目录/soda-storyboard/skill"
```

在会话中输入 `/soda-storyboard:soda-storyboard`。需要为故事项目持久启用时，在故事项目目录执行：

```powershell
claude plugin marketplace add "C:/你的目录/soda-storyboard/skill"
claude plugin install soda-storyboard@soda-storyboard-local --scope local
```

重新开会话或执行 `/reload-plugins`。两种宿主共用同一份 SKILL.md；Python 工具负责本地文件和服务，插件负责讨论流程。宿主安装步骤沿用仓库已有的官方文档核对结果，本轮受离线约束未重新联网核实或在新宿主会话动态加载。

### 从一个片段到打开编辑器、出图

1. 在新聊天说：“用 Soda Storyboard 把姐妹争最后一杯布丁拆成一页漫画，先给我几个方案。”按提示选择画风、拆格和版式，AI 保存故事项目。
2. 说“打开这一页的网页编辑器”。AI 执行 `soda-storyboard edit my-story --detach --page page-01 --json`（换成实际目录和页 id），浏览器直接选中该页。你可以拖格子、人物和文字框，修改自动写回磁盘。
3. 网页显示保存完成后，说“我在网页改过了，继续”。AI 必须重读页文件，再修改和预览。整页确认后可编译 MOSS JSON，或按下方“出图”配置 ComfyUI，明确同意候选数量后生成，例如“出 4 张 draft 候选”。

无需 AI 也可直接使用：

```powershell
soda-storyboard init my-story --json
soda-storyboard page new --project my-story --id page-01 --json
soda-storyboard edit my-story --detach --page page-01 --json
soda-storyboard edit my-story --stop --json
```

### 编辑器服务

edit 的项目目录默认是当前目录，端口默认 8780；同项目服务会复用，端口被其他项目或程序占用时自动换空闲端口。--no-browser 只输出地址；--detach 在后台启动并立即返回，适合 AI 调用。不加 --detach 时命令会等待服务结束，可按 Ctrl+C 停止。

--json 启动结果含 url、port、pid、reused。`.soda/server.json` 保存运行状态，--stop 用 `/api/health` 核对项目绝对路径、PID 和启动实例后才停止；不匹配时只提示。init 会生成 `.soda/.gitignore`，旧项目第一次 edit 时补上；运行状态不应提交。用户不再需要编辑器时可让 AI 关闭服务。

CLI 输出 UTF-8，也支持 `python -m soda_storyboard`。文件接口与网页共用项目 JSON；本阶段不接 Soda Prompt Hub。

## 文件格式

几何校验默认容差为 0.5 像素，覆盖格间距、越界和多边形重叠，避免网页小数舍入产生误报；宽高仍必须为正、四边形仍必须非退化且为凸多边形。页文件可设置 `geometry_tolerance`，CLI `validate --geometry-tolerance` 可覆盖；设为 0 使用严格几何检查。斜切生成顶点保留两位小数，生成器用 0.02 像素误差预算检查这种舍入，保存/校验时使用上述统一容差。

项目目录包含 `project.json`、`pages/*.json`、`characters/*.json` 和可选的 `templates/*.json`。页文件使用 `soda-storyboard-page-v1`，画布尺寸必须是 16 的倍数。格子的 `shape` 支持左上角原点像素坐标的 `rect` 和四点 `quad`。`order` 从 1 连续编号；`dialogue_mode` 为 `moss_text` 时台词会编译为文字 item，`lettering` 时只编译画面 object。

角色卡可以记录触发词、LoRA 路径和强度、中文/英文外观、服装及参考图。校验器会报告越界、重叠、间距、顺序、台词长度、未知角色和多 LoRA 风险。

## MOSS bbox 规则

输出始终包含：

```json
{"bbox_coord_space": "abs_centralized", "bbox_format": "yxyx"}
```

每个 bbox 的顺序是 `[y_min, x_min, y_max, x_max]`。输入使用左上角原点；编译时减去画布中心 `(W/2, H/2)`，因此非方形画布也能保持正确的 x/y 顺序。

编译器将坐标四舍五入为整数，并限制在 `±W/2`、`±H/2` 内。caption 以几何计算的方位和形状开头（如 `Top-right horizontal panel:` / `右上横格：`），再按“景别和角度 → 人物外观、姿势、朝向 → 场景 → 道具和氛围”整理，移除格号前缀，去重名字、服装和触发词，统一标点。人物姿势和场景描述冲突时，校验与检查器给出提醒，不自动改剧情。每个人物另编译为 `label: "character"` 条目；有 `editor` 数据时，bbox 取草稿骨架的外接框，包含关节、位置、大小、镜像和出框设置，局部换人遮罩共用该几何。

中文编辑，默认英文出图：项目 `caption_language` 默认 `en`，也可选 `zh`。每格 `caption_auto_en` 保存 `text`、中文来源 `source_hash` 和 `translated_at`。新鲜译文用于场景 caption，人物使用英文姿势模板及已有 `appearance_en`；缺失或过期时该格退回整理后的中文并警告。文字条目的台词和旁白始终保留原文。编辑器预览显示实际语言、译文状态和冲突提醒，修改中文后立即标记过期。方位不参与 `source_hash`，只移动格子不会过期；手动覆盖保留原文并提示建议以方位开头。镜头合并成 `<方位>: <景别>, <角度>. <人物及场景>.`；特写和大特写不自动追加全身姿势。

翻译由使用插件的 AI 完成，核心库不调用服务。可配置项目 `glossary`（如 `{"猫胡子": "cat whiskers"}`）：

```powershell
soda-storyboard translate my-story/pages/page-01.json --todo --json
# AI 根据清单、英文外观、姿势模板与术语表生成 translations.json
soda-storyboard translate my-story/pages/page-01.json --apply translations.json --json
```

`--todo` 额外提供 `position_en` 供核对方位，AI 不将它写入译文；编译器根据当前几何自动拼接。格式变化本身不改变中文语义哈希，旧英文镜头前缀可自动规范；特写姿势省略改变了源语义时会正常要求重译。

译文文件格式为 `{"translations": [{"panel_id": "p1", "source_hash": "清单中的哈希", "text": "English visual description."}]}`；哈希不符的格子拒绝写入。旧文件无需升级，缺少缓存时仍可编译中文。旧 `caption_en` 保留，只有 `use_custom_caption: true` 或页面 `legacy_caption_en: true` 才启用，手动覆盖优先级最高。

离线语言 A/B 只写两份相同几何的 MOSS JSON，禁用手动覆盖，使用整理后中文和缓存英文，不提交任务：

```powershell
uv run python scripts/ab_caption_lang.py my-story/pages/page-01.json --translations translations.json --output-dir my-story/ab
```

输出 `page-01.zh.moss.json` 和 `page-01.en.moss.json`。未提供新鲜译文的英文分支会警告并回退中文；兼容 `--english-page <翻译副本>`。

stdout 编译的附属文件保存为 `pages/<id>/<id>.cut.json` 和 `<id>.map.json`；显式 `--output` 继续保存在输出 JSON 旁。编辑器忽略 `pages/` 中非法页面 id 和 `.cut.json`、`.map.json` 等附属文件。

### 外来分镜与自由画布

```powershell
soda-storyboard import external.json --project my-story --page-id imported --json
soda-storyboard layout extract storyboard.webp --mode color --preview overlay.png --json
```

`import_moss` 返回分镜页和理解报告，报告列出尺寸推断、格子数、未知条目和猜测。支持 MOSS、frames / shots / panels、prompt / description、dialogue / lines、xyxy / xywh / yxyx、像素及 0–1 / 0–1000 坐标，还有 Markdown 表格或列表。坐标不明确时应核对理解报告。编辑器导入弹窗共用 Python 导入器。缺少尺寸的 MOSS 按坐标范围的纵横比吸附常用画布（与节点一致）；核心库公开 `from soda_storyboard import CANVAS_PRESETS, infer_dimensions`。表为 1024×1536、1536×1024、1024×1024、768×1344、1344×768，按纵横比对数误差选最近项；归一化或空布局回退首项。显示框越界时裁到画布内，原 bbox 无损保留。未注明方向的文字按框高大于宽的 1.5 倍判竖排，否则横排；明确方向优先。导入发现 colored / full color / 彩色等提示则设为 color，否则继承项目颜色模式。character 仅保留人物框和描述，不编造关节或角色身份。

`canvas_mode: "single"` 支持无格子的自由画布；`objects` 保存矩形 `rect`、`caption`、可空 `panel_id` 和 `label`（object / character）。物件框可新建、选择、移动、缩放和编辑描述。导入源条目及未知字段保存在 `moss_import`，未编辑条目按原顺序原样编译，只有编辑过的元素重新输出。

参考图识别支持 `--mode auto`（默认）、`color` 和 `standard`。颜色模式将青框识别为格子、绿框识别为空文字框、红框区分主角大框与标题；不做 OCR，遮挡边界附置信度。插件 AI 看图填内容时以识别坐标为准，确认分镜单后再编译。给其他 AI 的可复制提示词和完整格式示例见 [分镜输出说明](docs/for-other-ai.md)。

文字独立为 `texts`，每个 item 输出 `label: "text"`、英文样式/位置 `caption`、原文 `text`、`bbox`。原文可含换行。kind 支持 dialogue / narration / sfx / title / caption_tag，bubble 支持 speech / shout / thought / box / none，另有可空 panel_id、speaker_id、direction、bbox、style_hint。源页 bbox 是左上角像素矩形 x/y/w/h，省略时自动估算；竖排宽=列数×字宽×1.3，高=每列字数×字高×1.15，横排交换轴。页面 `text_font_size` 默认 42（按 1024 宽画布，随画布宽等比缩放），`text_max_chars` 默认 10，超过即换列/行。框形明显不符方向会 warning。旧 dialogue 和 sfx 继续编译，迁移原文到 texts 后应移除对应旧条目以免重复。

项目和页面可加 `style_prompt`（英文画风段落）、`tags`（字符串数组）。页面有设置则覆盖项目；未给画风时，编译器提供按 color_mode 区分彩色/黑白的英文兜底。插件会先让用户选择画风并保存。summary 以画风段落开头，接页面说明、tags、阅读方向和留白要求，有文字时要求清晰中文，无文字或使用 lettering 时追加 `no text, no speech bubbles`。meta 为 comic、multi_panel，彩色再加 digital_painting；分格页 canvas 为 multi_panel，自由画布为 single_canvas；导入页保留原 summary。

默认画面 item 含 label、caption、bbox，文字额外含 text。`compile --with-ids` 保留调试 ID，并生成 `.map.json`，生产输出不推荐使用。项目和页面仍可设置 `text_direction`（默认 vertical）、`color_mode`（默认 monochrome）；旧 style_prefix 也保留。`--size-check` 的核对只出现在命令 `--json` 报告和 map 文件中，`--output` 文件只有 summary、items、bbox_coord_space、bbox_format 四个顶层字段。

## 单文件分镜包与 ComfyUI

完成翻译和编译后，可把当前页导出为一个 JSON 文件，在 ComfyUI 的“导入分镜”节点中上传或拖入：

```powershell
soda-storyboard export-bundle my-story/pages/page-01.json --json
soda-storyboard export-bundle my-story/pages/page-01.json --output my-story/exports/page-01.storyboard.json --no-sketch --json
```

默认保存到项目 `exports/<页id>.storyboard.json`。导出前校验，有 error 就拒绝写文件；英文译文缺失或过期会提醒先运行 `translate --todo`，仍允许携带中文后备导出。`--json` 返回输出路径、格数、台词数、出场角色、建议 LoRA 和译文状态。此操作不连接 ComfyUI、不提交生成任务。

包格式为 `soda-storyboard-bundle-v1`，包含 `exported_at`、`generator`、项目设置 `project`、完整分镜单 `page`、该页实际引用的 `characters`，以及可选 `sketch_png_base64`。译文缓存和扩展字段保留；角色参考图仅留文件名，LoRA 等本机文件信息便携化，不打包参考图或模型文件。草稿是本地绘制的 PNG，长边 768，最多 2 MiB / 400 万像素，分镜 JSON 最多 16 MiB；`--no-sketch` 可省略草稿。格式见 [schema](schema/storyboard-v1.schema.json)。

共享读取与编译接口供节点集成，示例：

```python
from soda_storyboard.bundle import load_bundle, compile_bundle

page, characters, project_settings, warnings = load_bundle("page-01.storyboard.json")
result = compile_bundle(
    "page-01.storyboard.json", dialogue_mode=None, slant_mode="cut", include_triggers=True
)
moss = result["moss"]  # dict，直接来自同一套 compile_page
width, height = result["width"], result["height"]
lora, warnings = result["lora"], result["warnings"]
```

裸分镜单 JSON 也可读取，缺少角色卡会警告。详细类型、项目默认值继承、触发词开关、限制和兼容约定见 [共享接口说明](docs/bundle-api.md)。公开的 `soda_storyboard.importers.import_moss` / `import_storyboard` 返回 `(Page, 理解报告)`，区分格子与单画布；`canvas_sizes.CANVAS_PRESETS` / `infer_dimensions` 供节点共用尺寸规则。这些名称已写入模块 `__all__`，也可从包根导入。

## 人物与文字草稿

每格可选 `figures` 数组，指定 character_id、pose、position（0～1 或 left / center / right）、facing（left / right / front / back）、可空 framing（full / waist / bust / face）。缺省时按 character_ids 自动排开，RTL 第一个角色在右边；远景/全景画全身，中景到腰，近景到胸，特写画头。角色卡可加 age 和 figure_hint: skirt。

姿势预设为 stand、walk、run、sit、crouch、wave、point、arms_up、hands_clasped、hand_on_chin、lie、back_view；未知值 warning 并回退 stand。Pillow 绘制圆头十字参考线、躯干、四肢及角色名，裁在格子内，不调用图像模型。草稿稳定使用青色格子/格内人物、红色跨格人物/标题、绿色文字框，原文按方向绘制。

```bash
uv run soda-storyboard preview examples/pudding/pages/pudding.json --output examples/pudding/pudding.sketch.png --json
uv run soda-storyboard preview examples/pudding/pages/pudding.json --style boxes --output examples/pudding/pudding.boxes.png --json
uv run soda-storyboard compile examples/pudding/pages/pudding.json --output examples/pudding/pudding.moss.json --json
```

`preview` 默认 sketch；`--style boxes` 保留原纯框线版。`examples/pudding/` 是参考 JSON 的反向分镜示例，原格子、跨格人物和文字的 bbox、原文保持参考一致，另增加编辑器人物的 character 条目。为草稿每格都有人物，第 4 格把纯道具特写改成妹妹捧空布丁杯的特写。

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
| `cut`（默认） | 四条边中点界定的中线矩形，相邻格互不重叠 | 方位短语标注原 quad 的斜格形状 | `<输出名>.cut.json` |
| `hint` | quad 内的最大面积轴对齐矩形，整数坐标向内取整 | summary 加斜分割线，object 方位短语标注斜格 | 无裁剪文件 |
| `rect` | 原 quad 的外接矩形 | 方位短语标注原 quad 的斜格形状 | 无裁剪文件，仅供调试，bbox 可能重叠 |

`cut` 的矩形连同白色格间距覆盖整行或整列；`panel_gap=0` 时直接拼接。MOSS 使用矩形生成 bbox，caption 的方位短语保留原 quad 斜格形状，quad 由生产流程的 compose 裁剪。`.cut.json` 记录画布、坐标系、每格的 `panel_id`、`order`、原 `shape` / `quad`、`generation_rect`（左上角像素 `x,y,x2,y2`）和与 MOSS 相同的中心原点整数 `bbox`。例如输出 `page.moss.json` 对应 `page.moss.cut.json`。不指定 `--output` 时，旁路文件写入输入页同名的生产子目录，如 `pages/page/page.cut.json`。没有 quad 的页不生成裁剪文件。

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

## 插件结构与角色管理

插件根目录是 `skill/`，共用流程为 `skill/skills/soda-storyboard/SKILL.md`，包含 schema、知识笔记、示例及 NOTICE。`skill/plugin.json` 为 portable 清单，.codex-plugin 和 .claude-plugin 为宿主适配清单；三份版本保持一致。完整示例见 [车站对话](skill/examples/station-dialogue.md)。安装步骤见上文。

更新插件时先更新下载/克隆的仓库，再重启 Codex 并在目录确认版本；宿主仍使用旧缓存时重新安装插件。Claude Code 可运行 `claude plugin update soda-storyboard@soda-storyboard-local` 后重载，或重新启动临时加载命令。仅刷新旧聊天不能证明插件已更新。

### 新增角色管理

```shell
soda-storyboard character new --project my-story --id girl --name "澪" --lora "models/girl.safetensors" --outfit "浅色校服" --reference "refs/front.png" --json
soda-storyboard character set girl --project my-story --lora-strength 0.75 --appearance-zh "黑色短发" --json
soda-storyboard character list --project my-story --json
```

`new` 新建 LoRA 默认强度为 0.8；`set` 的 id 是位置参数，只改给出的字段。改路径而没给强度时保留已有强度；没 LoRA 不能单设强度。trigger、outfit、reference 都可重复，set 时用给出的整个列表替换，未给列表原样保留。set 按角色 id 查找，不要求文件名与 id 相同，也不会为不存在的角色新建文件。LoRA 和参考图路径只保存，不搜索或读取对应模型/图片。

### 文档来源与验证边界

安装说明沿用此前核对的 [OpenAI 插件打包指南](https://developers.openai.com/plugins/build/plugins)、[Agent Skills](https://developers.openai.com/codex/skills/)、[Claude 插件清单](https://code.claude.com/docs/en/plugins-reference) 和 [安装管理](https://code.claude.com/docs/en/discover-plugins)。本轮不访问网络，没有实际安装或加载宿主插件；清单、路径、包内引用、文档 CLI 命令由本地测试检查。最终需在新聊天确认技能可发现、可调用，并会等待拆格、版式和整页三个确认点。

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

默认 minimal 使用最小节点图。可选 v2 后端通过 `comfy config --backend v2 --workflow` 导入用户指定的 API JSON：程序填入布局、尺寸、种子、模型、质量参数和输出路径，插入单个 LoRA，清空原人物堆叠并关闭 SeedVR2。导入的是 API 格式，不是前端画布格式；参考节点表和示例 API 工作流在 `examples/comfyui/`。单格重画始终使用 minimal。

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

局部重绘前先运行 `soda-storyboard inpaint station-turn p1 --project my-story --character girl --mask-only --json`，查看返回的 `mask` 和红色叠加 `preview`。这个模式只写遮罩与预览，不连接 ComfyUI、不提交采样、不登记重画候选；确认范围后再运行不带 `--mask-only` 的命令。估时以 1024×1536、25 步约 40 秒为基准，按实际像素数和步数成比例换算，排队、模型加载和硬件另计。

抠图在采样前检查节点 required/optional 输入与 IMAGE 输出，填入契约中声明的默认值。缺必填参数或节点不兼容时直接提示 `cutout --png` 导入透明图，不先消耗采样。ComfyUI 执行失败时终端只显示节点、任务号和简短原因，完整诊断保存在故事项目的 `logs/comfy/`。
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

算法只使用 Pillow 和标准库，缩到长边最多 800 像素处理，单图上限 3200 万像素。除原有留白递归切分和连通轮廓拟合外，新增按局部对比度追踪横竖直线段、窄留白和四边支持度的检测；画面画到边缘、3～6 像素窄缝、黑色／灰色／浅彩色细框，以及部分被人物或气泡遮住的格框均可识别。原有轮廓拟合继续处理轻微旋转和斜切；四边闭合且含画面内容的格中格会保留，阅读顺序为先行后列、行内 RTL，嵌入小格紧随所属大格。面积小于页面 1.5% 的区域仍会被忽略。

结果新增 `reliable` 和 `warnings`；无格或有低置信度格时会明确提示“识别不可靠，建议手动调整”。`confidence` 是几何证据评分，不是识别正确的概率。格框被遮住、标题覆盖底边或下方出血时，可按相邻格的边界估计范围；重复的双侧行布局中，中央分隔线若完全被跨格人物挡住，会按对称位置估计，置信度为 0.45。此类橙色虚线框尤其需要手动确认，不能从不可见像素保证原始分格。

嵌入格和相互重叠的格子可提取并保存几何；现有 `layout suggest` 的无重叠检查仍会拒绝这类模板，需先手动调整为不重叠的版式再复用。

适用于以矩形为主、仍有直线格框或浅色留白证据的漫画页。无框自由构图、严重重叠、复杂背景中的矩形、明显透视、大角度旋转，以及缩小后不足一像素或几乎与纸色相同的细框仍可能漏检或误检。嵌入小格与矩形文字框按内部是否主要为纸白区分，因此大片空白的黑白嵌入格可能漏检，带底色的矩形文字框可能误检。生成示例新增 `dense-narrow`、`cross-frame`、`pale-occluded` 和 `inset`，涵盖画满边缘、窄缝、浅色框、人物／气泡跨格和格中格；真实样本测试只在设置环境变量 `SODA_EXTRACT_SAMPLES`（指向本地样本目录）时运行，否则跳过；仓库不包含也不分发任何真实漫画图片。

角色卡可选 `role_en`（CLI `character new/set --role-en "the older sister"`），文字 caption 优先用它，否则用 display_name。程序排字和草稿图共用竖排标点与均衡分列，显式换行保留；连续英文和数字整体缩放横排，两位数字占一个竖中横排单元。`.cut.json` 的像素坐标四舍五入到整数。

## 开发者

开发需要 Python 3.12+、uv，修改前端还需要 Node/npm。首次从源码开发：

```powershell
uv sync --all-groups
cd editor
npm install
cd ..
uv run python scripts/build_editor.py
```

已有 node_modules 时可离线构建。**每次修改前端后必须运行 `uv run python scripts/build_editor.py`**，并提交 `src/soda_storyboard/web/`。脚本重建 editor/dist 后替换包内静态目录，写入构建时间、前端版本及源码哈希；测试发现哈希不一致会提示重新构建。哈希按 LF 统一换行，涵盖 src 和前端构建配置。安装 wheel 没有 editor/src 时跳过源码比对。

服务默认使用包内资源；热更新开发可用 `uv run soda-storyboard-serve examples/pudding --static editor/dist`，另在 editor 目录运行 npm run dev。`uv build --offline` 可离线构建发行包（需要本机已缓存 uv_build）；wheel 默认收集 soda_storyboard 包内数据，无需用户另配静态目录。



```bash
uv run ruff format --check .
uv run ruff check .
uv run pytest
```

## 0.4.0 发布与便携版安装

仓库已配置 CI 和发布工作流，本地准备产物不会自动发布。`.github/workflows/ci.yml` 在 push / PR 时校验 Python 格式、lint、测试，并执行编辑器的 `npm ci`、`npm run build`、`npm test`。`release.yml` 在未来推送 `v*` 标签时检查标签与 `pyproject.toml` 版本一致，运行校验、构建 wheel 和 sdist，创建 GitHub Release 并附上两个产物。

发布前先审阅 CHANGELOG、把 `pyproject.toml` 和三个插件清单同步到同一版本、同步锁文件，并确认前端产物的源码指纹测试通过。若前端源码有改动，先运行 `uv run python scripts/build_editor.py` 更新随包静态文件。下面的构建和检查不会创建 Release：

```powershell
uv sync --locked
uv run ruff format --check .
uv run ruff check .
uv run pytest
uv build
```

检查 `dist/soda_storyboard-0.4.0-py3-none-any.whl` 和 `.tar.gz`，确认 wheel 包含 `web/`、`recipes.json` 和 `data/templates.json`。完成审阅并得到发布授权后，由发布者提交变更、创建并推送 `v0.4.0` 标签；工作流将再次检查版本和测试。标签不匹配、检查失败或产物缺失都会中止发布。

0.4.0 Release 发布成功后，在便携版 ComfyUI 根目录执行（`python_embeded` 是便携版实际目录名；需要 Python 3.12+）：

```powershell
.\python_embeded\python.exe -m pip install --upgrade "https://github.com/cOkieeman/soda-storyboard/releases/download/v0.4.0/soda_storyboard-0.4.0-py3-none-any.whl"
.\python_embeded\python.exe -c "from importlib.metadata import version; print(version('soda-storyboard'))"
```

wheel 已包含运行时数据和编辑器，不需要 Git、uv、`uv_build` 或 Node 来安装核心库。重启 ComfyUI 后使用节点；节点仓库后续应同步其 requirements wheel URL 到 0.4.0，并用共享接口替换重复读取/编译逻辑。以上 URL 需等 0.4.0 Release 发布成功后才能下载。
