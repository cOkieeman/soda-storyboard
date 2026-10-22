# 开发与验证

普通使用请从 [中文指南](guide/README.md) 开始。安装 wheel 的用户不需要 Node，也不需要构建编辑器。

源码开发需要 Python 3.12+ 和 uv；修改前端还需要 Node/npm。在仓库根目录同步开发依赖，进入 `editor/` 安装前端依赖后，再从根目录构建：

```powershell
uv sync --all-groups
cd editor
npm install
cd ..
uv run python scripts/build_editor.py
```

修改前端后需要运行构建脚本，并把 `src/soda_storyboard/web/` 一起纳入变更。脚本会重建编辑器、记录源码指纹，测试据此检查打包资源与源码是否匹配。已有依赖和构建后端缓存时，可以离线构建；只改文档则无需更新依赖。

常规检查：

```powershell
uv run ruff format --check .
uv run ruff check .
uv run pytest
```

CLI 也可通过 `python -m soda_storyboard` 调用。服务开发入口是 `soda-storyboard-serve`；生产使用推荐 `soda-storyboard edit`，它处理后台启动、复用和停止。

CI 会在 push / PR 时运行 Python 格式、lint、测试和前端检查。发布工作流由 `v*` 标签触发，核对标签与包版本后构建 wheel / sdist。准备发布时，需要审阅 [CHANGELOG](../CHANGELOG.md)、同步包与插件清单版本，并检查 wheel 是否包含网页资源、recipes 和模板数据。

核心包的共享接口与稳定性约定见 [bundle API](bundle-api.md)；页面结构见 [schema](../schema/storyboard-v1.schema.json)。
