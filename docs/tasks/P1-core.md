# 派单 P1：核心库 + 命令行

目标：
在 `E:\个人开发项目\soda-storyboard` 建立 soda-storyboard 的 Python 核心库和命令行：定义分镜单格式 v1，实现校验、线框预览、编译为 MOSS 布局 JSON，以及版式模板和候选求解。这是后续所有阶段（插件、ComfyUI 生产流程、编辑器、Hub 接入）共用的契约，格式要稳。

背景与必要事实：
- 用途：把"一页漫画分镜"描述成结构化文件，编译成 MOSS-Image 的布局 JSON，交给 ComfyUI 出整页漫画。日漫，默认从右往左读。
- MOSS 布局 JSON 官方格式（OpenMOSS/MOSS-Image 的 USERGUIDE_ZH.md，"Layout Prompt" 一节）：
  ```json
  {"summary": {"meta": ["comic"], "canvas": "single", "caption": "整页画风与场景"},
   "items": [{"label": "object", "caption": "...", "bbox": [y_min, x_min, y_max, x_max]},
             {"label": "text", "caption": "要画出的文字及其样式", "bbox": [...]}],
   "bbox_coord_space": "abs_centralized", "bbox_format": "yxyx"}
  ```
  bbox 先 y 后 x；以画布中心为原点，x 向右、y 向下的绝对像素；宽 W 高 H 时，左上角原点坐标减去 W/2、H/2。生成文字要用 `label: "text"` 并在 caption 写出文字。
- 版式知识来源：GitHub `c-a-p-engineer/manga-blueprint-studio`（MIT）。其 `core/layout-recipes.mjs`、`core/layout-solver.mjs`、`docs/PANEL-LAYOUT-GRAMMAR-2026-09-12.md`、`docs/MANGA-KNOWLEDGE.md` 可作为参考；移植时在 `NOTICE` 和对应源码头部注明出处与 MIT 许可。不要引用或抄写 AGPL 的 kumiko 代码。
- 代码规范参照用户的另一个项目 Soda Prompt Hub（`E:\claude\soda-prompt-hub`，只读参考，看它的 `CLAUDE.md` 和 `pyproject.toml`）：Python 3.12+、uv、ruff `select = ["ALL"]`、豁免集中写在 `[tool.ruff.lint.per-file-ignores]`、`from __future__ import annotations`、pytest。这样第 6 阶段 Hub 可以直接引入本库。
- 完整计划见 `E:\个人开发项目\soda-storyboard\docs\PLAN.md`（第 3 节是格式要求，第 4 节第 1 阶段是本单范围）。

执行目录（绝对路径）：E:\个人开发项目\soda-storyboard

相关文件路径及用途：
- `E:\个人开发项目\soda-storyboard\docs\PLAN.md`：计划书，只读。
- `E:\claude\soda-prompt-hub\CLAUDE.md`、`pyproject.toml`：代码规范参考，只读。

可读取的范围：E:\个人开发项目\soda-storyboard、E:\claude\soda-prompt-hub（只读）、公开网络上的 manga-blueprint-studio 仓库。

允许改动的文件/目录：E:\个人开发项目\soda-storyboard 下除 `docs/PLAN.md` 和 `docs/tasks/` 以外的全部内容（可新建 `git init`）。

禁止修改的文件/目录：E:\个人开发项目\soda-storyboard\docs\PLAN.md、E:\个人开发项目\soda-storyboard\docs\tasks\、E:\claude\soda-prompt-hub 及其他任何目录。

其他约束：不得 push、部署、改系统设置、读取或输出密钥；可在本地 git commit；不访问 ComfyUI、不调用任何图像生成。依赖尽量少：运行时只允许 `jsonschema`（或自写校验）和 `Pillow`。

