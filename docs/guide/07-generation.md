# 7. 出图和后期

「起身舒展」这张彩色成图，使用配套节点工作流在 ComfyUI 中手动运行：1024×1536、50 步、CFG 3、`euler / simple`、SLG 单层 22、种子 `20261022`，最后由 `SodaLetterPage` 加入三句中文台词。角色来自文字描述，没有参考图输入和 LoRA。

![分镜草稿与彩色排字成图](images/stretch-color-process.jpg)

这次完整执行约 **102.5 秒**。这是本机的一次记录，模型版本、硬件和队列都会影响结果与耗时。右侧主格保留了人物的完整舒展姿态；第 2 格仍偏坐姿，和“推开椅子站起”的描述不完全一致，所以出图后仍要核对动作。

要照着本例操作，直接去[下一章的 ComfyUI 步骤](08-comfyui.md)，打开[配套工作流](../../examples/stretch-color/workflows/stretch-color.workflow.json)并上传[分镜包](../../examples/stretch-color/exports/stretch-color.storyboard.json)。页面全是矩形格，工作流保留模型生成的格框，解码后直接排字、保存，没有再经过 `SodaCutQuads`。

## 先看成图，再决定要修哪里

第一遍先看主格的指尖、头顶和靴尖有没有被切掉，举臂与手部是否自然。随后比较各格的脸型、发型、礼服和配饰，再看三句中文有没有漏字、挡住脸，阅读顺序是否清楚。

手动工作流的 `SaveImage` 把结果保存到 ComfyUI 的 `output` 目录；配套工作流的前缀为 `SodaStoryboard/stretch-color`，会写入其下的 `SodaStoryboard` 子目录。可以在保存节点或任务历史中查看。

如果只想再试一个动作，在插件或网页里修改该格，确认草稿、补译、重新导出分镜包，再上传到节点运行。只换角色外观则修改 `characters/hiyone.json`，编译时会在各格统一读取新的角色卡。

## 可选：用 CLI 管理生成候选

下面是另一条生产路线，适合需要记录多张候选、选底图和继续做局部后期的情况。命令从**仓库根目录**执行，项目为 `examples/stretch-color`，页 id 为 `stretch-color`。建议先把完整示例复制一份用于练习。

**ComfyUI 手动保存的 PNG 不会自动登记成 CLI 候选。** 本教程展示的现成成图不能直接交给 `pick`。后面的 `pick`、`split`、重画和 CLI 后期，均从本路线实际生成并登记的候选开始。

先设置服务地址和模型，再做只读检查。示例中用本次运行的 `8190` 端口；如果你的 ComfyUI 使用 `8188` 或其他端口，换成实际地址。模型名也要与 ComfyUI 列表中的完整名称一致，子目录需一起填写。

```powershell
soda-storyboard comfy config --project examples/stretch-color --url http://127.0.0.1:8190 --backend minimal --model sft --sft moss_image_sft_int8_convrot.safetensors --clip qwen3.5_9b_w4a8_gptq.safetensors --vae flux2-vae.safetensors --json
soda-storyboard comfy check --project examples/stretch-color --json
```

CLI 默认 `minimal` 后端不需要导入工作流文件。若使用高级 `v2` 后端，需要单独的 API 工作流，不能将本例供画布打开的 `stretch-color.workflow.json` 当作 API JSON。

| CLI 预设 | 步数 | 采样器 / 调度器 | CFG | SLG |
| --- | --- | --- | --- | --- |
| `draft` | 25 | `er_sde / simple` | 2.5 | 无 |
| `final` | 50 | `euler / simple` | 3 | `single_layers=22` |

本章展示的成图采用与 `final` 相同的基础采样参数，实际由 ComfyUI 节点工作流生成，并非 CLI `draft` 结果。两条路线的负面条件、候选记录和后期步骤也有区别，同一种子不保证生成相同图片。

下面会提交 **1 张** final 候选，本页明确不使用 LoRA：

```powershell
soda-storyboard gen page stretch-color --project examples/stretch-color --seed 20261022 --preset final --lora none --json
```

`gen page` 会自动编译并记录实际种子与图片路径，返回的 `meta.candidate_sheet` 是候选拼图。想快速比较构图，也可以另选 draft 档生成两张随机候选：

```powershell
soda-storyboard gen page stretch-color --project examples/stretch-color --seeds 2 --preset draft --lora none --json
```

上面两条是不同的生成选择，按需要运行其中一条。`--seeds 2` 表示两次采样；需要指定多个种子时可重复 `--seed`，数量以给出的种子列表为准。提高步数也会改变画面，final 可能与 draft 构图不同。命令超时时，服务端任务可能仍在运行，先查看队列再决定下一步。

## 选底图，看后期计划

从 `gen page` 的返回结果中复制已登记候选的完整路径，替换下面的 `render.png`：

