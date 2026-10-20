# 派单 P2：Codex / Claude Code 插件（分镜讨论工作流）

前置：P1、P1b、P1c 已完成并通过 Claude 验收。开工前先读 `README.md` 和 `uv run soda-storyboard <命令> --help`，**以仓库里实际实现的命令、参数和 `--json` 输出为准**；本单里的命令写法只是示意，和实际不一致时以实际为准，并在结果里列出差异。

目标：
把 soda-storyboard 做成在 **Codex** 里直接可用的插件（优先），同时兼容 Claude Code。用户对 AI 说一个片段想法，AI 按本插件的工作流和用户讨论分镜、出线框预览、来回修改，确认后编译出 MOSS 布局 JSON。用户没有漫画基础，偏日漫（从右往左读），通常一次只画一页。

背景与必要事实：
- 已有能力（P1～P1c）：
  - 项目和文件：`init`、`page new`（`--direction`、`--style`、`--dialogue-mode moss_text|lettering`、`--text-direction`、`--color-mode`）、`character new`。
  - 版式：`template list`；`layout suggest`（14 种 manga-blueprint-studio 版式，`--candidates`、`--importance`、`--preview-dir` 给每个候选出线框图、`--pick`、`--page` 写回页文件）。P1c 增加了斜切候选（`--skew`）、`page skew`、出格图层 `overlays`、候选按版式家族去重。
  - 检查和输出：`validate`（越界、重叠、间距、顺序、台词长度、角色引用、多 LoRA 风险）、`preview`、`compile`（英文景别描述、中文台词气泡条目、整数 bbox、无台词时自动加 no text；P1c 增加 `--slant-mode cut|hint|rect`，默认 `cut` 并输出 `.cut.json`）。
  - 所有命令支持 `--json`，Windows 下输出 UTF-8。
- 缺口：`character new` 目前不能写入 LoRA 路径和强度，本单要补上（见第 4 条）。
- MOSS 实测结论（`docs/research/` 下的 phase0、phase0b、phase0d）：
  - 整页一次出图效果好，中文台词可以由 MOSS 直接画。
  - **两个人物 LoRA 不能同时加载**（会互相吞掉）。多人页一次只用一个 LoRA，其他角色的格子之后整格重画或局部重绘。两人同格的局部重绘接缝问题还没解决，分镜阶段尽量避免两个带 LoRA 的角色同格。
  - 斜切格：MOSS 能照提示画斜线，但效果不如先按矩形生成再裁剪，所以默认 `--slant-mode cut`。
  - 只写 "anime" 会偏 3D、半写实；画风前缀要写明 2D 画法（例如 clean 2D cel-shaded, crisp line art）。画风由用户自己写，插件只在用户没给时提醒，不擅自加。
- 插件格式：**由你自行查阅 Codex 当前官方文档**（skills / plugins 的目录结构、清单文件、安装方式、调用方式），以 Codex 的格式为主；再查 Claude Code 的 plugin / skill 格式，尽量让同一份 `SKILL.md` 两边都能用，Claude Code 需要的额外清单单独放。不要凭记忆写格式，在结果里写明参考的文档链接和查阅日期。**如果你的环境访问不了这些文档，停下来在结果里说明，由 Claude 提供文档内容。**
- 知识来源：`docs/tasks/refs/manga-blueprint-studio/`（MIT，本地副本）的 `MANGA-KNOWLEDGE.md`、`MANGA-TECHNIQUES.md`、`PANEL-LAYOUT-GRAMMAR-2026-09-12.md`、`MANGA-EXPRESSION-CATALOG.md`。整理成**中文精简版**，不是整段翻译照搬；`NOTICE` 已有该项目的 MIT 说明，补充"知识文档整理自 docs/…"即可。
- 完整计划见 `docs/PLAN.md` 第 4 节第 2 阶段。

执行目录（绝对路径）：E:\个人开发项目\soda-storyboard

可读取的范围：本仓库全部内容；公开网络上的 Codex、Claude Code 官方文档。

允许改动的文件/目录：新增 `skill/`（或 Codex 要求的插件目录名）、`plugin/`（Claude Code 清单等）；`NOTICE`；`README.md`（新增插件章节）；`src/soda_storyboard/` 中与第 4 条相关的命令行扩展；`tests/` 中与本单相关的测试。

禁止修改的文件/目录：`docs/`（包括 PLAN、tasks、research、refs）；已有命令的参数和输出语义（只加不改）；用户的全局 Codex / Claude 配置（安装步骤只写进文档，由用户自己执行）。

其他约束：不得 push、部署、改系统设置、读取或输出密钥；不调用 ComfyUI、不生成图片。

