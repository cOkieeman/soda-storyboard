# 派单 P3：连接 ComfyUI 的生产流程

前置：P2b 已提交（`79aacf7`）。**本单与 P4a 同时进行**，两边改的文件互不重叠，请严格遵守下面的"允许改动"范围。

目标：
让 soda-storyboard 能直接驱动本机 ComfyUI 出图，并完成一页漫画的后续生产：整页出多张候选 → 选一张 → 切格 → 坏格重画 / 换人 → 斜切裁剪拼页 → 程序排字 → 出格人物抠图叠加 → 导出。插件里用户确认分镜后，AI 可以直接跑这些步骤并把结果图给用户看。

背景与必要事实（都已实测，详见 `docs/research/`）：
- ComfyUI 地址默认 `http://127.0.0.1:8190`，HTTP 接口：`POST /prompt`、`GET /history/<id>`、`GET /view?filename=&subfolder=&type=output`、`POST /upload/image`（multipart，字段 `image`，可带 `overwrite=true`）、`GET /object_info/<节点类名>`（查节点是否存在）。
- **最小节点图**（不依赖任何自定义节点，已在第 0 阶段跑通，参考 `docs/research/phase0/phase0.py` 和 `docs/research/phase0b/phase0b.py`）：`UNETLoader` →（`LoraLoaderModelOnly`）→ `ModelSamplingAuraFlow`（shift 5）→（`SkipLayerGuidanceDiTSimple`，single_layers "22"）；`CLIPLoader`（type `moss_image`）；`VAELoader`；`EmptyFlux2LatentImage`；`CLIPTextEncode`（正向是整份 MOSS JSON 字符串）；`KSampler`；`VAEDecode`；`SaveImage`。图生图用 `LoadImage → VAEEncode`；局部重绘再加 `SetLatentNoiseMask`（遮罩取 LoadImage 的 alpha，透明处 = 重绘区），并用 `ImageCompositeMasked` 把原图未遮罩部分贴回。
- 模型文件名（相对 ComfyUI 模型目录）：SFT `MOSS-Image\MOSS-Image-SFT\moss_image_sft_int8_convrot.safetensors`、Base `MOSS-Image\MOSS-Image-Base\moss_image_base_int8_convrot.safetensors`、编码器 `qwen3.5_9b_w4a8_gptq.safetensors`、VAE `flux2-vae.safetensors`。这些写进可配置的默认值，不要写死在逻辑里。
- **预设**：草稿 `draft` = 25 步 / er_sde / simple / CFG 2.5 / 无 SLG；定稿 `final` = 50 步 / euler / simple / CFG 3 / SLG22。1024×1536 草稿约 40 秒、定稿约 80 秒。
- **Soda-MOSS v2 工作流**：API 版在 `docs/tasks/refs/soda-moss-v2-json-api.json`，节点对照见同目录 `README.md`（620 填 JSON、150 尺寸、84 种子、81 存图、加 LoRA 和关 SeedVR2 的改法）。作为可选后端支持，但默认用最小节点图（开源用户不一定装了 v2 的自定义节点）。
- **多人页**：两个人物 LoRA 不能同时加载。整页只用出场最多的角色的 LoRA；其他角色**单独出场**的格子整格重画（只加载该角色 LoRA，降噪 0.85）；**两人同格**按该角色位置遮罩局部重绘（降噪 0.85，0.95 会崩），遮罩切过人物时接缝明显，要按人物位置（figures）留余量并羽化。
- **重画三种参数**：修细节 0.45（保构图、保台词）；换人整格 0.85；换人局部 0.85 加遮罩。0.65 以上会改动画面里的文字（中文变日文），所以重画后要把原格的文字框区域贴回去。
- **重画提示词**：只能写单张画面（"A single ... illustration, one frame only, no panel borders, no gutters, no text, no speech bubbles" + 该格英文描述），绝不能带整页前缀，否则 MOSS 会在格子里再画一页。
- **斜切**：先生成再按 `.cut.json` 裁剪，实测斜边外会残留 MOSS 画的矩形格框。裁剪时提供 `--cut-inset`（quad 向内收缩若干像素，默认 12）并在斜边外填白、重画边框。
- 编译器已有：`compile_page`（`compiler.py`）、`.cut.json`、texts 的 bbox 和尺寸估算（`lettering.py`）、figures（`figures.py`）。