需要的操作：
1. 仓库骨架：`pyproject.toml`（包名 `soda_storyboard`，命令 `soda-storyboard`）、`src/soda_storyboard/`、`tests/`、`README.md`（中文）、`LICENSE`（Apache-2.0）、`NOTICE`、`.gitignore`。
2. 格式 v1（`schema/storyboard-v1.schema.json` + Python 数据模型）：
   - `project.json`：`format: "soda-storyboard-project-v1"`、作品名、默认画风前缀、默认画布尺寸、阅读方向（`rtl`/`ltr`，默认 `rtl`）、台词模式默认值（`moss_text` / `lettering`）。
   - `characters/<id>.json`：id、显示名、触发词、LoRA（路径、强度）、外观描述（中英可选）、服装列表、参考图路径、已认可设定图路径。
   - `pages/<page-id>.json`：`format: "soda-storyboard-page-v1"`；画布宽高（16 的倍数）；阅读方向；画风前缀；整页说明；格子间距；格子列表。每格：id、order、shape（`rect` 用 x/y/w/h，或 `quad` 用四个角点，坐标为左上角原点像素）、shot（`extreme_long|long|full|medium|close_up|extreme_close_up`）、angle（`eye|high|low|bird|worm|dutch`）、character_ids、description、dialogue（列表：speaker_id、text、bubble 类型 `speech|shout|thought|narration`）、sfx、importance（1～3）、status（`draft|approved|needs_redraw`）。
   - 字段名可以调整得更合理，但要在 README 里写清，并保证 schema、模型、测试一致。
3. `validate`：格子越界、互相重叠、间距过小、order 不连续、阅读顺序与几何位置明显不符（rtl 下右上起）、单句台词过长（可配置，默认中文 20 字）、角色 id 不存在、同一页角色左右站位频繁对调的提示；一页出现两个以上带 LoRA 的角色、或一格内有多个带 LoRA 的角色时给 warning（实测两个人物 LoRA 同时加载会互相吞掉，这类格子之后要逐格重画）。输出分 error / warning，命令行有退出码。
4. `compile`：页 → MOSS JSON。summary.caption = 画风前缀 + 整页说明 + 每格要点摘要 +「日式漫画页，N 格，白色格间留白」之类；每格一个 `object` item（caption 由景别、角度、角色外观描述/触发词、画面描述组成；quad 取外接矩形）。台词模式 `moss_text` 时每句台词再生成一个 `text` item，bbox 落在所属格内（按说话人位置和阅读方向放在格子上部空白处的简单启发式即可）；`lettering` 模式不生成台词条目。必须带 `bbox_coord_space` 和 `bbox_format`。附 `--size-check` 提示目标工作流尺寸要与画布一致。
5. `preview`：Pillow 画线框 PNG：格子轮廓（quad 也要画）、阅读顺序编号、景别/角色名/描述缩写、台词框位置示意；中文字体自动查找（Windows `C:\Windows\Fonts\msyh.ttc` 等，找不到时给出清楚报错或用 `--font` 指定）。
6. 版式模板与求解：
   - 内置模板库（JSON 数据文件）：至少 3～7 格各 3 个以上，含日漫常见的大格开场、一大两小、横长条三段、四格、对角构图；模板用相对坐标（0～1）。参考 manga-blueprint-studio 的 recipes 移植并注明出处。
   - `layout suggest`：输入格数和每格重要度（可选每格景别），输出 N 个候选（默认 3），按重要度把大格分给重要格，按阅读顺序排序，换算成像素写回页文件或输出到新文件。
   - 用户模板目录 `templates/` 同格式，求解时一并考虑。
7. 命令行：`init <dir>`、`page new`、`character new`、`template list`、`layout suggest`、`validate`、`preview`、`compile`。全部支持 `--json` 输出机器可读结果（供 AI 调用）。
8. 示例：`examples/station/`：一页 4 格（女孩在车站回头欲言又止），能完整跑通 validate → preview → compile。
9. 测试：格式读写往返、bbox 换算（含非方形画布、yxyx 顺序、中心原点）、quad 外接矩形、validate 各规则、compile 两种台词模式、layout suggest 结果在画布内且不重叠、preview 能生成图片。

完成标准：
- 在 `E:\个人开发项目\soda-storyboard` 下 `uv sync` 后，`uv run ruff format --check .`、`uv run ruff check .`、`uv run pytest` 全部通过。
- `uv run soda-storyboard validate examples/station/pages/<id>.json`、`preview`、`compile` 能跑通；compile 结果对照上面的官方格式字段完整，bbox 全在 ±W/2、±H/2 内。
- `layout suggest --panels 5` 给出至少 3 个互不相同、无重叠的候选。
- README 写清格式、命令和 MOSS bbox 规则；NOTICE 写明移植来源。

遇到阻塞：停止越界操作，在结果中说明，不自行扩大范围。

输出格式：结果摘要；改动清单（路径及原因）；验证命令与结果（未运行须说明）；未完成项、阻塞及风险；对格式 v1 做的任何偏离本单的决定及理由。