需要的操作：
1. `SKILL.md`（中文为主）写清工作流，并标明每个"必须停下来等用户确认"的地方：
   1. 听用户的片段。必要时只追问一两个关键问题（出场角色、想要的情绪），不要一次问一堆。项目不存在时先 `init`；用户提到的角色没有角色文件时，引导建立（第 4 条）。
   2. 提出 2～3 个拆格方案：每个方案几句话，写清几格、每格的景别和画面、台词放在哪格、翻页或收尾的落点。**停下来等用户选**。
   3. `layout suggest --preview-dir` 拿 4～6 个版式候选（含斜切）和线框图，用一两句话说明每个候选适合什么节奏，把图给用户看。**停下来等用户选**。
   4. 用 `--pick` 和 `--page` 写回版式，再把每格的景别、角度、角色、画面、台词写进页文件（AI 直接编辑页 JSON，字段按 schema）；每次修改后跑 `validate`，有 error 先自己修好；然后 `preview` 给用户看。
   5. 逐格修改：用户说"第 3 格改成从背后看"就只改那一格，改完重新预览。**停下来等用户确认**整页满意。
   6. `compile`，告诉用户 JSON 文件路径，提醒：粘进 Soda-MOSS v2 的「JSON直通」框；工作流里的尺寸要和画布一致；斜切页出图后要按 `.cut.json` 裁剪（第 3 阶段会自动化，现在先说明）。
   - 涉及多个带 LoRA 的角色时，主动说明"一次只能加载一个人物 LoRA"，建议整页用哪个角色的 LoRA，并标出之后要单独重画的格子；尽量不要安排两个带 LoRA 的角色同格。
   - 台词要短（单句默认 20 字内），说明原因（MOSS 画长句容易错字）。
   - 所有命令用 `--json` 读结果，不要把命令输出原文丢给用户；对用户只说人话。
   - 用户没有漫画基础：解释分镜选择时用日常语言，少用术语，用到术语时顺带一句解释。
2. `references/`（中文）：
   - `manga-basics.md`：拆格、景别、视线方向、180 度规则、动作四拍（准备 → 预备 → 动作 → 反应）、对话节奏、格子大小与时间感、翻页悬念。
   - `layout-grammar.md`：14 种版式各自适合的场景，与 template_id 对应；斜切格什么时候用（动作、情绪起伏）、什么时候别用（安静对话）。
   - `expression-catalog.md`：常用表现手法（速度线、集中线、留白、跨格、出血格、出格），每条写清在分镜单和 MOSS 布局里怎么描述。
   - `moss-layout-tips.md`：MOSS 布局写法要点和上面的实测结论。
   - `review-checklist.md`：用户把出图结果给 AI 看时，AI 对照分镜单复查的清单（格子位置、角色是否正确、台词错字、阅读顺序、多余的文字气泡）。
3. Claude Code 兼容：按官方格式提供插件清单（以文档为准），指向同一份 skill。
4. 角色文件：
   - 扩展 `character new`：新增 `--lora <路径>`、`--lora-strength <强度>`（默认 0.8）、`--outfit`（可多次）、`--reference`（参考图路径，可多次）；新增 `character set <id> ...` 修改已有角色（只改给出的字段）、`character list --json`。
   - SKILL.md 写清建立角色的对话流程：问名字、触发词、LoRA 文件（让用户给路径，不要自己去搜用户磁盘）、长相描述；拆格时只引用角色 id。
5. README 增加"安装插件"章节：Codex 和 Claude Code 各自的安装、启用、更新步骤；前置条件（Python 3.12+、uv、本仓库的安装方式）；一个最短的使用示例。
6. 示例对话 `skill/examples/station-dialogue.md`：从片段到 compile 的完整过程，展示每次停下来确认的地方，包含一次"只改第 3 格"的修改。

完成标准：
- `uv run ruff format --check .`、`uv run ruff check .`、`uv run pytest` 全部通过。
- 按 README 的步骤，Codex 能识别并加载本插件（写明你实际验证的方式；做不到实际加载时说明原因和替代验证）。
- 写一个测试，自动核对 SKILL.md 和 references 里出现的每条 `soda-storyboard ...` 命令和参数都真实存在（与 argparse 定义一致）。
- `character new --lora ...` 和 `character set` 的读写有测试。
- `NOTICE` 写明知识文档的来源。

遇到阻塞：停止越界操作，在结果中说明，不自行扩大范围。

输出格式：结果摘要；改动清单（路径及原因）；参考的官方文档链接和查阅日期；验证命令与结果（未运行须说明）；与本单示意写法不一致的地方；未完成项、阻塞及风险。
