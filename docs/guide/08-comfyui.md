# 8. 在 ComfyUI 里用

这一章用「起身舒展」的彩色成图，把分镜从插件交给 ComfyUI。25 岁原创女主绯音的黑长发、红紫眼和酒红礼服都通过文字提示词定义；工作流没有参考图输入，也不使用角色 LoRA。

![绯音的彩色五格漫画](images/stretch-color-finished.png)

需要已发布的 **soda-storyboard 核心库 0.4.1**，安装到 ComfyUI 实际使用的 Python 环境，并安装 [ComfyUI-Soda-Storyboard 节点包](https://github.com/cOkieeman/ComfyUI-Soda-Storyboard)。安装步骤见[第 2 章](02-installation.md)。本例使用 `scene-v1` 英文缓存；0.4.0 会把这份示例的缓存判为过期，试用前请升级。

## 1. 准备配套工作流与分镜包

本仓库已经附带完整的 [examples/stretch-color 项目](../../examples/stretch-color/)，命令从**仓库根目录**执行。第一次试用主要需要两个文件：

| 文件 | 打开方式 |
| --- | --- |
| [workflows/stretch-color.workflow.json](../../examples/stretch-color/workflows/stretch-color.workflow.json) | 在 ComfyUI 按 `Ctrl+O` 打开，或拖到空白画布 |
| [exports/stretch-color.storyboard.json](../../examples/stretch-color/exports/stretch-color.storyboard.json) | 工作流打开后，上传到已有的“导入分镜”节点 |

工作流保存连线和参数，分镜包保存当前页、角色卡与项目设置，两者需要分别加载。通过 GitHub 单独下载时，使用 **Raw / Download raw file** 保存 JSON 原文。

想修改原项目，可以先复制整个示例目录，再对插件说：

> 打开这个项目的 stretch-color 页，保留绯音的外观和彩色画风，把第二格的起身动作画得更明确。先给我看更新草稿，确认后补译并导出分镜包，我自己在 ComfyUI 运行。

改完确认整页内容、补齐英文场景译文后，重新导出：

```powershell
soda-storyboard export-bundle examples/stretch-color/pages/stretch-color.json --json
```

默认写入 `examples/stretch-color/exports/stretch-color.storyboard.json`。导出只封装分镜资料，不提交采样；模型、LoRA 和参考图片文件也不会装进包里。本例没有 LoRA 或图片条件，只需另外准备后面的三个基础模型。加 `--no-sketch` 可以省略草稿缩略图。

## 2. 上传，先看提醒与草稿

打开配套工作流后，将分镜包拖到已有“导入分镜”节点的预览区，或点击“上传”。工作流中的文件选择已留空，别人的上传副本不会跟随工作流出现。拖到空白画布会新建一个导入节点，首次使用请沿用工作流中已接好线的节点。

![彩色分镜包的导入节点](images/stretch-color-import.png)

先核对顶部信息：**1024×1536、5 格、3 句台词、英文译文新鲜、本页不使用 LoRA**。查看草稿和提示词不需要运行采样。

本页从右向左阅读：右上结束工作 → 左上起身准备 → 右侧竖向主格舒展全身 → 左侧上格呼气特写 → 左下邀请同伴。青色人物是取景与姿势示意，绿色框是独立文字对象。

导入节点也支持其他文件：

| 文件 | 从哪里取得 | 注意什么 |
| --- | --- | --- |
| 分镜包 `*.storyboard.json` | 插件或 CLI `export-bundle` | 包含页、出场角色卡和设置，适合完整交接 |
| 裸分镜单 `pages/<页id>.json` | 故事项目中的页文件 | 文件本身没有角色卡时会提醒，外观和 LoRA 信息可能缺失 |
| MOSS JSON | 其他 AI、编译输出或已有工作流 | 主要是提示词和位置框，也可能是没有漫画格的单画布 |

黄色提醒会说明缺角色卡、译文过期等问题。旧文件的顶部译文标签有时与详细提醒不一致；如果提醒写着“需要重新翻译”，回插件按待办补译。

## 3. 核对人物、提示词与台词

“分镜图”看人物和文字位置，“逐格”对照画面描述、角色和台词，“提示词”查看实际输出的完整 MOSS JSON，可以复制全文。“格式化”只调整显示方式。

节点里看不清时，点“查看”或分镜图打开大窗口：

![彩色示例的大窗口查看器](images/stretch-color-viewer.png)

左侧看整页，右侧核对各格；滚轮缩放、拖动平移，“适应”显示全页，“100%”恢复原尺寸。悬停右侧某一格，会高亮左侧对应区域。

本例的人物效果来自共用角色卡、逐格动作和页面画风。角色卡固定黑发、礼服和配饰；第三格写清举臂、轻微转身、肩髋错位与完整全身；页面画风统一暖金与冷紫灯光。具体编译规则见[提示词说明](06-prompts.md)。

“高级”里可以调整台词模式、斜切模式和自动触发词。导入 MOSS JSON 时还能填写宽高，覆盖自动推断的尺寸。端口与选项见[节点 README](https://github.com/cOkieeman/ComfyUI-Soda-Storyboard#使用方法)。

## 4. 在 Loader 中选择本机模型

工作流只保存模型的基本文件名，打开后要在原生 Loader 的下拉框中重新选择本机文件。放在子目录中也可以，选中列表里的实际名称即可。

| 节点 | 本次使用的文件或设置 |
| --- | --- |
| `UNETLoader` | `moss_image_sft_int8_convrot.safetensors` |
| `CLIPLoader` | `qwen3.5_9b_w4a8_gptq.safetensors`，类型选 `moss_image` |
| `VAELoader` | `flux2-vae.safetensors` |

本例没有 `LoraLoaderModelOnly`，角色由[绯音角色卡](../../examples/stretch-color/characters/hiyone.json)定义。ComfyUI 需支持 `moss_image`、`EmptyFlux2LatentImage` 和核心节点 `SkipLayerGuidanceDiTSimple`；打开后缺少 SLG 时，先更新到支持该节点的 ComfyUI。

## 5. 手动运行，排字并保存

确认批次数量为 **1**，核对采样参数后点击 ComfyUI“运行”：

| 参数 | 本次设置 |
| --- | --- |
| 尺寸 | 1024×1536 |
| `ModelSamplingAuraFlow` shift | 5 |
| 种子 | `20261022`，`fixed` |
| 步数 / CFG | 50 / 3 |
| 采样器 / 调度器 | `euler` / `simple` |
| 降噪 | 1 |
| SLG | `double_layers` 留空，`single_layers` 为 `22`，start 0、end 1 |

连线已经配好：`moss_json` 接正面文本编码，`negative` 接负面文本编码，`width` / `height` 接 latent 尺寸，`page_info` 接后面的排字节点。

```text
导入分镜 → MOSS 采样 → VAE 解码 → SodaLetterPage 程序排字 → SaveImage
```

五格全为矩形，本工作流保留模型生成的格框，解码后直接排字，**没有接 `SodaCutQuads`**。本例完整执行约 102.5 秒；这是一次本机实测，不是通用速度保证，相同种子也可能因模型与环境产生不同结果。

![本地草稿与彩色排字成图](images/stretch-color-process.jpg)

最后从“保存结果”节点或 ComfyUI 任务历史查看成图。配套前缀 `SodaStoryboard/stretch-color` 会将 PNG 写入 ComfyUI 的 `output/SodaStoryboard/`。中文台词由 `SodaLetterPage` 绘制；找不到中文字体时，在它的字体字段填写本机可用的中文字体文件路径，例如思源黑体或 Noto Sans CJK。

看图时检查手部、双臂、人物轮廓、各格外观和气泡遮挡。本次第 2 格仍偏坐姿，与预定的起身动作有偏差，可以作为下一次局部修改的练习。

## 其他工作流怎么选

本例优先使用上面的本地工作流。节点仓库还保留三个通用模板，参数和后处理与本页不同：

| 工作流 | 适用场景 | 开始前检查 |
| --- | --- | --- |
| [minimal_page.json](https://github.com/cOkieeman/ComfyUI-Soda-Storyboard/blob/main/example_workflows/minimal_page.json) | 通用整页生成，含斜切后处理 | 25 步、CFG 2.5、`er_sde / simple`；含 `SodaCutQuads` |
| [panel_redraw.json](https://github.com/cOkieeman/ComfyUI-Soda-Storyboard/blob/main/example_workflows/panel_redraw.json) | 已有整页，只修一格 | 载入已有原图，选正确格子，默认降噪 0.45 |
| [character_swap.json](https://github.com/cOkieeman/ComfyUI-Soda-Storyboard/blob/main/example_workflows/character_swap.json) | 按人物所在区域局部重绘 | 切格与遮罩选同一格，默认降噪 0.85 |

第三个文件沿用旧名称，日常也可用来修人物细节。需要 LoRA 的其他项目，在原生 `LoraLoaderModelOnly` 中手选实际文件和强度；不用时旁路该节点。导入节点给出的 LoRA 建议不会代替手动选择模型。

接入自己的工作流时，将 `moss_json` 接 MOSS 文本编码、`width` / `height` 接尺寸；后面的切格、裁斜边和排字使用 `page_info`。更多端口见[节点一览](https://github.com/cOkieeman/ComfyUI-Soda-Storyboard#节点一览)。

## 上传副本与原项目

上传文件保存在 ComfyUI 的 `input/soda-storyboard/` 下，是原项目的一份副本。回插件改过原项目后，需要重新导出、上传。经常两边来回改时，也可以用“链接分镜项目”进阶节点持续读取本机项目。

点导入节点的“编辑”可以修改工作副本。等网页保存完成后节点会刷新；改完用“⋯ → 另存为新分镜包”下载。关闭侧栏后编辑器服务仍会运行，需要时点“停止本项目编辑器”。

这里手动生成的 PNG 不会自动登记为 CLI 候选。想继续使用 `pick`、`split` 等 CLI 生产命令，请按[第 7 章的候选生成路线](07-generation.md)开始。

[下一章：导入别人的分镜](09-import.md) · [返回目录](README.md)
