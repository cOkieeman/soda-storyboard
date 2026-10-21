# soda-storyboard 计划书

MOSS 漫画分镜工具：从一个片段想法，到可以直接丢进 ComfyUI 的 MOSS 布局 JSON，再到成品页。
分成两个互相独立、靠同一种文件格式互通的产品：

- **soda-storyboard**（本仓库，独立）：核心库 + 命令行 + Claude Code / Codex 插件 + 可视化编辑器。不依赖 Soda Prompt Hub。
- **Soda Prompt Hub 分镜模块**（第 6 阶段）：Hub 自己连 API 做拆格、自己投递 ComfyUI 出图，内置同一份核心库。

日期：2026-10-20。分工：Claude 写派单、验收、拍板；Codex 主力实现；Gemini（Antigravity，只有图形界面，需要用户手动把派单贴进去）写前端界面。

---

## 1. 要具备的五项能力

| 能力 | 怎么做 | 参考 / 借用 |
|---|---|---|
| 拖格子、斜切格、裁图的可视化编辑 | 编辑器基于 OpenKoma 改造，读写分镜单格式 | OpenKoma（Apache-2.0，fork，保留 LICENSE 和 NOTICE） |
| 分镜知识（镜头、视线、连续性检查） | 知识文档给 AI 读；版式模板和求解器写进核心库；`validate` 做规则检查；出图后由 AI 对照分镜单看图复查 | manga-blueprint-studio（MIT，注明出处） |
| 完整生产流程 | 角色设定图 → 整页出图 → 切格 → 坏格单独重画 → 排字 → 导出 | agent-comic-kit（Apache-2.0）的流程思路 |
| 角色素材库、AI 操作编辑器 | 项目内 `characters/` 角色文件；编辑器监听项目文件，AI 用命令行改项目，编辑器实时刷新 | Kumanga（MIT）的素材库思路 |
| 从喜欢的漫画页提取版式 | 自己用 OpenCV 写格子检测和从右往左的阅读顺序，存进用户本地模板库 | 只参考思路：kumiko 是 AGPL-3.0，**不能抄代码**；Magi 只限学术用途，只能做成"用户自己安装后可选用"的后端，不能打包 |

## 2. 已核实的关键事实

- **MOSS 布局 JSON**（官方 USERGUIDE_ZH，实验性功能）：
  ```json
  {"summary": {"meta": [...], "canvas": "single", "caption": "..."},
   "items": [{"label": "object|text", "caption": "...", "bbox": [y_min, x_min, y_max, x_max]}],
   "bbox_coord_space": "abs_centralized", "bbox_format": "yxyx"}
  ```
  bbox **先 y 后 x**；坐标以画布中心为原点，x 向右、y 向下；宽 W 高 H 的画布，左上角原点坐标减去 W/2、H/2 即可换算。要画文字时用 `label: "text"`，并在 caption 里写出文字内容。
- 官方说明里提到之后会出"layout enhancer"（用 LLM 加 skill 做布局规划），可能和本项目重叠，届时再评估。
- Soda-MOSS v2（`F:\soda comfyui\ComfyUI_windows_portable\ComfyUI\user\default\workflows\Soda-MOSS-v2.json`）：JSON 框是节点 620，尺寸 150，种子 84，存图 81，负面 75，模型子图 135，采样子图 148。节点编号跟 Hub 已支持的 Soda-Anima 规则基本一致。导出 API 格式前要切到「JSON直通」模式，否则 620 那条线会被丢掉。
- ComfyUI 在 `127.0.0.1:8190`。50 步一张约 73 秒，25 步约 40 秒，Turbo 6 步约 8 秒（1024×1536，16GB 显卡）。

## 3. 分镜单格式（核心契约）

一个项目一个文件夹：

```text
my-comic/
  project.json            # 格式名 soda-storyboard-v1：作品名、默认画风前缀、默认尺寸、阅读方向
  characters/<id>.json    # 名字、触发词、LoRA 路径和强度、外观描述、服装、参考图、已认可的设定图
  pages/<page-id>.json    # 一页分镜单
  pages/<page-id>/        # 该页的预览、出图、切格、重画、排字结果
  templates/              # 用户自己的版式模板（含从参考页提取的）
```

一页分镜单的主要字段：画布宽高、阅读方向（`rtl` 默认）、画风前缀、整页说明；每格包括 id、阅读顺序、形状（矩形或四边形四个角点）、景别、角度、出场角色 id、画面描述、台词（说话人、内容、气泡类型）、拟声词、重要度；还有每格的状态（草图 / 已认可 / 需重画）。

编译到 MOSS 时：格子形状取外接矩形作为 bbox；台词有两种模式，**MOSS 画字**（台词作为 `label: "text"` 的条目交给 MOSS）和**程序排字**（MOSS 不画台词，之后由排字步骤用真实字体画气泡）。