```powershell
soda-storyboard pick stretch-color render.png --project examples/stretch-color --json
soda-storyboard plan stretch-color --project examples/stretch-color --json
```

也可以使用唯一的候选文件名；直接复制进项目的图片不会自动登记。`plan` 会列出斜切、出框图层和排字等后续步骤。本例全是矩形、没有出框图层，主要需要程序排字。在 0.4.1 中，配角有自己的 LoRA 也不会因此自动安排换人。

重新选底图后，旧的格子选择和派生成品会失效，需要对新底图重新完成后期。

## 修一格或一小块

已有 CLI 选定底图时，可以拆出格子，只修有问题的一格。例如希望让第 2 格的起身动作更明确，先回分镜修改 `p2` 的描述并补齐英文译文，再执行：

```powershell
soda-storyboard split stretch-color --project examples/stretch-color --json
soda-storyboard redraw stretch-color p2 --project examples/stretch-color --mode detail --denoise 0.45 --seed 12345 --json
```

`detail` 适合修细节，默认降噪约 0.45。姿势需要较大变化时，可能还需调整降噪和描述，再看实际结果。重画结果仍是候选，检查后用返回的实际路径替换占位文件名：

```powershell
soda-storyboard pick-panel stretch-color p2 panel-render.png --project examples/stretch-color --json
```

只修人物附近区域时，可先离线查看第三格绯音的遮罩，不提交采样：

```powershell
soda-storyboard inpaint stretch-color p3 --project examples/stretch-color --character hiyone --mask-only --json
```

遮罩合适后，去掉 `--mask-only` 才会生成。范围偏小可用 `--margin` 扩大，边缘用 `--feather` 调整；人物框本身偏了，则回分镜调整几何。`inpaint` 默认降噪为 0.85，可按改动幅度降低。它与整格 detail 处理范围不同，不能只套同一个数值。

重画和局部重绘会先把格子放大到长边 1024、宽高对齐 16 的工作尺寸，生成后缩回原格。手、脸和动作仍需检查。`redraw --mode swap` 保留为单人格的手动高级选项，逐个替换 LoRA 角色可能造成画风和比例不一致，日常优先用 detail 或局部重绘。

## 出框人物和物件

本例没有出框图层。其他页面需要强调动作或人物时，可以增加跨格元素：

| 图层设置 | 怎么画 | 后续操作 |
| --- | --- | --- |
| `mode: moss` | 跨格人物直接进入整页 MOSS 提示词 | 不再单独 cutout |
| `mode: layer` | 作为透明图层后期叠加 | 生成并抠图，或导入已有透明 PNG |

`cutout_type` 中，`whole` 表示全身人物，`partial` 表示手、手臂等人物局部，`object` 表示物件。默认 `auto` 尝试判断，无法判断时按物件处理。局部特写要写清可见范围。

为自己的页面新增 `hero` 图层后，已有透明 PNG 可以离线导入：

```powershell
soda-storyboard cutout stretch-color hero --project examples/stretch-color --png refs/hero-transparent.png --json
```

这条命令仅适用于已新增 `hero` 的页面；原样示例没有该图层。`--png` 的相对路径按项目目录解析，此处为 `examples/stretch-color/refs/hero-transparent.png`。省略它则会调用模型，并需要 BiRefNetRMBG / RMBG / rembg 等可用抠图节点。`redraw`、`inpaint` 和生成式 `cutout` 都支持 `--seed`。

## 拼页、排字、导出

CLI 候选已选定后，本例没有局部重画和叠加层时，可以直接调用排字、导出命令；`letter` 找不到有效拼页时会自动完成 CLI 拼页步骤：

```powershell
soda-storyboard letter stretch-color --project examples/stretch-color --json
soda-storyboard export stretch-color --project examples/stretch-color --format png --json
```

如果已经选择了重画格子，或页面有斜格、出框图层，先拼页，再排字：

```powershell
soda-storyboard compose stretch-color --project examples/stretch-color --cut-inset 12 --border-width 3 --json
soda-storyboard letter stretch-color --project examples/stretch-color --json
soda-storyboard export stretch-color --project examples/stretch-color --format png --json
soda-storyboard export examples/stretch-color --format pdf --json
```

`compose` 会使用已选格子，按四边形裁剪斜格、重画边框并叠加图层；它不是本例手动节点工作流的一步。`letter` 为 `lettering` 模式的文字排字，也支持单条文字的程序排字。`moss_text` 页只想补排其中几条时，可重复传入 `--text <文字id>`。

找不到中文字体时，用 `letter --font <字体文件>` 指定。排字后检查换行、竖排标点和气泡遮挡。导出使用当前有效结果中阶段最高的一张：排字图、拼页图、选定底图依次回退；整项目 PDF 按页序合并。

[下一章：在 ComfyUI 里用](08-comfyui.md) · [返回目录](README.md)
