# 派单 P2b：按"范例写法"改造编译器和插件

前置：P2 已提交（`0e0b400`）。先读 `docs/research/json-style.md`，再对比 `docs/tasks/refs/example-style/` 里的两份 JSON：
- `pudding-plugin-version.moss.json`：插件现在的写法（出图人物变形、字有问题）
- `pudding-example-style.moss.json`：Claude 按范例手写的同一页（Base 和 SFT 出图都明显更好），线框图 `pudding-example-style.sketch.png`，生成脚本 `pudding_example_style.py`

**目标就是让 `compile` 默认产出第二种写法的 JSON，让插件引导 AI 写出这种分镜。**

背景与必要事实：
- MOSS 官方说明：文字条目要用 `text` 字段指定内容（"生成文字时需用 text 指定内容"）。
- 实测：两个人物 LoRA 不能同时加载；斜切"先生成再裁"效果不佳但功能保留；只写 anime 会偏 3D。
- 用户偏日漫、从右往左读，没有漫画基础。

执行目录（绝对路径）：E:\个人开发项目\soda-storyboard

可读取的范围：本仓库全部内容。

允许改动的文件/目录：`src/`、`tests/`、`schema/`、`examples/`、`skill/`、`README.md`、`NOTICE`。

禁止修改的文件/目录：`docs/`。

其他约束：不得 push、部署、改系统设置、读取或输出密钥；不访问网络；不调用 ComfyUI。格式只做向后兼容的新增（旧页文件照常能读、能编译）；已有命令参数不删不改语义。

需要的操作：

一、分镜单格式（schema 和模型）
1. **文字元素独立化**：页文件新增 `texts` 列表，每项包括 id、kind（`dialogue` / `narration` / `sfx` / `title` / `caption_tag`）、text（原文，可含 `\n`）、所属格子 id（可空）、说话人 id（dialogue 用）、direction（`vertical` / `horizontal`，默认跟随页面）、bubble（`speech` / `shout` / `thought` / `box` / `none`）、bbox（左上角原点像素矩形，可空）、style_hint（英文样式补充，可空）。旧格式里格子的 `dialogue` 仍然支持，编译时自动转成 texts。
2. **跨格主角（可选手法）**：overlays 新增 `mode`：`moss`（编译成 `label: "character"` 条目，让 MOSS 直接画出跨格的人物，范例的做法）或 `layer`（第 3 阶段抠图叠加，原有行为）。新建 overlay 时默认 `moss`。overlays 本身是可选的，大多数页面没有。
3. **英文描述字段**：格子新增 `caption_en`（可空）；角色卡已有 `appearance_en`，再加 `age`（可空，如 "20-year-old"）。页面和项目新增 `style_prompt`（一段英文画风描述，可空）和 `tags`（如 `["2girls", "sisters", "kitchen"]`）。

二、编译器
4. text 条目：`{"label": "text", "caption": <样式和位置的英文描述>, "text": <原文>, "bbox": ...}`。caption 按 kind、bubble、direction、所在格子位置生成，例如 `Clean vertical Chinese dialogue text in a white speech bubble next to the older sister in the top-left panel.`、`Bold comic sound effect text near the pudding cup.`、`Ornate stylized Japanese manga title logo with a clean decorative frame.`。
5. **文字框尺寸**：texts 没给 bbox 时自动放置，并按方向和字数量尺寸：竖排框宽 = 列数 × 字宽 × 约 1.3，高 = 每列最多字数 × 字高 × 约 1.15；横排反过来。字号按画布估算（1024 宽约 40～44px 一个字，可配置）。单列超过设定字数（默认 10）时自动换列。给了 bbox 但形状与方向明显不符（竖排却是扁框）时，validate 给 warning。
6. object 条目 caption：优先用 `caption_en`；否则用英文模板拼景别、角度、格子位置（如 `Top-right panel`、`Middle-left small vertical panel`）、人物英文描述（`appearance_en` + age，每格写全）和画面描述。
7. character 条目：来自 `mode: moss` 的 overlay，caption 写 `Main center character focus breaking across the middle panels: <人物英文描述>, <动作>`。
8. summary.caption：有 `style_prompt` 就用它开头；没有时用一段默认英文画风段落（参考 `pudding-example-style.moss.json`，按 color_mode 区分彩色和黑白），然后接页面说明、tags、"Japanese manga layout read right to left, clean white gutters"，有文字时加 "crisp Chinese comic text in clean speech bubbles and narration boxes"，没有文字时加 "no text, no speech bubbles"。meta 用 `["comic", "multi_panel"]`（彩色加 `digital_painting`），canvas 用 `"multi_panel"`。
9. **`size_check` 不再写进 MOSS JSON**：尺寸核对结果放进命令行 `--json` 输出（以及 `--with-ids` 的 map 文件）。MOSS JSON 只含 summary、items、bbox_coord_space、bbox_format。
10. 编译结果要能复现参考写法：把 `pudding-example-style.moss.json` 反向整理成一份分镜单示例 `examples/pudding/`（角色、格子、texts、moss 模式 overlay、style_prompt），编译结果的结构（条目种类和数量、text 字段、bbox）要与参考 JSON 一致；caption 文字不要求逐字相同。

三、线框预览
11. 配色照范例的分镜稿：格子青色、主角（moss overlay）红色、文字框绿色并在框里写出原文（竖排就竖着写），标题框红色。这张图既给人看，也方便以后直接把线框图交给 AI 写 JSON。

四、插件（skill）
12. SKILL.md 和 references 按新写法更新：
    - 拆格时除了格子，也考虑台词、旁白、拟声词、标题放在哪里，并在线框上给出位置。
    - 跨格主角、出格只是**可选手法**，不是每页都要：只在人物登场、情绪高潮、需要强调某个人的页面才提议，并说明为什么；日常对话、动作戏默认用普通格子。不要每页都塞一个主角大图。
    - 引导 AI 写英文 `caption_en` 和人物英文外观；用户只说中文也没关系，由 AI 翻译补全。
    - 画风：用户没给时，给 2～3 个英文画风段落让用户选（例如彩色厚涂插画风、清爽赛璐珞、黑白网点漫画），存进项目 `style_prompt`。不要擅自替用户定画风。
    - 避免把两个带 LoRA 的角色排进同一格；做不到时明确告诉用户风险（布丁页违反过）。
    - `moss-layout-tips.md` 补充本次结论：JSON 写法比底模和步数影响更大；Base、SFT 都可用（SFT 偶有手部问题）；草稿 25 步、定稿 50 步质量档。

完成标准：
- `uv run ruff format --check .`、`uv run ruff check .`、`uv run pytest` 全部通过。
- `uv run soda-storyboard compile examples/pudding/pages/<id>.json` 产出的 JSON：text 条目都有 `text` 字段；竖排文字框都是竖长形；有 character 条目；summary 以英文画风段落开头；不含 size_check。
- 旧示例（station、slanted）照常能 validate / preview / compile。
- 测试覆盖：texts 读写和旧 dialogue 转换、文字框尺寸估算（竖排 / 横排、自动换列）、方向与框形不符的 warning、moss / layer 两种 overlay 编译、size_check 不进 JSON、示例结构与参考一致。

遇到阻塞：停止越界操作，在结果中说明，不自行扩大范围。

输出格式：结果摘要；改动清单（路径及原因）；验证命令与结果（未运行须说明）；格式新增字段清单；未完成项、阻塞及风险。
