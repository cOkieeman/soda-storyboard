---
name: soda-storyboard
description: 与用户讨论日漫分镜、选择版式、审阅线框，确认后编译 MOSS 布局；用户需要时通过本机 ComfyUI 出候选图、重画、拼页、排字和导出。
---

# Soda Storyboard 分镜讨论

面向没有漫画基础的用户，默认一次一页、右上到左下阅读。用户的故事、画风和已有选择优先。用“让读者先看到什么、在哪里停一下”解释选择；术语首次出现时顺带解释，不把命令行或 JSON 输出原文丢给用户。

## 先确认工具与工作目录

- 此插件提供讨论流程，需要本机 Python 3.12+、uv 和已安装的 soda-storyboard CLI。先用 `soda-storyboard --help` 核对本机版本，涉及的子命令也先看帮助；帮助之外的执行命令都加 `--json`，读取结构化结果。
- 如 CLI 不在 PATH，按仓库 README 的前置安装步骤告知用户，不自动安装依赖或改全局配置。若用户只运行仓库的 uv 项目环境，可用 `uv run --directory "<仓库绝对路径>" soda-storyboard` 作为命令前缀，此时所有项目、页面、参考图和输出参数用绝对路径。
- 操作目标是用户的故事项目目录，不是安装后的插件缓存。先检查已有项目和文件，别用 init / new 覆盖它们。新项目才运行 `soda-storyboard init my-story --name "新故事" --direction rtl --json`；路径只是示例，换成实际目标。
- 分镜讨论和 preview 不调用 ComfyUI；preview PNG 是本地 Pillow 绘制的布局预览。整页确认后按第 7 节提议本机出图，每次只运行用户同意的数量和步骤。用户拿来成图时按 [复查清单](references/review-checklist.md) 看图。

## 1. 听片段并认识角色

先复述核心事件和情绪。信息不足时只问一两个影响拆格的问题，例如“谁出场？”“最后想留下遗憾还是惊喜？”。不要把角色设定、镜头、尺寸等问题一次全抛给用户。

用 `soda-storyboard character list --project my-story --json` 读已有角色。没有对应角色卡时逐步询问：名字、模型触发词（没有可留空）、LoRA 文件路径（没有可不用）、长相描述。让用户给出 LoRA 和参考图路径，不搜索其磁盘。衣服和参考图可后补；触发词按原文保存，不自行猜测。

```shell
soda-storyboard character new --project my-story --id girl --name "女孩" --trigger "girl_token" --lora "models/girl.safetensors" --lora-strength 0.8 --appearance-zh "黑色短发" --outfit "浅色校服" --reference "refs/girl.png" --json
soda-storyboard character set girl --project my-story --outfit "浅色校服" --outfit "帆布包" --json
```

新建只用于不存在的角色；修改用 set。重复的 trigger / outfit / reference 构成该字段的新列表，set 会替换整个列表，未给字段不变。修改现有 LoRA 路径而未给强度时保留原强度；新建 LoRA 默认 0.8。字段、旧别名和扩展信息见 [文件格式](references/storyboard-format.md)。

页里用角色 id 引用角色卡（包括对白 speaker_id），不把整份外观或 LoRA 路径塞入每格。多人页若有多个带 LoRA 的角色，主动说明“一次只能加载一个人物 LoRA”，建议先用出场最多、画面最重要的角色，列出其他角色日后需要单独重画的格子。尽量安排单独反应格，避免两个带 LoRA 的角色同格；已有明确意图要保留，但说清接缝问题尚未解决，不保证局部重绘成功。

用户没给画风时，给 2～3 段可选的英文画风描述，让用户选择后存进项目 `style_prompt`，不要擅自定画风或覆盖已有选择。例如：

- 彩色厚涂插画：`Fully colored 2D anime digital painting comic, clean line art, gentle painterly highlights, warm daylight, a fresh pastel palette, expressive faces.`
- 清爽赛璐珞：`Clean 2D Japanese anime comic, crisp ink outlines, flat cel shading, bright restrained colors, clear silhouettes and expressive eyes.`
- 黑白网点：`Black-and-white Japanese manga, crisp ink lines, delicate screentone shading, strong black shapes, expressive faces and clean white negative space.`