执行目录（绝对路径）：E:\个人开发项目\soda-storyboard

可读取的范围：本仓库全部内容。

允许改动的文件/目录：
- 新建 `src/soda_storyboard/production/` 包（全部新代码放这里）
- `src/soda_storyboard/cli.py`（只新增子命令，不改已有命令）
- `src/soda_storyboard/models.py`、`schema/storyboard-v1.schema.json`（只做向后兼容的新增字段，例如项目里的 ComfyUI 配置、格子的生成状态和结果路径）
- 新建 `tests/test_production_*.py`
- `skill/`（更新工作流，加入出图步骤）
- `README.md`（新增"出图"章节）

禁止修改的文件/目录：`docs/`；`src/soda_storyboard/server/`（P4a 正在建）；`pyproject.toml`（如确需新依赖，先停下来说明）；其他已有模块只读或只做新增函数。

其他约束：不得 push、部署、改系统设置、读取或输出密钥。**不要向 ComfyUI 提交真实生成任务**（你的环境可能连不上，且会占用用户显卡）；用本地假服务器测试，真实出图由 Claude 验收时跑。运行时只用标准库（urllib、json、uuid）加已有的 Pillow，不引入 requests / websocket 依赖。

需要的操作：
1. **ComfyUI 客户端**（`production/client.py`）：提交、轮询 `/history` 到完成（可配置超时，显示进度用回调）、下载结果、上传图片、查询节点是否存在、错误时给出清楚的中文信息（连不上、节点缺失、模型文件不存在时 ComfyUI 返回的报错要原样附上）。
2. **节点图构建**（`production/graphs.py`）：最小图的 t2i、i2i、inpaint 三种；参数包括模型（base / sft / 自定义文件名）、预设、种子、尺寸、一个可选 LoRA（路径和强度）。可选后端 `v2`：读取用户导入的 API 工作流，按节点对照填 JSON / 尺寸 / 种子 / 存图路径，按 README 的方法插入 LoRA、关掉 SeedVR2。
3. **项目配置**：项目里存 ComfyUI 地址、默认模型、默认预设、默认后端；命令 `comfy config` 查看和修改，`comfy check` 检查连接、所需节点和模型文件是否存在（用 `/object_info`）。
4. **整页出图** `gen page <页> --seeds N --preset draft|final --model base|sft`：
   - 自动编译（不需要用户先手动 compile），按多人页规则选 LoRA：`--lora auto`（默认，出场最多的带 LoRA 角色）/ `--lora <角色id>` / `--lora none`。
   - 结果存到 `pages/<页id>/renders/<时间>_<种子>.png`，并在页面记录里登记（种子、预设、模型、LoRA、JSON 的哈希）。
   - 输出一张候选拼图（多张并排，标种子）方便在 Codex 对话里看。
   - `pick <页> <render>` 选定一张作为当前成品底图。
5. **生产计划** `plan <页>`：列出选定底图之后还需要做的事：哪些格要换人重画（哪个角色、整格还是局部）、哪些斜切格要裁、哪些 overlay 要抠图、是否需要排字。`--json` 给 AI 用。
6. **切格与重画**：
   - `split <页>`：按格子 bbox 切出每格图（quad 按外接矩形切，附 quad 遮罩）。
   - `redraw <页> <格id> --mode detail|swap [--character <id>] [--denoise]`：detail 默认 0.45；swap 默认 0.85、只加载该角色 LoRA、用单格提示词。完成后把原格里的文字框区域贴回（moss_text 模式时）。结果登记到格子记录。
   - `inpaint <页> <格id> --character <id> [--denoise 0.85] [--margin 24] [--feather 16]`：按该角色在格子里的 figures 位置生成遮罩（加余量、羽化，遮罩避开同格另一角色的区域），局部重绘。
   - 多次重画可以出多版，`pick-panel` 选定。
