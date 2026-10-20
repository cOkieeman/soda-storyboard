# 派单 P1b：P1 验收后的修正

目标：
修正 Claude 验收 P1 时发现的问题，主要是版式模板没有达到要求、Windows 下 `--json` 输出乱码，以及 MOSS 编译结果的写法。完成后 P1 才算通过，P2 才能开始。

背景与必要事实：
- P1 已实现核心库和命令行（`src/soda_storyboard/`），`ruff`、`pytest`（13 项）通过，validate / compile / preview 能跑，bbox 的 yxyx 和中心原点换算正确，预览从右往左编号正确。这些都要保持。
- 你的环境访问不了外网，所以 manga-blueprint-studio（MIT）的相关文件已下载到 `docs/tasks/refs/manga-blueprint-studio/`：`layout-recipes.mjs`、`layout-solver.mjs`、`layout-modifiers.mjs`、`PANEL-LAYOUT-GRAMMAR-2026-09-12.md`、`MANGA-KNOWLEDGE.md`、`MANGA-TECHNIQUES.md`、`MANGA-EXPRESSION-CATALOG.md` 和 `LICENSE`。直接读这些本地文件。
- 第 0 阶段实测有效的 MOSS 写法（`docs/research/phase0/T1_layout_text.json`，用户评价"比预期还好"）：caption 用英文自然语言描述景别和画面，例如 `Panel 2, medium close-up: ...`；台词条目写成 `A white vertical speech bubble with Chinese text "那个……"`。
- 第 0b 阶段结论（`docs/research/phase0b-two-characters.md`）：没有台词的页，MOSS 会自己补乱码日文气泡，所以要在 summary 里写明 no text / no speech bubbles。

执行目录（绝对路径）：E:\个人开发项目\soda-storyboard

可读取的范围：本仓库全部内容。

允许改动的文件/目录：`src/`、`tests/`、`schema/`、`examples/`、`README.md`、`NOTICE`、`pyproject.toml`、`.gitignore`；删除仓库根目录的 `task_plan.md`、`findings.md`、`progress.md`（开发过程记录，仓库要公开，不应放在根目录；如需保留，移到 `docs/dev-notes/`）。

禁止修改的文件/目录：`docs/PLAN.md`、`docs/tasks/`、`docs/research/`。

其他约束：不得 push、部署、改系统设置、读取或输出密钥；不访问网络；不调用 ComfyUI。已有命令的参数保持兼容（可新增参数）。

需要的操作：
1. **版式模板重做（最重要）**：
   - 现状：只有 3 个程序生成的模板；其中 `strip`（标为"横长条分段"）实际生成的是左右并排的竖长条，日漫页里不能用；`hero-side` 的大格在左边，日漫从右往左读时大格会最后才被读到；没有移植 manga-blueprint-studio 的 recipes。
   - 要求：以 `layout-recipes.mjs` 为来源移植 recipes（保留 id、日文名、中文名需新增、family、适用格数、tags、hero 位置、说明），在 Python 里实现对应的几何生成（参考 `layout-solver.mjs` 和 `layout-modifiers.mjs`），不是只抄名字。3～7 格每个格数至少 4 个合格候选，必须覆盖：全宽横条纵向堆叠、上段大格开场、下段大格收尾、一大多小（大格在阅读起点一侧）、四格（四个等高横条）、对角或错位构图。
   - 阅读方向：`rtl` 时同一行从右往左编号，大格的"起点 / 终点"按阅读顺序放；`ltr` 反过来。候选里每格要带 `order`。
   - `layout suggest` 增加 `--page <页文件>`（把选中的候选写回该页的格子几何，保留已有格子的其他字段；格数不一致时报错）和 `--pick <template_id>`；`--json` 输出每个候选的 template_id、中日名、说明、tags、每格的 order 和像素矩形。
   - `layout suggest --preview-dir <目录>`：为每个候选输出一张线框预览 PNG，方便 AI 给用户看。
   - NOTICE 和源码头部写清移植自哪个文件，保留 MIT 许可文本（可放 `LICENSES/manga-blueprint-studio.txt`）。
2. **Windows 输出乱码**：在 Windows 默认 GBK 控制台里，`--help` 和 `--json` 的中文输出是乱码，AI 读不了。命令行入口把 stdout / stderr 设为 UTF-8（例如 `sys.stdout.reconfigure(encoding="utf-8")`），加测试：用子进程在不设 `PYTHONIOENCODING` 的情况下运行 `--json`，输出能按 UTF-8 解析成 JSON。
3. **MOSS 编译写法**（以第 0 阶段实测有效的写法为准）：
   - object 条目 caption 用英文自然语言：`Panel N, <shot phrase>, <angle phrase>: <角色外观>, <画面描述>`。景别、角度从枚举值转换成自然英文（如 `close_up` → `close-up`，`eye` → `eye-level`），不要输出"景别：medium；角度：eye"这种格式。画面描述和角色外观可以保留用户写的中文。
   - text 条目 caption 按气泡类型生成，例如 `A white vertical speech bubble with Chinese text "……是你？"`、`A jagged shout bubble with Chinese text "..."`、`A cloud-shaped thought bubble ...`、`A rectangular narration box ...`；横排或竖排跟随项目或页面设置（默认竖排）。
   - summary.caption：画风前缀 + 整页说明 + "black-and-white Japanese manga page, N panels, read right to left, clean white gutters"（彩色、ltr 时相应变化）。逐格要点在 summary 里只写简短一句，不要把每格完整描述重复一遍。
   - 页面没有任何台词，或 `dialogue_mode` 为 `lettering` 时，summary 末尾加 `no text, no speech bubbles`。
   - bbox 输出取整数（四舍五入，并保证仍在 ±W/2、±H/2 内）。
   - 默认不输出 `panel_id`、`speaker_id` 等辅助字段（这些字段会被当成提示词文字交给 MOSS）；新增 `--with-ids` 时才保留，或输出到单独的 `<name>.map.json`。
4. **ruff 配置**：尽量向 Soda Prompt Hub 看齐，全局只忽略 `COM812`、`CPY001`、`D`、`ISC001`，其余豁免按文件写进 `per-file-ignores`。确有必要的全局忽略要在结果里说明理由。
5. **测试补充**：每种 recipe 在 3～7 格下候选都在画布内、互不重叠、格间距不小于设置、order 连续，rtl 时第 1 格在右上；编译结果不含辅助字段、bbox 为整数、无台词时有 no text、text 条目格式正确；`layout suggest --page` 写回后其他字段不变。

完成标准：
- `uv run ruff format --check .`、`uv run ruff check .`、`uv run pytest` 全部通过（Claude 会在有网络的环境里 `uv sync` 后复跑）。
- `uv run soda-storyboard layout suggest --panels 5 --json` 返回至少 4 个候选，`--preview-dir` 能生成对应 PNG。
- `uv run soda-storyboard compile examples/station/pages/station-turn.json` 的结果符合第 3 条的写法。
- 根目录不再有 `task_plan.md`、`findings.md`、`progress.md`。

遇到阻塞：停止越界操作，在结果中说明，不自行扩大范围。

输出格式：结果摘要；改动清单（路径及原因）；验证命令与结果（未运行须说明）；未完成项、阻塞及风险；移植了哪些 recipe、哪些没有移植及原因。