具体字段名和 JSON Schema 由第 1 阶段定稿，之后所有阶段都以它为准；改格式必须升版本号并写迁移。

## 4. 阶段计划

每个阶段都是一张完整派单。Claude 验收后才进入下一阶段。

### 第 0 阶段：MOSS 整页可行性测试（已完成，2026-10-20）
- 结果见 `docs/research/phase0-moss-layout.md`。整页一次出图可行（布局、中文台词、单人物一致性都好）；两个人物 LoRA 同时加载会互相吞掉；切格重画在降噪 0.45 时效果好，0.65 会把中文改成日文。

### 第 1 阶段：核心库 + 命令行（Codex）
- 仓库骨架：Python 3.12、uv、ruff（`select = ["ALL"]`）、pytest。代码规范尽量与 Soda Prompt Hub 一致，方便第 6 阶段直接引入。
- 分镜单格式 v1 和 JSON Schema、读写和校验。
- `compile`：分镜单 → MOSS JSON，两种台词模式。
- `validate`：越界、重叠、格子间距、阅读顺序、台词长度、角色引用是否存在、视线和左右关系提示。
- `preview`：线框预览 PNG，标出阅读顺序、景别、角色、台词。
- 版式模板库：移植 manga-blueprint-studio 的 layout recipes（注明出处），加一个按格数和重要度挑选、填充模板的求解器，一次给出多个候选。
- 命令：`init`、`page new`、`template list`、`layout suggest`、`validate`、`preview`、`compile`。
- 派单：`docs/tasks/P1-core.md`（已写好）。

### 第 1c 阶段：斜切格、出格图层、候选多样性（Codex）
- 派单：`docs/tasks/P1c-slanted.md`。在 P2 之前完成，让插件一开始就能用斜切版式。

### 第 2 阶段：Claude / Codex 插件（Codex）
- `skill/SKILL.md`：工作流程。片段 → 2～3 个拆格方案 → 用户选 → 版式候选 → 线框预览 → 来回修改 → 编译。写清楚什么时候必须停下来等用户确认。
- `skill/references/`：从 manga-blueprint-studio 的知识文档（MANGA-KNOWLEDGE、MANGA-TECHNIQUES、PANEL-LAYOUT-GRAMMAR、MANGA-EXPRESSION-CATALOG）整理的中文精简版，加 MOSS 布局写法要点和出图复查清单。
- 打包：Claude Code 插件清单和 Codex skill 安装说明。先按官方文档核实两边当前的插件格式，不能凭记忆写。
- 角色文件的建立和使用流程。

### 当前进度与排期（2026-10-21 更新）
- 已完成：P1、P1b、P1c、P2、P2b（插件可用；编译器按范例写法输出；火柴人草稿）。
- 进行中（同时派给 Codex，文件互不重叠）：`docs/tasks/P3-production.md`（出图生产流程，代码在 `src/soda_storyboard/production/`）和 `docs/tasks/P4a-server.md`（编辑器本地服务，代码在 `src/soda_storyboard/server/`，接口文档 `editor/API.md`）。
- P4a 完成后写 P4b（Gemini 前端任务书）；之后 P5（参考页提取版式）、P6（接入 Hub）。

### 第 3 阶段：ComfyUI 连接 + 生产流程（Codex）
- 导入 API 格式工作流并做节点映射，自动认出 Soda-MOSS v2。直接调 ComfyUI 的 HTTP 接口（`/prompt`、`/history`、`/view`）。
- `gen page`：一次多个种子出整页。
- `split`：按格子切图，斜切格加遮罩。
- `redraw`：坏格按原比例单独重画，降噪默认 0.45（上限建议 0.5）。图生图 API 结构参考 `docs/research/phase0/phase0.py` 的 `redraw()`。**必须保护台词**：重画后把原格的气泡区域按 bbox 贴回，或在提示词里写明中文原文；`lettering` 模式的页不受影响。
- **多人页流程**（第 0、0b 阶段已验证，见 `docs/research/phase0b-two-characters.md`）：整页只加载出场最多的角色的 LoRA；其他角色单独出场的格子整格重画，只加载该角色 LoRA，降噪 0.85；两人同格时按该角色的位置框做遮罩局部重绘，降噪 0.85（0.95 会崩），提示词写具体姿势；**半边遮罩实测接缝明显（脸被切掉），第 3 阶段要先测位置框遮罩加余量和羽化**，未解决前分镜尽量避免两个带 LoRA 的角色同格。`validate` 要对"一格多角色"给出提示。
- **三种重画参数分开**：修细节 0.45；换人整格 0.85；换人局部 0.85 加遮罩。
- **重画提示词规则**：只写单张画面（"one frame, no panel borders, no text, no speech bubbles"），绝不能带整页前缀，否则 MOSS 会在格子里再画一页；没有台词的页要在 summary 里写明不要文字和气泡。
- `character sheet`：生成角色设定图，用户认可后存进角色文件。
- **斜切页**（第 0d 阶段结论：MOSS 能照提示画斜线，但不如先生成再裁）：默认按矩形格整页（或逐格）出图，再按 `.cut.json` 里的 quad 用遮罩裁成斜切形状、程序拼页（OpenKoma 的拼法）。插件实测（2026-10-21）：整页出图后直接裁，斜边外会残留 MOSS 自己画的矩形格框，效果不好；功能保留，优化放到第 3 阶段之后（候选：quad 向内收缩到 MOSS 格框之内、斜切页逐格无边框生成再拼）。
- **人物出格**：按页文件 `overlays` 生成该角色的单人图，用 ComfyUI 去背景（如 BiRefNet / RMBG）抠成透明 PNG，叠在格子边框上方。
- `letter`：程序排字，支持横排和竖排、多种气泡形状，用 Noto Sans CJK（OFL 协议）。
- `export`：PNG、PDF，以及 OpenKoma 项目文件。
- `review`：生成供 AI 对照分镜单看图复查的材料。