只写 anime 容易偏 3D。编译器在未给 style_prompt 时有按 color_mode 区分的英文兜底段落，但这不是用户已经选定的画风。用户用中文编辑 `description` 和 `appearance_zh`，AI 补全角色 `appearance_en`；出图前按下方译文流程写入 `caption_auto_en`。不要把自动译文塞进手动覆盖字段 `caption_en`，也不要擅自开启覆盖开关。tags 放项目或页面。

## 2. 提出 2～3 个拆格方案

需要拆镜头时读 [漫画基础](references/manga-basics.md)。每个方案用几句话说清：几格、每格看到多近和发生什么、台词、旁白、拟声词、标题在哪格和什么位置、最后停在哪个动作或表情。为这些文字预留空间，优先写独立 texts，原文保存在 text，caption 不重复原文。一次一页无需强加翻页悬念；用户做连续页时才提下一页揭示什么。

给出取舍，例如“四格更安静，五格能多停一拍”。对白尽量一句 20 字内，解释“MOSS 画长句容易错字”；保留用户原话，缩写需要征得同意。

**必须停下来等用户确认 ①：等待选拆格方案或给修改意见。未选之前不要擅自确定格数、写成定稿或直接编译。** 用户若明确已选过方案，可沿用已有确认，不重复问。

## 3. 展示 4～6 个版式线框

读 [版式语法](references/layout-grammar.md)，然后运行：

```shell
soda-storyboard layout suggest --panels 4 --candidates 6 --direction rtl --width 1024 --height 1536 --preview-dir my-story/previews/candidates --json
```

把格数、重要度、画布和阅读方向换成已选方案的实际值；不要把示例的四格固定为默认。候选默认家族不同，混合矩形与斜切；支持 `--importance "1,3,2,1"`。用返回的 template_id、panels 和 preview 路径对应展示线框图，每项一两句解释节奏。按宿主支持的图片展示方式嵌入本地 PNG（使用绝对路径）；没有图片展示能力就给可打开的路径并说明限制，不说“已展示”。

此时 layout suggest 别传 --page：它会立即写回几何，不是只读预览参数。安静对话也可以展示斜切供比较，但推荐平稳版式；动作或强烈情绪再推荐斜切，不只凭“看起来酷”选。

出线框预览时，告诉用户也可以在网页编辑器里拖格子、改文字框，并问“要在网页编辑器里打开吗？”。用户同意且目标页已保存后，由 AI 执行下列命令，把返回的 url 给用户；页还不存在时，先等用户选定方案并按第 4 节保存，不为打开编辑器替用户定稿。

```shell
soda-storyboard edit my-story --detach --page station-turn --json
```

命令中的项目目录和页 id 换成实际目标；在项目目录执行时可省略 my-story。无需 Node 或手动构建，命令会打开默认浏览器；--detach 立即返回，不挂住 AI 的执行命令。

**必须停下来等用户确认 ②：等待用户选择版式。不得根据默认排名替用户选第一项。**

## 4. 落成分镜单并预览

只有目标页不存在时用 page new 创建；它只创建空页，不自动创建格子。先在 JSON 中补入与已选方案相同数量的 panel 对象和连续 order（从 1 开始），再写回所选版式：

```shell
soda-storyboard page new --project my-story --id station-turn --direction rtl --dialogue-mode moss_text --text-direction vertical --color-mode monochrome --json
soda-storyboard layout suggest --page my-story/pages/station-turn.json --pick hero-top-skew --json
```

用候选返回的真实 id，别照抄示例。写回后按 [assets/storyboard-v1.schema.json](assets/storyboard-v1.schema.json) 和 [文件格式](references/storyboard-format.md) 填入每格的景别、角度、角色、画面、台词。保留无关字段、既有 id、数组顺序和用户设定。需要手法时查 [表现手法](references/expression-catalog.md)。角色外观来自角色卡，不重新发明。

