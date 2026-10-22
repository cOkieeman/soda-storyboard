# MOSS 布局与实测边界

下面的模型结论来自本仓库的 phase0、phase0b、phase0d 实测，不是对所有漫画模型的保证。本插件支持编译布局并通过本机 ComfyUI 出图；生成前须征得用户同意，说明张数及按尺寸、步数估算的耗时。

## 编译器负责什么

- object caption 默认用新鲜 caption_auto_en；缺失或过期退回整理后的中文并警告。先运行 translate --todo，AI 遵守 glossary、appearance_en 和英文姿势模板翻译，再 --apply。caption_en 只在显式启用手动覆盖时优先。每格独立写全外观，不加格号。
- 每个 text 条目必须有 text 原文；caption 只写英文样式、方向、气泡和位置。官方要求“生成文字时需用 text 指定内容”。竖排框必须竖长，默认超过 10 字换列；文本原有换行保留。
- summary 以英文 style_prompt 开头，没给时用按 color_mode 区分的兜底画风，随后接页面说明、tags、日漫阅读方向与白色留白；meta 为 comic、multi_panel（彩色再加 digital_painting），canvas 为 multi_panel。AI 应先给用户 2～3 段画风让其选择并保存，不能把编译器兜底当作用户已选画风。
- bbox 为中心原点的整数 `[y_min,x_min,y_max,x_max]`；源页仍用左上角 x/y/w/h。没有文字或使用 lettering 时 summary 追加 no text, no speech bubbles。
- 可选 moss overlay 编译成 character 条目，直接让 MOSS 画跨格人物；layer 模式留到第 3 阶段。日常对话、动作页默认不加跨格主角，只在登场、情绪高潮、强调人物时建议并说明原因。
- 干净 MOSS JSON 只有 summary、items、bbox_coord_space、bbox_format。with-ids 保留调试 ID 并出 map；size_check 只放 --json 命令报告和 map，输出文件不包含它。

## 已经测到的效果与限制

布丁页的对照表明，JSON 写法对质量的影响比底模与步数更大：独立 text 字段、合适的竖排框、完整英文人物描述和整页画风是关键。Base、SFT 都可用；SFT 偶有手部问题。草稿用 25 步，定稿用 50 步质量档；CLI 的 draft / final 预设分别使用这些步数；每次生成均先说明数量和预计耗时，经用户同意后执行。

整页一次生成在已测样例中效果较好，短中文台词可直接由 MOSS 画；仍需看成图，不能把 validate 当作台词正确性的证明。只写 anime 会偏 3D 或半写实；如果用户想要二维，可提醒其明确线稿、平涂等画法，但不自动改前缀。

两个人物 LoRA 同时加载会互相吞掉特征。多人页先选一个主角色 LoRA，其他角色单独出现的格子留待整格重画；两个带 LoRA 的人同格尽量拆成切换反应格。局部换人的接缝尚未解决，不承诺遮罩能一次成功。向用户说明主角色与后续处理的格子，CLI 一次只加载一个人物 LoRA，其他角色按 plan 逐格处理。

后续阶段的三类重画不能混为一谈：保细节约 0.45，换人整格约 0.85，换人局部约 0.85 加遮罩；0.95 可能崩坏。CLI 的 redraw 支持 detail / swap，inpaint 支持局部换人；确认当前候选、数量和耗时后执行。

单格重画提示必须只描述这一张画面，不能带“整页、多个格子、右到左读”等整页前缀，否则可能在一个格子里再画一页漫画。CLI 会保护 moss_text 原文字框；局部重绘先用 --mask-only 保存遮罩和叠加预览，给用户查看并确认后才提交采样。

## 斜切与交付

```shell
soda-storyboard compile my-story/pages/station-turn.json --output my-story/output/station-turn.moss.json --slant-mode cut --json
soda-storyboard compile my-story/pages/station-turn.json --output my-story/output/station-turn.debug.json --slant-mode hint --with-ids --json
```

cut 是默认：MOSS 使用不重叠的中线矩形，程序不自动添加斜边提示，出图后按 station-turn.moss.cut.json 的 quad 裁剪。hint 用最大内接矩形并提示斜线，模型可能画出来，但两条路线都有局限：实测“先生成再裁”效果也不佳，仅保留功能，不保证斜切成图质量。rect 只是外接矩形调试，会重叠，不推荐交付。

把 MOSS JSON 粘进 Soda-MOSS v2 的“JSON直通”框。工作流画布必须与源页 canvas_width / canvas_height 一致，可额外用 size-check 记录核对；它不会替用户修改工作流。

```shell
soda-storyboard compile my-story/pages/station-turn.json --output my-story/output/station-turn.checked.json --size-check 1024x1536 --json
```

没有 quad 的页不会产生 cut 文件。带输出名 page.moss.json 的旁路文件是 page.moss.cut.json；不传 output 才会写到源页旁。map 与 cut 都不是粘贴给 MOSS 的提示词文件。moss overlays 已进入 MOSS character 条目；layer overlays 只在源页和 map 规划，透明人物图层与最终叠加留到第 3 阶段。

以上结论来自作者在本机 ComfyUI 上的实测，只代表测试时的模型和参数，不保证所有情况。
