# 派单 P1c：斜切格、出格图层、候选多样性

前置：P1、P1b 已通过验收（提交 `baa8804`）。

目标：
让分镜单和版式模板支持 OpenKoma 那样的**斜切分镜**（平行四边形、梯形格子），并在格式里为**人物出格**（透明背景的人物图层盖在格子边框上）预留数据结构；同时让 `layout suggest` 的默认候选更多样。

背景与必要事实：
- 格式 v1 的 `shape` 已支持 `quad`（四个角点，左上角原点像素），validate / preview 已能处理 quad。本单是让模板和求解器真正产出斜切格。
- OpenKoma（Apache-2.0，`https://github.com/Reuben-Sun/OpenKoma`）的做法：格子四角可以分别向内或向外拖，形成平行四边形或梯形；可以对单个格子二次切割；格间距和圆角统一设置。它的几何代码在 `src/lib/panelGeometry.ts`。你的环境不能上网，按下面的要求自己实现即可，不需要参考它的代码。
- MOSS 布局只认矩形 bbox。斜切格编译时取外接矩形会互相重叠，所以编译要另想办法（见第 3 条）。
- 现状问题：`layout suggest` 默认只取排名前 4 个候选，3～7 格时几乎总是 balanced-grid、vertical-rhythm、hero-top / hero-bottom，dialogue-stagger、action-step、ladder、cinematic-stack 这些更有漫画感的版式很少出现。

执行目录（绝对路径）：E:\个人开发项目\soda-storyboard

可读取的范围：本仓库全部内容。

允许改动的文件/目录：`src/`、`tests/`、`schema/`、`examples/`、`README.md`、`NOTICE`。

禁止修改的文件/目录：`docs/`（包括 PLAN、tasks、research）。

其他约束：不得 push、部署、改系统设置、读取或输出密钥；不访问网络；不调用 ComfyUI。已有命令和字段保持兼容，格式只做向后兼容的新增（旧文件照常能读）。

需要的操作：
1. **斜切变换**：
   - 新增几何函数：对一组相邻矩形格子，把它们之间的分割线倾斜一个角度（例如 5°～15°），得到首尾相接、间距均匀的 quad。支持"同一行内竖分割线倾斜"和"横分割线倾斜"两种；倾斜后的格子仍在画布内、互不重叠、间距不小于设置。
   - 版式模板可以带 `skew` 选项：在 recipe 的基础上生成斜切变体（id 加后缀，例如 `hero-top-skew`）。3～7 格每个格数至少 2 个斜切候选。
   - 命令行：`layout suggest --skew <角度>`（0 表示不斜切，默认给出斜切和不斜切混合的候选）；新增 `page skew <页文件> --panels p1,p2 --angle 8`，对页里指定的相邻格子之间的分割线做斜切。
2. **出格图层（只做数据结构和预览）**：
   - 页文件新增可选字段 `overlays`：每项包括 id、所属格子 id（可空）、角色 id、位置矩形、层级（在格子上方）、说明（例如"人物从第 3 格冲出，盖住上方格子边框"）、状态（`planned` / `approved`）、图片路径（可空，第 3 阶段生成）。
   - validate：overlay 引用的格子、角色必须存在；overlay 可以超出所属格子，但要在画布内。
   - preview：overlay 用虚线框画出并标注"出格"。
   - compile：overlay 不进入 MOSS JSON（它在第 3 阶段单独生成后叠加），但在 `--with-ids` 的 map 文件里列出。
3. **斜切格的编译**：
   - 新增编译选项 `--slant-mode`：
     - `hint`（默认）：bbox 取格子"内接"的最大轴对齐矩形（保证相邻斜切格的 bbox 不重叠），并在 summary 里描述斜切分割线（例如 "the top row is split by two diagonal slanted gutters"），每格 caption 加 "slanted panel"。
     - `rect`：直接用外接矩形（会重叠，只用于调试）。
   - 第 0d 阶段正在测 MOSS 能否照 hint 画出斜切线，结果出来前两种都要支持。
4. **候选多样性**：`layout suggest` 默认候选按"版式家族"去重：同一 family 最多一个，优先选不同 family，再按重要度适配排序；`--candidates` 可调数量（默认 6）。
5. **测试**：斜切后的 quad 在画布内、不重叠、间距达标、阅读顺序不变（rtl 第 1 格仍在右上）；`hint` 模式的 bbox 互不重叠且都在对应 quad 内；overlays 的读写、校验和预览；默认候选的 family 互不相同。
6. README 补充斜切、出格和 `--slant-mode` 的说明。

完成标准：
- `uv run ruff format --check .`、`uv run ruff check .`、`uv run pytest` 全部通过。
- `uv run soda-storyboard layout suggest --panels 5 --preview-dir <目录>` 生成的候选里有斜切格，且 family 互不相同。
- 新增示例 `examples/slanted/`：一页 5 格（上排 3 个斜切格、下面两条横格，再加一个出格图层），validate、preview、compile 都能跑通。

遇到阻塞：停止越界操作，在结果中说明，不自行扩大范围。

输出格式：结果摘要；改动清单（路径及原因）；验证命令与结果（未运行须说明）；未完成项、阻塞及风险；格式新增字段清单。
