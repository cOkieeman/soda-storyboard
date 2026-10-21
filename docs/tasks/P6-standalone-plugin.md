# 派单 P6：做成完整的独立插件，并能一键打开网页编辑器

前置：P5 已提交（`6aeb397`）。可以和 P5b（只改 `extract`）同时进行，本单不得修改 `src/soda_storyboard/extract.py`、`src/soda_storyboard/extract/`、`tests/test_extract*.py`。

目标：
用户（以及以后从 GitHub 安装的其他人）装好插件后，不需要 Node、不需要手动构建前端、不需要记命令：在 Codex / Claude 里聊分镜时，AI 说一句"要在网页编辑器里打开吗"，用户同意后 AI 执行一条命令，浏览器就打开这一页的编辑器；用户在网页里改的，AI 下次读文件就能看到，反之亦然。暂时不接 Soda Prompt Hub。

背景与必要事实：
- 现状问题（Claude 验收时发现）：
  - 编辑器前端 `editor/dist` 被 `.gitignore` 忽略，要自己 `npm run build` 才有。
  - `server/app.py` 的默认静态目录写成仓库路径（`Path(__file__).parents[3] / "editor" / "dist"`），装成 Python 包以后就找不到前端。
  - 启动服务要记 `soda-storyboard-serve <项目> --port ...`，再自己开浏览器；没有"打开某一页"的入口。
  - 浏览器标签标题仍是 `OpenKoma - AI Comic Editor`，`editor/package.json` 的 name 还是 `openkoma`；版式候选弹窗里的缩略图是旧的纯框线样式（没有火柴人）。
- `editor/node_modules` 已在本机装好（你的环境不能联网，但 `npm run build` 可以离线运行）。
- 项目会在 GitHub 公开：`cOkieeman/soda-storyboard`。

执行目录（绝对路径）：E:\个人开发项目\soda-storyboard

可读取的范围：本仓库全部内容。

允许改动的文件/目录：`src/soda_storyboard/`（extract 相关除外）、`tests/`（extract 相关除外）、`editor/`（前端源码、`index.html`、`package.json`、`README.md`、`API.md`）、`skill/`、`scripts/`（新建）、`pyproject.toml`、`.gitignore`、`README.md`、新建 `CHANGELOG.md`。

禁止修改的文件/目录：`docs/`；extract 相关文件（见前置）。

其他约束：不得 push、部署、改系统设置、读取或输出密钥；不访问网络（`npm install` 不可用，只能用现有 node_modules）；不向 ComfyUI 提交真实任务。

需要的操作：
1. **前端随 Python 包一起发布**：
   - 新建 `scripts/build_editor.py`：在 `editor/` 里执行 `npm run build`，把 `editor/dist` 复制到 `src/soda_storyboard/web/`（先清空旧文件），并写一个 `build-info.json`（构建时间、前端 package.json 版本、源码哈希）。
   - 把 `src/soda_storyboard/web/` 提交进仓库（修改 `.gitignore`，只对这个目录放行；`editor/dist` 继续忽略）。
   - 确认 Python 包构建后包含这些静态文件（检查 uv_build 的包数据规则，必要时在 `pyproject.toml` 里配置）。能离线 `uv build` 就验证一次 wheel 内容；离线构建不了就说明，并用测试检查 `importlib.resources` 能读到 `soda_storyboard/web/index.html`。
   - 服务器默认静态目录改为包内的 `soda_storyboard/web`（用 `importlib.resources` 定位）；`--static` 仍可覆盖（开发时指向 `editor/dist`）。
   - 测试：前端源码改了但没重新构建时给出提示（比较 `build-info.json` 里的源码哈希和当前 `editor/src` 的哈希，不一致时测试失败并提示运行 `scripts/build_editor.py`；没有 `editor/` 源码目录时，例如从 wheel 安装，跳过）。
