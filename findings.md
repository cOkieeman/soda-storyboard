# 发现记录

## 2026-10-20

- 项目当前只有 `docs/PLAN.md` 与 `docs/tasks/P1-core.md`，实现从零开始。
- P1 要求 Python 3.12、uv、ruff（`select = ["ALL"]`）、pytest，以及 `src/` 包布局。
- 分镜页字段包括画布宽高、阅读方向、画风、整页说明、格子间距和 panels；panel 支持 rect/quad、景别、角度、角色、描述、dialogue、sfx、importance、status。
- MOSS 输出必须包含 `summary`、`items`、`bbox_coord_space: "abs_centralized"`、`bbox_format: "yxyx"`；bbox 顺序是 y、x、y、x，原点在画布中心。
- `moss_text` 模式输出文字 item，`lettering` 模式只输出 object item。
- 验收必须覆盖 validate、preview、compile、layout suggest 和完整测试。
- 当前实现的 MOSS 编译输出保留 `panel_id`/`speaker_id` 辅助字段，同时完整包含官方要求的四个核心字段。
- 验证环境无法通过 uv 从 PyPI 安装 pytest、ruff、Pillow；系统 Python 已有 Pillow，因此 preview 可做手工验证。
