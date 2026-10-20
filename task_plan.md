# 任务计划：soda-storyboard P1 核心库与 CLI

## 目标

在项目目录建立可安装的 Python 核心库、分镜单 v1 契约、命令行工具、模板求解器、示例和测试，并满足派单中的验收命令。

## 下一步

建立 `src/soda_storyboard`、`schema`、`tests` 和 `examples/station` 的基础文件，随后分模块实现。

## 当前阶段

阶段 2：规划与结构

## 各阶段

### 阶段 1：需求与发现
- [x] 读完 `docs/PLAN.md` 和 `docs/tasks/P1-core.md`
- [x] 记录 MOSS bbox、v1 字段和命令要求
- [x] 确认当前目录只有文档，尚无实现
- **状态：** complete

### 阶段 2：规划与结构
- [x] 建立 uv/ruff/pytest 项目骨架
- [x] 固定模型、schema、文件布局和 CLI 入口
- [x] 记录实现决策
- **状态：** complete

### 阶段 3：核心实现
- [x] 数据模型与 JSON 读写
- [x] validate 规则与诊断结果
- [x] MOSS compile 与 bbox 换算
- [x] Pillow preview 与字体查找
- [x] 内置/用户模板与 layout suggest
- [x] init/page new/character new/template list 命令
- **状态：** complete

### 阶段 4：示例与测试
- [x] 完成 station 示例
- [x] 覆盖读写、几何、校验、编译、模板、预览
- [x] 运行增量测试并修复问题
- **状态：** complete

### 阶段 5：最终验证与交付
- [ ] `uv sync`
- [x] `ruff format --check .`
- [x] `ruff check .`
- [x] `pytest`（使用缓存包和工作区临时目录执行）
- [x] 运行示例 validate/preview/compile/layout suggest
- [x] 检查派单清单和输出文档
- **状态：** blocked_by_environment

## 关键问题

1. 运行时只使用标准库和 Pillow；JSON Schema 用自写校验，避免额外运行时依赖。
2. 版式模板使用内置 JSON 数据和稳定的启发式候选生成，保证 3～7 格每格至少 3 个候选。

## 已做决策

| 决策 | 理由 |
|------|------|
| 使用 `src/` 布局、`uv_build`、Python 3.12 | 符合 P1 和现代 Python 技能要求 |
| 模型使用 dataclass，输入输出保留未知字段策略为严格校验 | 轻量、可读、便于 JSON 往返和 CLI 使用 |
| 预览优先查找 Windows 中文字体，缺失时退回默认字体并给出提示 | 适应当前 Windows 环境，同时保留可移植性 |
| 编译时把 quad 转为外接矩形，文字 bbox 使用格子上部启发式 | 与派单明确要求一致 |

## 遇到的错误

| 错误 | 尝试次数 | 解决方案 |
|------|---------|---------|
| 当前目录不是 Git 仓库 | 1 | 记录为当前状态；按派单允许后续 `git init`，本阶段不依赖 Git |
| 验证环境缺少 pytest/ruff/Pillow，uv 无法访问 PyPI | 1 | 已用系统 Python 完成编译、CLI 和手工断言；待依赖可用时运行完整验收 |

## 备注

- `docs/PLAN.md` 和 `docs/tasks/` 只读，不修改。
- 所有外部研究内容只写入 `findings.md`，不写入本计划。
- 每完成一个阶段更新状态和 `progress.md`。