每格补上 `figures`：谁（character_id）、姿势（pose）、站位（position）、朝向（facing），framing 可留空让景别推断。人物取景的大小由 framing 决定。草稿会显示圆头十字线、身体四肢和角色名；矩形与斜切格都会裁住人物。用 `texts` 给对白、旁白、拟声词、标题单独定位，bbox 是左上角原点像素 x/y/w/h，竖排要留竖长框，长句按默认 10 字换列。草稿稳定使用青色格子与格内人物、红色跨格人物和标题框、绿色文字框，并直接写出原文。

跨格主角和出格只是可选手法。只在人物登场、情绪高潮或需要强调某人时提议，并解释这一页为什么需要；日常对话和动作戏默认普通格子，绝不每页都塞主角大图。确需 MOSS 直接画跨格人物时，新增 overlay 必须显式写 `mode: "moss"`；要后期抠图叠加时用 `mode: "layer"`。旧文件缺 mode 继续按 layer 解释。

```shell
soda-storyboard validate my-story/pages/station-turn.json --json
soda-storyboard preview my-story/pages/station-turn.json --output my-story/previews/station-turn.png --json
```

每次修改后先 validate：有 error 就自行修正几何、缺失引用等可确定的问题并复验；不能擅自改掉用户剧情来消除问题。warning 要读原因：20 字警告解释给用户，多 LoRA 风险带上逐格处理建议，阅读顺序警告要检查实际线框。不可用“通过校验”证明图像生成一定正确。

修复同一问题两轮仍不通过，或需要用户未给的角色信息时，说明具体阻塞并等待必要信息，不无限重试、不带错交付。无 error 后展示更新的线框，说明哪些格子发生变化。

## 5. 逐格修改，等待整页确认

逐格修改时同样可提议打开网页编辑器；用户已经同意当前会话使用编辑器时，直接用上述 edit 命令打开目标页，服务会复用。用户说“在网页里改过了”时，继续修改前必须重新读取项目里的 `pages/<页id>.json`，以磁盘上的新版本为准，不能拿会话缓存覆盖网页保存的内容。顶部“与 AI 同步中”表示 SSE 已连接，断开时会自动重连；网页未保存或冲突时先让用户处理保存，再读文件。

会话结束或用户说不用编辑器了，提示可以停止服务；用户同意后执行（已经明确要求关闭时直接执行）：

```shell
soda-storyboard edit my-story --stop --json
```

用户说“让她坐下”“换到左边”时，按角色 id 找到目标格内的 figure，只改该人物的 pose 或 position，保留其他人物、texts 和格子几何，重新 validate、preview 并展示。用户说“第 3 格从背后看”，按 order=3 找格子，不按数组索引猜。只改这一格的画面描述和目标 figure 的 facing；背面、过肩、视线方向写进 description，angle 只能使用已有枚举（例如 eye / high / low），不要发明 back。除非用户要求改变几何，别重新运行布局写回而改动全页。再次 validate、preview，并核对其余格子及 overlays 未变。

**必须停下来等用户确认 ③：用户没有明确表示整页满意之前，不能 compile。** 让用户看到最后一版预览后确认；更改剧情、台词、版式后，旧版本的确认不自动算作新版本确认。已明确确认当前版本就继续，不重复索要许可。

## 6. 编译并交付

编译、出图或导出分镜包前，先同步英文译文。项目 `caption_language` 默认 `en`，可选 `zh`；用户明确选择中文出图时保留该选择。

```shell
soda-storyboard translate my-story/pages/page-01.json --todo --json
```

清单非空时，由当前插件 AI 翻译每格 `caption_zh`，遵守项目 `glossary`（如“猫胡子”译为 `cat whiskers`），角色已有 `appearances_en` 直接使用。每格写成完整的 MOSS 英文画面描述，不加 `Panel N`、格号、标签或台词原文；使用清单中的 `pose_templates_en`，保持人物姿势与朝向，先人物后场景，不自行消除冲突或改写中文剧情。若清单显示描述与姿势冲突，先提醒用户确认。译文保存为：

```json
{"translations": [{"panel_id": "p1", "source_hash": "照抄 todo 中的哈希", "text": "Full shot, eye-level, a girl lying on one side facing left, reading by the window."}]}
```

