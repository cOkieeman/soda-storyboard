# MOSS 布局与实测边界

下面的模型结论来自本仓库的 phase0、phase0b、phase0d 实测，不是对所有漫画模型的保证。不要自行调用 ComfyUI 验证；本插件交付分镜和布局 JSON。

## 编译器负责什么

- object caption 使用 `Panel N, close-up, eye-level: ...` 等自然英文景别和角度；人物外观与画面说明可保留中文。
- speech 条目类似 `A white vertical speech bubble with Chinese text "那个……"`；shout、thought、narration 分别是喊叫、云状思考泡和矩形旁白框。横排/竖排取自项目或页面 text_direction。
- summary 是用户画风前缀、整页故事、格数/阅读方向/留白约束与逐格简短要点，不重复所有完整描述。画风前缀没有用户选择就留空；不要用自己常用的 2D 风格替用户作决定。
- bbox 为中心原点的整数 `[y_min,x_min,y_max,x_max]`，不是左上角 `[x,y,w,h]`。不要手工交换轴或拿页面坐标直接替换它。只在源页里编辑 shape，再编译。
- 没有对白，或 dialogue_mode 为 lettering 时，summary 自动追加 no text, no speech bubbles，以抑制乱码日文气泡。
- 干净的 MOSS JSON 不包含 panel_id、speaker_id 和 overlays。with-ids 只用于调试；它也会生成 map，生产结果不要加该参数。

## 已经测到的效果与限制

整页一次生成在已测样例中效果较好，短中文台词可直接由 MOSS 画；仍需看成图，不能把 validate 当作台词正确性的证明。只写 anime 会偏 3D 或半写实；如果用户想要二维，可提醒其明确线稿、平涂等画法，但不自动改前缀。

两个人物 LoRA 同时加载会互相吞掉特征。多人页先选一个主角色 LoRA，其他角色单独出现的格子留待整格重画；两个带 LoRA 的人同格尽量拆成切换反应格。局部换人的接缝尚未解决，不承诺遮罩能一次成功。向用户说明主角色与后续处理的格子，不在本插件中加载模型。

后续阶段的三类重画不能混为一谈：保细节约 0.45，换人整格约 0.85，换人局部约 0.85 加遮罩；0.95 可能崩坏。这些是实测建议，不是本插件已有 redraw 命令，也不要现在执行。

单格重画提示必须只描述这一张画面，不能带“整页、多个格子、右到左读”等整页前缀，否则可能在一个格子里再画一页漫画。原台词也需要保护；当前还没有自动完成这套重画流程。

## 斜切与交付

```shell
soda-storyboard compile my-story/pages/station-turn.json --output my-story/output/station-turn.moss.json --slant-mode cut --json
soda-storyboard compile my-story/pages/station-turn.json --output my-story/output/station-turn.debug.json --slant-mode hint --with-ids --json
```

cut 是默认：MOSS 使用不重叠的中线矩形，程序不自动添加斜边提示，出图后按 station-turn.moss.cut.json 的 quad 裁剪。hint 用最大内接矩形并提示斜线，模型可能画出来，但 phase0d 的用户反馈不如先矩形生成再裁。rect 只是外接矩形调试，会重叠，不推荐交付。

把 MOSS JSON 粘进 Soda-MOSS v2 的“JSON直通”框。工作流画布必须与源页 canvas_width / canvas_height 一致，可额外用 size-check 记录核对；它不会替用户修改工作流。

```shell
soda-storyboard compile my-story/pages/station-turn.json --output my-story/output/station-turn.checked.json --size-check 1024x1536 --json
```

没有 quad 的页不会产生 cut 文件。带输出名 page.moss.json 的旁路文件是 page.moss.cut.json；不传 output 才会写到源页旁。map 与 cut 都不是粘贴给 MOSS 的提示词文件。overlays 只在源页和调试 map 中规划，透明人物图层与最终叠加留到第 3 阶段。

实测来源：docs/research/phase0-moss-layout.md、docs/research/phase0/T1_layout_text.json、docs/research/phase0b-two-characters.md、docs/research/phase0d/README.md。完整仓库保留这些原始记录；安装包内这份精简版可独立使用。