### 第 4 阶段：可视化编辑器（Codex 做后端，Gemini 做前端）
- Codex 先写本地服务 `soda-storyboard serve`（读写项目、文件变化推送、调用预览、编译、出图）和接口文档 `docs/editor-api.md`，Gemini 照接口开发。
- Gemini：在 `editor/` 里 fork OpenKoma，把数据模型换成分镜单（每格的景别、角色、描述、台词；台词和气泡对应），接本地服务，加上预览、编译、出图按钮和出图结果叠加显示。
- AI 操作编辑器：AI 用命令行改项目文件，编辑器收到推送后自动刷新。
- 构建出静态文件，供第 6 阶段的 Hub 引用。
- **OpenKoma 现有能力全部保留**：斜切格（四角拖动、边中点推动）、二次切割、透明图片图层（出格）、非破坏裁剪、文字气泡（横排 / 竖排）、多页、撤销重做、导出 PNG / PDF。

### 第 5 阶段：从参考页提取版式（Codex）
- `extract-layout page.png`：OpenCV 检测格子（留白间隔检测、轮廓和四边形拟合、递归切分），按从右往左排阅读顺序，存进用户模板库，并出一张叠加预览图。
- 可选 Magi 后端：用户自己安装后才启用，文档里写清楚它只限学术用途。

### 第 6 阶段：接入 Soda Prompt Hub（Codex 做后端，Gemini 做原生 JS 前端；一个 PR）
- 按 Hub 的 `CLAUDE.md` 规范执行：store 加 routes 加 `create_app()` 装配，JSON 文件带 `format: "soda-storyboard-v1"`，ruff、ty、pytest 覆盖率 80%。
- 引入第 1 阶段核心库的固定版本。
- AI 拆格走 Hub 自己的模型连接，提示词带同一份知识；**用户确认后才保存**（Hub 的边界规定）。
- OC 角色对应到分镜角色；新增 MOSS 工作流规则（`moss-soda-v2`）；通过 Worker 投递 `comfyui_generate`；结果进入现有的结果复盘流程。
- 分镜单文件可以导入、导出，与插件互通。
- 编辑器：Hub 前端不用 npm 构建，需要用户决定是否接受把第 4 阶段构建好的静态文件放进 `web_assets`。

## 5. 已拍板与待定

- 已定（2026-10-20）：仓库位置 `E:\个人开发项目\soda-storyboard`，发布到 GitHub `cOkieeman/soda-storyboard`，**公开**。所以引用的第三方代码和数据必须协议兼容，注明出处。
- 已定：前端工作同样由 Claude 写任务书（放在 `docs/tasks/`），由用户手动贴进 Gemini（Antigravity）执行，Claude 验收。
- 已定：编辑器界面风格与 Soda Prompt Hub 保持一致（同一套颜色和字体 token）。
- 已定：编辑器第一版只做主界面（页面列表、角色列表、画布、格子属性面板、顶部操作）加出图候选；角色库、版式库、排字导出放第二批。
- 已定：Hub 直接引入第 4 阶段构建好的编辑器静态文件，只维护一个编辑器。

## 6. 风险

- MOSS 布局是官方标注的实验性功能；第 0 阶段验证整页效果良好，但只测了 4 格黑白页。
- 两个人物 LoRA 同时加载会互相吞掉（已证实），多人页依赖逐格重画和局部重绘；局部重绘效果还没测。
- MOSS 画字偶尔有错字，所以保留程序排字模式。
- 斜切格在 MOSS 里只能用外接矩形近似。
- Claude Code 和 Codex 的插件格式还在变化，第 2 阶段要按当时的官方文档核实。

## 7. 验收方式（每阶段通用）

Claude 逐项对照派单里的完成标准：看 diff（包括新文件），自己跑测试和命令，抽查生成的预览图和 JSON；涉及出图的阶段在 ComfyUI 上真跑一次。执行者说"已完成"不算数，没核实的内容标为"执行者声称"。