```shell
soda-storyboard translate my-story/pages/page-01.json --apply my-story/translations.json --json
```

哈希不符的格子会被拒绝，重跑 `--todo` 后重新翻译，不能覆盖检查或伪造新哈希。没有新鲜译文的格子会警告并回退中文，台词始终保留原文。核心库和网页不会调用翻译服务；网页只显示新鲜、过期或缺失状态。确认译文写回后，再执行编译、出图或导出；已授权步骤无需重复征求许可。

确认后读 [MOSS 要点](references/moss-layout-tips.md)，再 validate 一次并编译：

```shell
soda-storyboard validate my-story/pages/station-turn.json --json
soda-storyboard compile my-story/pages/station-turn.json --output my-story/output/station-turn.moss.json --slant-mode cut --json
```

交付页文件、线框和 MOSS JSON 的绝对路径。手动使用时，把 JSON 粘进 Soda-MOSS v2 的“JSON直通”框，画布尺寸与页面一致；斜切页的 `station-turn.moss.cut.json` 保存 quad 裁剪几何。也可按第 7 节直接驱动本机 ComfyUI。moss 模式 overlays 由 MOSS 画跨格人物；layer 模式在 cutout 后叠加透明人物。

preview 默认给带火柴人草稿；仅要旧纯框线版时用 `--style boxes`。尺寸核对只出现在 --json 命令报告或 --with-ids 的 map，不写进 --output 的 MOSS JSON，交付应使用输出文件。

生产输出不要加 --with-ids。如用户要调试映射，可单独生成带 ids 的调试输出和 map，别覆盖已交付的干净 MOSS JSON。把多 LoRA 的主角色、需单独处理的格子一并说明。

## 7. 经用户同意后出图与生产

整页确认并编译后，询问是否直接出草稿，建议默认 4 个种子、draft 预设。先说明 1024×1536 每张草稿约 40 秒，4 张约 160 秒；final 每张约 80 秒，排队和硬件会影响耗时。每次只跑用户同意的数量；用户已明确授权数量和步骤时直接执行，不重复确认，不擅自追加候选或重试生成。超时可能仍在服务端运行，先说明任务号，不自动再提交。

先读配置并检查节点、模型列表（只检查，不出图）。使用用户提供的地址、模型和 LoRA 路径，不搜索磁盘或代替用户安装节点。默认后端 minimal 不依赖 v2 自定义节点；需要 v2 时让用户提供 API 工作流路径。

```shell
soda-storyboard comfy config --project my-story --json
soda-storyboard comfy check --project my-story --json
soda-storyboard gen page station-turn --project my-story --seeds 4 --preset draft --lora auto --json
```

gen 会自动编译。按返回的 meta.candidate_sheet 绝对路径嵌入候选拼图，标出种子与对应 path；没有图片展示能力就给可打开的路径并说明。**等待用户选图**，不能自动挑第一张。用返回的完整 path 替换下例 render.png：

```shell
soda-storyboard pick station-turn render.png --project my-story --json
soda-storyboard plan station-turn --project my-story --json
```

向用户解释 plan：哪些格需要整格换人、哪些需要局部换人、斜切裁剪、出格抠图和排字。一次只加载一个人物 LoRA；auto 选出场最多的带 LoRA 角色，其他角色单独格用 swap 0.85，两人同格用 inpaint 0.85。detail 0.45 修细节。按用户同意逐步执行；每一步展示返回的图片，重画候选必须等待用户选择后 pick-panel。局部重绘先运行 `soda-storyboard inpaint station-turn p3 --project my-story --character girl --mask-only --json`（换成实际页、格和角色），嵌入返回的 mask 和 preview，让用户确认范围后再去掉 --mask-only 提交采样。这个预览步骤不连接 ComfyUI，也不消耗生成张数。遮罩按 figures 位置估计，重叠或大动作时在 figure.bbox 填入更准确的页面坐标 x/y/w/h，重新预览。重画保留 moss_text 文字框；提示词只能描述单张画面，不能带整页前缀。

