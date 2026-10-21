# 派单 P4a：编辑器的本地服务和接口文档

前置：P2b 已提交（`79aacf7`）。**本单与 P3 同时进行**，两边改的文件互不重叠，请严格遵守下面的"允许改动"范围。

目标：
为第 4 阶段的可视化编辑器写一个本地服务：在浏览器里打开编辑器，读写同一个项目文件夹里的分镜单，调用预览、编译、版式候选等功能；AI 在 Codex / Claude 里用命令行改了项目文件时，编辑器能收到推送并刷新。同时写一份清楚的接口文档，之后由 Gemini 照着文档开发编辑器前端（基于 OpenKoma，React + TypeScript）。

背景与必要事实：
- 核心库已有：`io.load_page` / `io.save_page`、`validation.validate_page`、`compiler.compile_page`、`preview.render_preview`（带火柴人的草稿图）、`templates.suggest_layouts`、页面斜切（见 `cli.py` 的 `page skew` 实现）、角色卡读写（`character new/set/list` 的实现）。服务器直接调用这些函数，不要复制逻辑；某个功能只在 `cli.py` 里实现、没有可调用的函数时，在 `server/` 里写一层薄包装调用同样的底层函数，**不要改 `cli.py`**。
- P3 正在新建 `src/soda_storyboard/production/api.py`，会提供：`generate_page(project_dir, page_id, *, seeds=4, preset="draft", model=None, lora="auto", progress=None)`、`pick_render(...)`、`production_plan(...)`、`redraw_panel(...)`、`compose_page(...)`、`letter_page(...)`、`export(...)`。服务器的出图相关接口通过 `importlib` 尝试导入它：导入失败时这些接口返回 HTTP 501 和中文说明"出图功能尚未安装"，导入成功就调用。出图是长任务，要放进后台任务队列（见第 4 条）。
- 编辑器第一版（用户已定）只做：页面列表、角色列表、画布（拖格子、斜切、改文字框位置）、格子属性面板（景别、角度、角色、figures、描述、台词）、顶部操作（版式候选、草稿预览、导出 JSON、出图）和底部出图候选。界面风格与 Soda Prompt Hub 一致（这是前端的事，本单不涉及）。
- 项目会公开发布；服务只监听 127.0.0.1。

执行目录（绝对路径）：E:\个人开发项目\soda-storyboard

可读取的范围：本仓库全部内容。

允许改动的文件/目录：
- 新建 `src/soda_storyboard/server/` 包（全部新代码放这里）
- `pyproject.toml`（只新增一个命令入口 `soda-storyboard-serve = "soda_storyboard.server.app:main"`，不加依赖）
- 新建 `tests/test_server_*.py`
- 新建 `editor/API.md`（接口文档）和 `editor/README.md`（说明前端将放在这里、如何启动服务）

禁止修改的文件/目录：`docs/`；`src/soda_storyboard/production/`（P3 正在建）；`src/soda_storyboard/cli.py`、`models.py`、`schema/`、`skill/`、`README.md`（P3 会改这些）；其他已有模块只读。

其他约束：不得 push、部署、改系统设置、读取或输出密钥；只用标准库（`http.server.ThreadingHTTPServer`、`json`、`threading`、`queue`）加已有的 Pillow，不引入 FastAPI / Flask / websockets；不访问外网；不调用 ComfyUI。

