---
name: soda-storyboard
description: 与用户讨论一页日漫分镜，把片段想法拆格、选择版式、审阅线框、逐格修改并确认后编译 MOSS 布局。适用于新建或修改分镜单、角色卡和出图复查；不负责图像生成或 ComfyUI 执行。
---

# Soda Storyboard 分镜讨论

面向没有漫画基础的用户，默认一次一页、右上到左下阅读。用户的故事、画风和已有选择优先。用“让读者先看到什么、在哪里停一下”解释选择；术语首次出现时顺带解释，不把命令行或 JSON 输出原文丢给用户。

## 先确认工具与工作目录

- 此插件提供讨论流程，需要本机 Python 3.12+、uv 和已安装的 soda-storyboard CLI。先用 `soda-storyboard --help` 核对本机版本，涉及的子命令也先看帮助；帮助之外的执行命令都加 `--json`，读取结构化结果。
- 如 CLI 不在 PATH，按仓库 README 的前置安装步骤告知用户，不自动安装依赖或改全局配置。若用户只运行仓库的 uv 项目环境，可用 `uv run --directory "<仓库绝对路径>" soda-storyboard` 作为命令前缀，此时所有项目、页面、参考图和输出参数用绝对路径。
- 操作目标是用户的故事项目目录，不是安装后的插件缓存。先检查已有项目和文件，别用 init / new 覆盖它们。新项目才运行 `soda-storyboard init my-story --name "新故事" --direction rtl --json`；路径只是示例，换成实际目标。
- 默认不联网、不调用 ComfyUI、不执行图像生成。线框 PNG 是本地几何预览；这项工作流不提交生成任务。用户拿来成图时按 [复查清单](references/review-checklist.md) 看图，不擅自改稿或宣称修图完成。

## 1. 听片段并认识角色

先复述核心事件和情绪。信息不足时只问一两个影响拆格的问题，例如“谁出场？”“最后想留下遗憾还是惊喜？”。不要把角色设定、镜头、尺寸等问题一次全抛给用户。

用 `soda-storyboard character list --project my-story --json` 读已有角色。没有对应角色卡时逐步询问：名字、模型触发词（没有可留空）、LoRA 文件路径（没有可不用）、长相描述。让用户给出 LoRA 和参考图路径，不搜索其磁盘。衣服和参考图可后补；触发词按原文保存，不自行猜测。

```shell
soda-storyboard character new --project my-story --id girl --name "女孩" --trigger "girl_token" --lora "models/girl.safetensors" --lora-strength 0.8 --appearance-zh "黑色短发" --outfit "浅色校服" --reference "refs/girl.png" --json
soda-storyboard character set girl --project my-story --outfit "浅色校服" --outfit "帆布包" --json
```

新建只用于不存在的角色；修改用 set。重复的 trigger / outfit / reference 构成该字段的新列表，set 会替换整个列表，未给字段不变。修改现有 LoRA 路径而未给强度时保留原强度；新建 LoRA 默认 0.8。字段、旧别名和扩展信息见 [文件格式](references/storyboard-format.md)。

页里用角色 id 引用角色卡（包括对白 speaker_id），不把整份外观或 LoRA 路径塞入每格。多人页若有多个带 LoRA 的角色，主动说明“一次只能加载一个人物 LoRA”，建议先用出场最多、画面最重要的角色，列出其他角色日后需要单独重画的格子。尽量安排单独反应格，避免两个带 LoRA 的角色同格；已有明确意图要保留，但说清接缝问题尚未解决，不保证局部重绘成功。

用户没给画风时提醒一次：只写 anime 容易偏 3D 或半写实，若想要二维可参考 clean 2D cel-shaded, crisp line art。画风前缀由用户决定；没选就留空，不悄悄补上该示例，也不覆盖用户已有的前缀。

## 2. 提出 2～3 个拆格方案

需要拆镜头时读 [漫画基础](references/manga-basics.md)。每个方案用几句话说清：几格、每格看到多近和发生什么、台词在哪格、最后停在哪个动作或表情。一次一页无需强加翻页悬念；用户做连续页时才提下一页揭示什么。

给出取舍，例如“四格更安静，五格能多停一拍”。对白尽量一句 20 字内，解释“MOSS 画长句容易错字”；保留用户原话，缩写需要征得同意。

**必须停下来等用户确认 ①：等待选拆格方案或给修改意见。未选之前不要擅自确定格数、写成定稿或直接编译。** 用户若明确已选过方案，可沿用已有确认，不重复问。