2. **一键打开编辑器** `soda-storyboard edit [项目目录，默认当前目录] [--page <页id>] [--port <端口，默认 8780>] [--no-browser] [--detach] [--stop] [--json]`：
   - 启动服务并用系统默认浏览器打开 `http://127.0.0.1:<端口>/#page=<页id>`；`--no-browser` 只打印地址。
   - 新增 `GET /api/health`（返回服务版本、项目的绝对路径、进程 id）。如果端口上已经有服务在管理**同一个项目**，直接复用（只打开浏览器）；是别的项目或别的程序，就自动换一个空闲端口。
   - `--detach`：后台启动（Windows 用 `subprocess.Popen` 加 `CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS`，其他系统用 `start_new_session`），把端口和进程 id 写到项目里的 `.soda/server.json`，立即返回地址。这是给 AI 用的：AI 的命令不会被一直挂着。
   - `--stop`：读 `.soda/server.json`，确认那个进程确实是本项目的服务（用 `/api/health` 核对）后再结束它；核对不上就不动，只提示。
   - `--json` 输出 `{url, port, pid, reused}`。
   - `.soda/` 加进项目的忽略说明（`init` 生成的项目里写一个 `.soda/.gitignore`）。
3. **前端小改**：
   - 标签标题改为 `Soda Storyboard 分镜编辑器`，`package.json` 的 name 改为 `soda-storyboard-editor`。
   - 支持地址里的 `#page=<页id>`：打开时直接选中这一页；切换页面时更新地址。
   - 版式候选弹窗的缩略图改用带火柴人的草稿样式（服务器的 layout-suggest 预览加 `style=sketch` 参数，默认 sketch）。
   - 页面顶部显示"与 AI 同步中"的小状态（SSE 已连接 / 断开重连中）。
   - 改完运行 `scripts/build_editor.py` 更新 `src/soda_storyboard/web/`。
4. **插件工作流**（SKILL.md）：
   - 在"出线框预览"和"逐格修改"环节，提示用户可以在网页编辑器里拖格子、改文字框，由 AI 执行 `soda-storyboard edit --detach --page <页id> --json`，把地址给用户。
   - 用户说在网页里改过了，AI 在继续修改前必须重新读取页文件（不能用旧内容覆盖）。
   - 会话结束或用户说不用了时，提示可以 `soda-storyboard edit --stop`。
5. **安装和发布说明**：
   - `README.md` 重写"安装"章节，给普通用户看：前置条件（Python 3.12+、uv；不需要 Node）；安装命令 `uv tool install git+https://github.com/cOkieeman/soda-storyboard`；在 Codex 和 Claude Code 里安装插件的步骤；ComfyUI 的配置（地址、模型文件）；一个从"说一个片段"到"打开网页编辑器"再到"出图"的最短示例。
   - 单独一节"开发者"：修改前端后要运行 `scripts/build_editor.py`。
   - 新建 `CHANGELOG.md`，记录 0.1.0 到本次 0.3.0 的主要能力（按 P1～P6 总结）。
   - `pyproject.toml` 版本改为 `0.3.0`；插件清单（`skill/.codex-plugin/plugin.json`、`skill/.claude-plugin/plugin.json`、`skill/plugin.json`）版本同步。
6. **测试**：`edit` 的启动、复用同项目服务、端口被占时换端口、`--detach` 写 `.soda/server.json`、`--stop` 只停本项目服务（用子进程在随机端口上测，测完清理）；`/api/health`；包内静态文件可读；`#page` 相关的服务器行为（首页正常返回 index.html）。

完成标准：
- `uv run ruff format --check .`、`uv run ruff check .`、`uv run pytest` 全部通过。
- `cd editor && npm run build` 通过，`scripts/build_editor.py` 能更新 `src/soda_storyboard/web/`。
- 在一个临时项目目录里：`uv run soda-storyboard edit --detach --page pudding --json` 返回地址，浏览器打开就是编辑器且选中该页；再执行一次显示复用；`--stop` 后端口释放。
- README 的安装步骤，从零照做能走通（无法联网验证的部分写明）。

遇到阻塞：停止越界操作，在结果中说明，不自行扩大范围。

输出格式：结果摘要；改动清单（路径及原因）；验证命令与结果（未运行须说明）；wheel 是否包含前端文件的验证方式；未完成项、阻塞及风险。