需要的操作：
1. **启动**：`soda-storyboard-serve <项目目录> [--port 8780] [--host 127.0.0.1] [--static <前端构建目录>]`。默认只听 127.0.0.1；`--host` 不是回环地址时拒绝并提示。启动后打印访问地址。`--static` 指向前端构建产物（默认 `editor/dist`，不存在时首页显示一行"前端尚未构建"的说明）。
2. **REST 接口**（全部 JSON，UTF-8，路径以 `/api/` 开头）：
   - 项目：`GET /api/project`（项目设置、页面列表、角色列表摘要）、`PATCH /api/project`（只改给出的字段）
   - 页面：`GET /api/pages`、`GET /api/pages/{id}`、`PUT /api/pages/{id}`（整页保存，保存前跑 validate，有 error 时返回 422 和问题列表、不写盘；只有 warning 时写盘并返回 warning）、`POST /api/pages`（新建）、`DELETE /api/pages/{id}`（移到项目里的 `.trash/`，不真删）
   - 角色：`GET /api/characters`、`GET/PUT /api/characters/{id}`、`POST /api/characters`
   - 检查和输出：`POST /api/pages/{id}/validate`、`GET /api/pages/{id}/preview.png?style=sketch|boxes&scale=`（草稿图）、`POST /api/pages/{id}/compile`（返回 MOSS JSON，并写盘到约定位置，返回路径）
   - 版式：`GET /api/templates?panels=N`、`POST /api/pages/{id}/layout-suggest`（参数同命令行，返回候选及每个候选的预览图 URL）、`POST /api/pages/{id}/layout-apply`（写回选中的候选）、`POST /api/pages/{id}/skew`
   - 出图（依赖 P3）：`POST /api/pages/{id}/generate`、`GET /api/pages/{id}/renders`、`POST /api/pages/{id}/pick`、`GET /api/pages/{id}/plan`、`POST /api/pages/{id}/panels/{panel_id}/redraw`、`POST /api/pages/{id}/compose`、`POST /api/pages/{id}/letter`、`POST /api/export`
   - 文件：`GET /api/files/{项目内相对路径}`（只读，只允许项目目录内的图片和 JSON，防止 `..` 越界）
3. **并发和一致性**：每个页面文件带版本号（文件修改时间加内容哈希，作为 ETag）；`PUT` 必须带 `If-Match`，版本不一致返回 409 和当前内容，避免编辑器覆盖 AI 刚改的内容（AI 用命令行改文件也会改变版本）。
4. **后台任务**：出图等长任务进入队列，`POST` 立即返回任务 id；`GET /api/jobs/{id}` 查状态（排队 / 运行 / 进度 / 完成 / 失败和中文原因）；`POST /api/jobs/{id}/cancel`。同一时间只跑一个出图任务（只有一张显卡）。
5. **实时推送**：`GET /api/events`（Server-Sent Events）推送：项目内文件变化（新增、修改、删除，后台线程每秒检查修改时间，带变化的页面 id 和新版本号）、任务进度和完成。编辑器据此刷新，并提示"AI 刚修改了第 3 格"（变化来源无法区分时只说"页面已在外部修改"）。
6. **CORS**：只允许 `http://localhost:5173` 和 `http://127.0.0.1:5173`（Vite 开发服务器）以及同源，方便前端开发。
7. **接口文档** `editor/API.md`：每个接口写清方法、路径、请求和响应 JSON 示例（用 `examples/pudding` 的真实数据）、错误码含义（400 / 404 / 409 / 422 / 501）、ETag 用法、SSE 事件格式、任务状态流转、分镜单主要字段说明（格子、figures、texts、overlays）。这份文档是给前端开发者（Gemini）看的，要能不读后端代码就照着写前端。
8. **测试**：启动真实服务器到随机端口（测试结束关闭），用 `urllib` 调用，覆盖：页面读写和 422 校验、ETag 409、删除进 `.trash`、路径越界被拒、预览 PNG、编译、版式候选和写回、SSE 收到外部文件修改事件、出图接口在没有 production 模块时返回 501、有假 production 模块时任务队列的排队 / 完成 / 取消、CORS 头。

完成标准：
- `uv run ruff format --check .`、`uv run ruff check .`、`uv run pytest` 全部通过。
- `uv run soda-storyboard-serve examples/pudding --port 8780` 能启动，浏览器打开 `http://127.0.0.1:8780/api/pages` 能看到页面列表，`/api/pages/pudding/preview.png` 能看到草稿图。
- `editor/API.md` 覆盖第 2～6 条的全部接口和事件。

遇到阻塞：停止越界操作，在结果中说明，不自行扩大范围。

输出格式：结果摘要；改动清单（路径及原因）；验证命令与结果（未运行须说明）；接口清单；未完成项、阻塞及风险。