## 3. 展示 4～6 个版式线框

读 [版式语法](references/layout-grammar.md)，然后运行：

```shell
soda-storyboard layout suggest --panels 4 --candidates 6 --direction rtl --width 1024 --height 1536 --preview-dir my-story/previews/candidates --json
```

把格数、重要度、画布和阅读方向换成已选方案的实际值；不要把示例的四格固定为默认。候选默认家族不同，混合矩形与斜切；支持 `--importance "1,3,2,1"`。用返回的 template_id、panels 和 preview 路径对应展示线框图，每项一两句解释节奏。按宿主支持的图片展示方式嵌入本地 PNG（使用绝对路径）；没有图片展示能力就给可打开的路径并说明限制，不说“已展示”。

此时别传 --page：它会立即写回几何，不是只读预览参数。安静对话也可以展示斜切供比较，但推荐平稳版式；动作或强烈情绪再推荐斜切，不只凭“看起来酷”选。

**必须停下来等用户确认 ②：等待用户选择版式。不得根据默认排名替用户选第一项。**

## 4. 落成分镜单并预览

只有目标页不存在时用 page new 创建；它只创建空页，不自动创建格子。先在 JSON 中补入与已选方案相同数量的 panel 对象和连续 order（从 1 开始），再写回所选版式：

```shell
soda-storyboard page new --project my-story --id station-turn --direction rtl --dialogue-mode moss_text --text-direction vertical --color-mode monochrome --json
soda-storyboard layout suggest --page my-story/pages/station-turn.json --pick hero-top-skew --json
```

用候选返回的真实 id，别照抄示例。写回后按 [assets/storyboard-v1.schema.json](assets/storyboard-v1.schema.json) 和 [文件格式](references/storyboard-format.md) 填入每格的景别、角度、角色、画面、台词。保留无关字段、既有 id、数组顺序和用户设定。需要手法时查 [表现手法](references/expression-catalog.md)。角色外观来自角色卡，不重新发明。

```shell
soda-storyboard validate my-story/pages/station-turn.json --json
soda-storyboard preview my-story/pages/station-turn.json --output my-story/previews/station-turn.png --json
```

每次修改后先 validate：有 error 就自行修正几何、缺失引用等可确定的问题并复验；不能擅自改掉用户剧情来消除问题。warning 要读原因：20 字警告解释给用户，多 LoRA 风险带上逐格处理建议，阅读顺序警告要检查实际线框。不可用“通过校验”证明图像生成一定正确。

修复同一问题两轮仍不通过，或需要用户未给的角色信息时，说明具体阻塞并等待必要信息，不无限重试、不带错交付。无 error 后展示更新的线框，说明哪些格子发生变化。

## 5. 逐格修改，等待整页确认

用户说“第 3 格从背后看”，按 order=3 找格子，不按数组索引猜。只改这一格的画面描述；背面、过肩、视线方向写进 description，angle 只能使用已有枚举（例如 eye / high / low），不要发明 back。除非用户要求改变几何，别重新运行布局写回而改动全页。再次 validate、preview，并核对其余格子及 overlays 未变。

**必须停下来等用户确认 ③：用户没有明确表示整页满意之前，不能 compile。** 让用户看到最后一版预览后确认；更改剧情、台词、版式后，旧版本的确认不自动算作新版本确认。已明确确认当前版本就继续，不重复索要许可。

## 6. 编译并交付

确认后读 [MOSS 要点](references/moss-layout-tips.md)，再 validate 一次并编译：

```shell
soda-storyboard validate my-story/pages/station-turn.json --json
soda-storyboard compile my-story/pages/station-turn.json --output my-story/output/station-turn.moss.json --slant-mode cut --json
```

交付页文件、线框和 MOSS JSON 的绝对路径。简短提醒：把 JSON 粘进 Soda-MOSS v2 的“JSON直通”框，工作流画布尺寸要与页面一致；斜切页的 `station-turn.moss.cut.json` 用于出图后按 quad 裁剪，第 3 阶段才会自动化；目前不要称已经裁剪。overlays 只是规划数据，不进入 MOSS，透明人物图层也留待后续生成与叠加。

生产输出不要加 --with-ids。如用户要调试映射，可单独生成带 ids 的调试输出和 map，别覆盖已交付的干净 MOSS JSON。把多 LoRA 的主角色、需单独处理的格子一并说明，不替用户加载模型。

完整对话见 [车站示例](../../examples/station-dialogue.md)。