7. **拼页** `compose <页>`：把选定的格子结果贴回底图（按 bbox 缩放），斜切格按 quad 裁剪（`--cut-inset`，斜边外填白并重画格框，格框粗细可配置），输出 `pages/<页id>/composed.png`。
8. **排字** `letter <页>`：给 `lettering` 模式的文字（以及用户指定要程序排的文字）画气泡和字：speech（椭圆）、shout（锯齿）、thought（云形）、box（矩形旁白）、none（只写字）；竖排 / 横排；字体按顺序找 Noto Sans CJK SC / 思源黑体 / 微软雅黑，可用 `--font` 指定。输出 `lettered.png`。
9. **出格人物** `cutout <页> <overlay id>`：为 `mode: layer` 的 overlay 生成该角色的单人图（只加载该角色 LoRA，提示词写单人、纯色背景），用 ComfyUI 的抠图节点去背景（先用 `/object_info` 检查常见节点，例如 `BiRefNetRMBG`、`RMBG`、`Image Remove Background (rembg)`；都没有时说明需要安装什么，并允许用户提供已抠好的 PNG 路径），按 overlay 框叠在拼好的页面最上层。
10. **导出** `export <页或项目> --format png|pdf`：按页序导出成品（lettered > composed > 选定底图，取最新的那一级）。
11. **供 P4a 调用的接口**（`production/api.py`，函数签名固定，P4a 的服务器会调用）：
    - `generate_page(project_dir, page_id, *, seeds=4, preset="draft", model=None, lora="auto", progress=None) -> list[dict]`（每项含 path、seed、meta）
    - `pick_render(project_dir, page_id, render_path) -> dict`
    - `production_plan(project_dir, page_id) -> dict`
    - `redraw_panel(project_dir, page_id, panel_id, *, mode="detail", character_id=None, denoise=None, progress=None) -> dict`
    - `compose_page(project_dir, page_id) -> str`、`letter_page(project_dir, page_id) -> str`、`export(project_dir, page_ids=None, fmt="png") -> list[str]`
    - 这些函数不打印、不读命令行参数，出错抛带中文信息的异常；命令行只是它们的薄包装。
12. **插件工作流**：SKILL.md 在"编译"之后增加出图段落：问用户要不要直接出草稿（默认 4 个种子、草稿预设）→ 给候选拼图 → 用户选 → 跑 `plan` 说明还需要哪些步骤 → 按用户同意逐步执行，每步给图。所有出图都要先说明大概耗时，并且一次只跑用户同意的数量。
13. **测试**：用标准库写一个假 ComfyUI 服务器（记录收到的 prompt、返回假的 history 和一张测试 PNG），覆盖：节点图结构（各预设、有无 LoRA、SLG）、v2 后端的节点填写和 SeedVR2 关闭、LoRA 自动选择规则、遮罩生成（余量、羽化、避开另一角色）、文字框贴回、斜切裁剪的 inset、排字各气泡形状、导出顺序、错误信息。

完成标准：
- `uv run ruff format --check .`、`uv run ruff check .`、`uv run pytest` 全部通过。
- 对 `examples/pudding` 用假服务器能跑通 gen page → pick → plan → redraw → compose → letter → export 全流程（测试里体现）。
- `comfy check` 在 ComfyUI 不可达时给出清楚的中文提示，不报一长串堆栈。
- README 新增"出图"章节，写清配置 ComfyUI 地址、模型、草稿 / 定稿预设和每个命令。

遇到阻塞：停止越界操作，在结果中说明，不自行扩大范围。

输出格式：结果摘要；改动清单（路径及原因）；验证命令与结果（未运行须说明）；`production/api.py` 的最终函数签名；未完成项、阻塞及风险。