```shell
soda-storyboard split station-turn --project my-story --json
soda-storyboard redraw station-turn p3 --project my-story --mode detail --json
soda-storyboard pick-panel station-turn p3 panel-render.png --project my-story --json
soda-storyboard compose station-turn --project my-story --cut-inset 12 --border-width 3 --json
soda-storyboard letter station-turn --project my-story --json
soda-storyboard export station-turn --project my-story --format png --json
```

swap 加 --character 角色id；两人同格用 inpaint 子命令（同样指定页、格子和 --character）。每次生成前说明这一张的大概耗时，按实际宽高和步数估算：40 秒 × 宽×高/(1024×1536) × 步数/25。compose 使用选定格子结果，quad 向内裁剪并重画边框；letter 为 lettering 模式或 texts.render_mode=lettering 的文字排字，字体找不到时请用户提供字体文件并用 --font 指定；moss_text 可用 --text 指定文字 id（可重复）。不擅自重写台词。

仅 mode=layer 的 overlay 使用 cutout；mode=moss 已由整页生成。cutout 先检查 BiRefNetRMBG / RMBG / rembg 节点，缺少时说明需安装 ComfyUI-RMBG 或提供透明 PNG，不自行安装。抠图生成同样需要说明耗时和取得用户同意。已有透明 PNG 可直接导入，不消耗生成次数。图层按 z_index 放在页面最上方，展示返回的 page_path。

```shell
soda-storyboard cutout station-turn hero --project my-story --png refs/hero-transparent.png --json
soda-storyboard export my-story --format pdf --json
```

最终交付成品图和导出文件绝对路径；说明仍未选择的重画或未处理的图层。export 按页序取 lettered、composed、选定底图中有效的最高阶段；换底图或换格子后需要重新 compose / letter，不将旧派生图当成新成品。

完整对话见 [车站示例](../../examples/station-dialogue.md)。

## 从分镜图或外来分镜导入

用户给火柴人分镜图时先提取颜色框坐标：

```shell
soda-storyboard layout extract reference.webp --mode auto --preview my-story/import-overlay.png --json
```

可手动指定 `--mode color` 或 `--mode standard`。颜色模式只分类，不做 OCR：青框是格子，绿框是文字框，红色大框是主角区域，横向红框是标题。遮挡边界会标记低置信度，先用叠加图核对。**坐标以识别结果为准，AI 只负责填内容**：由插件 AI 看原图，读出每格画面、台词和标题，把内容填入对应格子及文字框；不要凭读图重新发明坐标。红色主角区域需要时写为独立 `objects` 的 `label: "character"`，不得编造关节。生成分镜单后展示预览，等待用户确认，再按译文流程编译或导出。用户已确认的内容沿用，不重复索要确认。

MOSS JSON、其他 AI 的 JSON 或 Markdown 文字分镜可先只读导入：

```shell
soda-storyboard import external.json --json
soda-storyboard import external.md --project my-story --page-id imported-page --json
```

给用户解释理解报告中的尺寸、格数、未知条目和猜测；自由画布不强行套格。保留 `moss_import`，它记录未知字段、条目顺序和原始 bbox，未编辑的条目可无损编译回去。给其他 AI 的格式说明见仓库 `docs/for-other-ai.md`。

## 从喜欢的漫画页提取分格

用户说“照这一页的分格来”并给出图片路径时，先用 `layout extract "<图片绝对路径>" --direction rtl --preview "<叠加图绝对路径>" --json` 识别（同样先核对子命令帮助）。给用户看返回的叠加预览，解释数字是阅读顺序、橙色虚线是不确定格框；取得用户对格子和顺序的确认后，再运行 `layout extract "<图片绝对路径>" --name "<模板名>" --save --project "<项目绝对路径>" --json`。提醒用户模板只保存格子形状、来源文件名和识别日期，不保存原图；不要另行把参考页复制进项目。

保存后用 `layout suggest --panels <识别格数> --templates "<项目绝对路径>/templates" --pick <保存模板中的id> --json` 获取几何，再按既有流程用于拆格。候选标明“来自参考页”。用户画日漫时默认 rtl；用户明确要西式顺序时使用 ltr。识别结果必须核对，不把低置信度结果当成精确描摹；无框或复杂页面可请用户调整源分格。
