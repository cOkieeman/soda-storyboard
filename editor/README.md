# Soda Storyboard 编辑器

这里将放置基于 OpenKoma 的 React + TypeScript 前端。P4a 已提供本地服务，本目录目前包含交接文档，尚未包含前端源码或构建产物。

先阅读 [API.md](API.md)。它定义全部请求、响应、页面字段、版本冲突处理、SSE 和后台任务约定；前端无需导入 Python 模块，也不要直接操作项目磁盘文件。

## 启动服务

在仓库根目录执行：

```powershell
uv run soda-storyboard-serve examples/pudding --port 8780
```

服务打印访问地址，默认仅监听 `127.0.0.1`。可用 `--host localhost` 或 `--host ::1`；非回环地址会被拒绝。按 Ctrl+C 停止。

- 页面列表：<http://127.0.0.1:8780/api/pages>
- 草稿预览：<http://127.0.0.1:8780/api/pages/pudding/preview.png>
- SSE：<http://127.0.0.1:8780/api/events>

默认静态目录为本仓库的 `editor/dist`；没有 `index.html` 时首页显示“前端尚未构建”。也可显式指定：

```powershell
uv run soda-storyboard-serve examples/pudding --static editor/dist
```

服务可以从任意工作目录通过绝对项目路径启动。对于安装后的发行包，建议始终用 `--static` 指定前端产物。

## Gemini 前端开发交接

第一版范围：页面列表、角色列表、可拖动格子/斜切/文字框的画布、格子属性（景别、角度、角色、figures、描述、台词）、顶部版式候选/草稿预览/导出 JSON/出图操作、底部出图候选。视觉风格与 Soda Prompt Hub 一致。

1. Vite 固定使用端口 `5173`（建议 `strictPort: true`）。直连 `http://127.0.0.1:8780`，或通过 Vite 代理 `/api`。允许的开发源只有 `http://localhost:5173` 和 `http://127.0.0.1:5173`。
2. 启动时取 `/api/project`，选择页面后取 `/api/pages/{id}`，保存完整 `page` 和 `version`。PUT 请求体就是完整页面对象，不包含 `version` 包装，`If-Match` 使用最近一次读取的版本原值。
3. 页面保存、应用候选、斜切、删除都带 `If-Match`。409 时保留本地未保存状态，展示冲突并重新获取/合并，禁止自动覆盖。
4. `EventSource('/api/events')` 监听 `ready`、`resync`、`file_changed`、`job`。重连时重新取项目和当前页面/任务；不要丢失未保存的本地编辑。
5. 各生产 POST 返回 202 和任务对象。通过 SSE 和 `/api/jobs/{id}` 更新进度；任务完成后重新读页面、候选图片和生产计划。运行中的生产任务会阻止同页写入（409 / production_running），前端需保留本地草稿。501 时显示“出图功能尚未安装”。
6. 图片使用返回的 `preview_url` / `url`，开发时加上后端基址。图片用版本参数防止浏览器沿用旧预览，例如 `?style=sketch&v=${encodeURIComponent(version)}`。
7. “导出 JSON”调用 compile，然后下载 `/api/files/{path}` 中的 MOSS JSON；原始分镜 JSON 则序列化当前已保存的 `page`，或下载 `/api/files/pages/{id}.json`。

本地服务按静态文件实际路径提供资源，不提供 SPA 路由回退。需要多页导航时使用内存路由或 HashRouter。构建后将产物写入 `editor/dist` 即可同源运行。

## 文件与任务生命周期

- 项目原文件仍是 `project.json`、`pages/*.json`、`characters/*.json`，CLI 和编辑器共享它们。
- 编译产物为项目根目录 `<页id>.moss.json`，以及需要时的 `.moss.cut.json` / `.moss.map.json`。
- 删除页仅将分镜 JSON 移到 `.trash/`；该页出图图片保留，可手动恢复 JSON。
- `.server/` 是服务生成的临时预览缓存，CLI 不依赖它。版式候选和后台任务记录只在本次服务进程内有效。
- 运行中的取消是协作式的：等待提交前/完成后的安全回调或当前步骤返回，不承诺撤销已经写入的结果，也不会并行启动下一项 GPU 任务。
- P3 接入按 `docs/tasks/P3-production.md` 的固定函数签名动态导入；测试使用假模块，不提交真实出图。

## 验证

```powershell
uv run ruff format --check .
uv run ruff check .
uv run pytest
```

服务器集成测试位于 `tests/test_server_http.py`，使用随机回环端口及临时项目副本，测试结束关闭服务。
