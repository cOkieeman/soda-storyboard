# 派单 P2：Codex / Claude Code 插件（分镜讨论工作流）

前置：P1 和 P1b 已完成并通过 Claude 验收。manga-blueprint-studio 的知识文档已下载到 `docs/tasks/refs/manga-blueprint-studio/`，直接读本地文件。若你的环境访问不了 Codex / Claude Code 官方文档，停下来在结果里说明，由 Claude 提供文档内容，不要凭记忆写插件格式。开工前先读 `README.md`，以 P1 实际实现的分镜单格式、命令和 `--json` 输出为准；本单里的字段名只是示意。

目标：
把 soda-storyboard 做成可以在 **Codex** 里直接使用的插件（优先），同时兼容 Claude Code。用户对 AI 说一个片段想法，AI 按本插件的工作流和用户讨论分镜、出线框预览、来回修改，确认后编译出 MOSS 布局 JSON。用户没有漫画基础，偏日漫（从右往左读）。

背景与必要事实：
- 本仓库已有 P1 的核心库和命令行 `soda-storyboard`（init、page new、character new、template list、layout suggest、validate、preview、compile，均支持 `--json`）。
- 插件格式：**由你自行查阅 Codex 当前官方文档**（skills / plugins 的目录结构、清单文件、安装方式、调用方式），按 Codex 的格式为主来做；再查 Claude Code 的 plugin / skill 格式，尽量做到同一份 `SKILL.md` 两边都能用，Claude Code 需要的额外清单单独放。不要凭记忆写格式，在结果里写明你参考的文档链接和查阅日期。
- 知识来源：GitHub `c-a-p-engineer/manga-blueprint-studio`（MIT）的 `docs/MANGA-KNOWLEDGE.md`、`docs/MANGA-TECHNIQUES.md`、`docs/PANEL-LAYOUT-GRAMMAR-2026-09-12.md`、`docs/MANGA-EXPRESSION-CATALOG.md`。整理成**中文精简版**，不是整段翻译照搬；在 `NOTICE` 中注明来源和 MIT 许可。
- MOSS 事实（已实测，见 `docs/research/phase0-moss-layout.md`）：整页一次出图效果好，中文台词可以由 MOSS 直接画；**两个人物 LoRA 不能同时加载**（会互相吞掉）；切格重画降噪 0.45 合适，0.65 会把中文改成日文。多人页要一次一个 LoRA，另一个角色的格子之后整格重画或局部重绘（降噪 0.85，见 `docs/research/phase0b-two-characters.md`）。没有台词的页要在 summary 里写明 no text / no speech bubbles，否则 MOSS 会自己补乱码日文气泡。
- 完整计划见 `docs/PLAN.md` 第 4 节第 2 阶段。

执行目录（绝对路径）：E:\个人开发项目\soda-storyboard

可读取的范围：本仓库全部内容；公开网络上的 Codex、Claude Code 官方文档和 manga-blueprint-studio 仓库。

允许改动的文件/目录：本仓库内新增 `skill/`（或 Codex 要求的插件目录名）、`plugin/`（Claude Code 清单等）、`NOTICE`、`README.md` 中关于插件的章节、`tests/` 中与插件相关的测试；如插件需要，可小幅扩展 `src/soda_storyboard/` 的命令行（只加不改已有行为）。

禁止修改的文件/目录：`docs/PLAN.md`、`docs/tasks/`、`docs/research/`；不得修改 P1 已有命令的参数和输出语义；不得改用户的全局 Codex / Claude 配置（安装步骤只写进文档，由用户自己执行）。

其他约束：不得 push、部署、改系统设置、读取或输出密钥；可本地 git commit。不调用 ComfyUI、不生成图片。

需要的操作：
1. `SKILL.md`（中文为主）写清工作流，每一步标明"必须停下来等用户确认"的地方：
   1. 听用户的片段 → 必要时只追问一两个关键问题（不要一次问一堆）。
   2. 提出 2～3 个拆格方案（每个方案几句话：几格、每格的景别和画面、台词放哪格），等用户选。
   3. 用 `layout suggest` 拿版式候选，用 `preview` 出每个候选的线框图给用户看，等用户选。
   4. 写出完整页文件，`validate` 无 error 后出预览，和用户逐格修改（用户说"第 3 格改成从背后看"就只改那格）。
   5. 用户确认后 `compile`，告诉用户 JSON 文件路径，以及要粘进 Soda-MOSS v2 的「JSON直通」框、尺寸要与画布一致。
   - 涉及多个带 LoRA 的角色时，主动说明"一次只能加载一个人物 LoRA，其他角色的格子之后要单独重画"。
   - 台词要短（单句默认 20 字内），说明原因。
   - 所有命令用 `--json` 读结果，不要让用户看命令输出原文。
2. `references/`：
   - `manga-basics.md`：拆格、景别、视线、180 度规则、动作四拍、对话节奏、格子大小与时间感、翻页悬念。
   - `layout-grammar.md`：日漫常见版式和适用场景，与内置模板 id 对应。
   - `expression-catalog.md`：常用表现手法（速度线、集中线、留白、跨格、出血格等），每条写清在 MOSS 布局里怎么描述。
   - `moss-layout-tips.md`：MOSS 布局 JSON 写法要点（yxyx、中心原点、`text` 条目写中文原文、caption 写法、黑白漫画关键词）和第 0 阶段结论。
   - `review-checklist.md`：出图后 AI 对照分镜单看图复查的清单（格子位置、角色是否对、台词是否错字、阅读顺序）。
3. 角色文件流程：在 SKILL.md 中写清怎样用 `character new` 建立角色（名字、触发词、LoRA 路径和强度、外观描述），拆格时只引用角色 id。
4. Claude Code 兼容：按官方格式提供插件清单（如 `.claude-plugin/plugin.json` 等，以文档为准），指向同一份 skill。
5. README 增加"安装插件"章节：Codex 和 Claude Code 各自的安装和启用步骤、前置条件（Python、uv、本仓库安装方式）。
6. 一个端到端示例对话（`skill/examples/station-dialogue.md`）：从片段到 compile 的完整过程，展示每次停下来确认的地方。

完成标准：
- `uv run ruff format --check .`、`uv run ruff check .`、`uv run pytest` 全部通过。
- 按 README 的步骤，Codex 能识别并加载本插件（在结果里写明你实际验证的方式；做不到实际加载时说明原因和替代验证）。
- SKILL.md 里提到的每条命令都真实存在，参数与 `--help` 一致（写一个测试或脚本自动核对）。
- `NOTICE` 写明 manga-blueprint-studio 来源。

遇到阻塞：停止越界操作，在结果中说明，不自行扩大范围。

输出格式：结果摘要；改动清单（路径及原因）；参考的官方文档链接和查阅日期；验证命令与结果（未运行须说明）；未完成项、阻塞及风险。
