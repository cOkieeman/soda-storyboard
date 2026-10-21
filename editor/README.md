# Soda Storyboard 分镜编辑器

基于 OpenKoma 的 React + TypeScript 前端。用户安装 Python 包即可使用，前端已随包发布，不需要安装 Node。

```powershell
soda-storyboard edit "故事项目目录" --detach --page pudding --json
soda-storyboard edit "故事项目目录" --stop --json
```

默认打开系统浏览器；--no-browser 只输出地址。`#page=<页id>` 直接选页，切页更新地址。页内容写回项目 pages/*.json，AI 下次编辑前重新读取；SSE 连接状态显示在顶部。版式候选默认带人物草稿。

## 开发

需要 Node/npm 和现有前端依赖。在仓库根目录执行：

```powershell
uv sync --all-groups
uv run python scripts/build_editor.py
uv run soda-storyboard edit examples/pudding --detach --page pudding --json
```

脚本运行 npm run build，清空并更新 src/soda_storyboard/web/，记录版本、UTC 构建时间和源码哈希。提交前端改动时必须一并提交包内产物；editor/dist 和 node_modules 保持忽略。测试会检查源码与构建指纹是否一致。

热更新开发可分别运行：

```powershell
uv run soda-storyboard-serve examples/pudding --port 8780 --static editor/dist
cd editor
npm run dev
```

Vite 使用 5173，通过代理访问后端。服务默认静态目录是包内 soda_storyboard/web，--static 可覆盖。接口、ETag 冲突及 SSE 约定见 [API.md](API.md)。服务只监听回环地址，无 SPA 路径回退，导航使用 URL hash。

## 文件与服务

- 项目源文件：project.json、pages/*.json、characters/*.json。
- .soda/server.json：本地服务端口、PID 和启动实例标识，停止前通过 /api/health 核对。
- .server/：临时预览；候选和任务记录只在当前服务进程有效。
- 保存及应用版式使用 If-Match；冲突时保留草稿，不能自动覆盖。
- 生产任务取消在安全边界生效，不承诺撤回已提交的 GPU 任务。

测试使用临时项目和随机回环端口，不向真实 ComfyUI 提交任务。
