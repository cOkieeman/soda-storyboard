# 3. 从这张彩色漫画开始

![绯音的彩色五格漫画成品](images/stretch-color-finished.png)

这章用上面这张实测成图，走一遍插件的创作过程：和 AI 商量人物与镜头，看草稿，在网页里微调，确认后导出分镜包，最后交给 ComfyUI 节点出图和排字。

故事很短：

> 演出后台，绯音签完最后一张卡片，放下笔起身舒展。她放松地呼了口气，发现门边的同伴，笑着邀请对方去喝点东西。

绯音是 25 岁的原创成年女性。这页用黑长发、红紫眼、酒红礼服、蕾丝手套和黑长靴建立人物识别度，用右侧全身主格突出舒展姿态，配合暖金灯光与冷紫色帘幕。角色通过**文字提示词**描述，没有图片输入，也没有角色 LoRA。

## 1. 先复制完整示例

按 [安装章](02-installation.md)装好核心库和 Codex / Claude Code 插件。本例需要 **soda-storyboard 0.4.1 或更高版本**；如果要自己出图，还需要支持 MOSS 的 ComfyUI、节点包和模型。

下载本仓库后，把 [examples/stretch-color](../../examples/stretch-color) 整个目录复制到自己的故事目录。保留目录结构，项目设置、页面和角色卡才能一起读取。这里已经有一页完整分镜，直接读取即可。

| 文件 | 保存什么 |
| --- | --- |
| `project.json` | 默认画风、画布、阅读方向与 LoRA 策略 |
| `pages/stretch-color.json` | 五格画面、人物姿势与三句台词的位置 |
| `characters/hiyone.json` | 绯音的中英文外观与服装 |
| `translations.json` | 英文场景译文 |
| `exports/stretch-color.storyboard.json` | 可以直接上传到 ComfyUI 的分镜包 |
| `workflows/stretch-color.workflow.json` | 配套的 ComfyUI 工作流 |
| `output/character-prompt.txt` | 本次使用的角色英文描述 |

下面的命令从**本仓库根目录**运行，统一以 `examples/stretch-color` 为项目路径，页 id 为 `stretch-color`，角色 id 为 `hiyone`。在自己的副本练习时，把命令中的项目路径一起换成副本目录。

## 2. 把故事、画风和角色告诉插件

在加载了插件的聊天中，把自己的项目目录告诉 AI，再说：

> 用 soda-storyboard 读取这个项目。先给我看 stretch-color 页的故事、角色和草稿。这次保留彩色动漫画风、25 岁成年女主绯音和五格版式，重点是舒展身体时自然好看的全身姿态。台词保留中文，用程序后期排字。

如果从自己的新故事开始，可以这样提出需求：

> 女主结束工作后起身舒展，再笑着邀请同伴喝点东西。先给我 2～3 个拆格方案，再比较版式；想让人物的脸、长发和身材都得到表现，主画面保留完整全身。先讨论，选好以后再保存分镜。

插件会把故事拆成“先看到什么、在哪里停一下”。新故事可以比较几种拆格和版式，再选自己喜欢的；当前示例已经选定五格，不需要重新创建项目或空页。

角色外观也在这时说明白。绯音的固定设定是黑色及腰长发、整齐齐刘海与两侧姬式发束、红紫色眼睛、酒红色挂脖礼服与垂坠开衩裙摆、蕾丝手套、黑色过膝长靴和银色星形耳坠。插件把这些内容存进角色卡，逐格共用，详细写法见 [角色卡](04-characters.md)。

画风则存进项目或页面：本例是彩色二维动漫、细线、柔和赛璐珞与渐变上色，以暖金和冷紫灯光统一整页。人物外观、画风和每格动作分别写清楚，比只说“画好看一点”更容易继续修改。

## 3. 看五格怎样突出人物

![起身舒展的五格草稿](images/stretch-color-sketch.png)

这页从右上向左下阅读：上方先右后左，再看右侧竖向大格，最后读左侧上下两格。

| 顺序 | 内容 | 为什么这样安排 |
| --- | --- | --- |
| 1 | 签完卡片，放下笔：“终于弄完了……” | 交代后台环境和结束工作后的轻松心情 |
| 2 | 推开椅子起身，双手轻轻交握 | 为伸展动作留一个过渡 |
| 3 | 双臂举过头顶，身体自然伸长 | 用最大的竖格展示完整人物，给指尖与靴尖留余量 |
| 4 | 放松后的脸部特写：“呼……” | 从全身回到表情，表现舒展后的惬意 |
| 5 | 看向门边同伴：“走吧，陪我喝点东西。” | 用一个亲近的邀请结束这一页 |

青色人物是构图和姿势示意，绿色框是独立的文字对象。页面里用 `figures` 记录人物，用 `texts` 单独放台词与气泡位置，方便分别修改。

骨架帮助表达取景、朝向和动作，模型接收的仍是文字描述与位置框。握腕、视线和表情等细节也要写入画面描述。想调整主格，可以对插件说：

> 第三格身体侧弯少一点，双手自然搭在头顶上方，肩部放松。保持完整全身，头顶、指尖和靴尖都不要贴着格框。其他格子和台词保持原样。改完先给我看草稿。

<details>
<summary>手动校验并生成草稿</summary>

```powershell
soda-storyboard validate examples/stretch-color/pages/stretch-color.json --json
soda-storyboard preview examples/stretch-color/pages/stretch-color.json --output examples/stretch-color/output/stretch-color-sketch.png --json
```

草稿由本地工具绘制，不调用 ComfyUI，也不消耗生成次数。校验能发现几何与引用问题，人物最终画得怎样仍需要看成图。

</details>

## 4. 在网页编辑器里微调

对插件说“打开这一页的网页编辑器”，就可以自己拖动。

![彩色示例在网页编辑器中的布局](images/stretch-color-editor.png)

点格子改描述，点人物调姿势、朝向或关节，点文字改台词和框的位置。可以先只移动最后一格的气泡，观察它与人物脸部之间的距离；具体操作见 [网页编辑器](05-editor.md)。

网页与插件共用项目文件。拖完以后等界面显示保存完成，再告诉 AI：

> 我在网页里改过了，重新读取项目文件，再给我看更新草稿。

这样 AI 接着修改的就是刚保存的版本。没有改动的位置、人物和台词应继续保留。

```powershell
soda-storyboard edit examples/stretch-color --detach --page stretch-color --json
```

## 5. 确认整页，补译并导出

看到最后一版草稿、确认构图和台词以后，再告诉插件：

> 就按这版。检查英文译文，只补齐有变化的场景和动作，角色外观继续用角色卡，台词保留中文。编译并导出分镜包，我自己在 ComfyUI 运行。

随包示例已经有英文译文。页面没有变化时，待办应为空，可以直接编译和导出；改过画面描述时，插件会先检查哪些格子需要更新译文。

<details>
<summary>手动查看待办、写回译文并导出</summary>

```powershell
soda-storyboard translate examples/stretch-color/pages/stretch-color.json --todo --json
```

清单非空时，让插件 AI 依据最新 `source_hash`，只翻译场景、动作和道具，写入 `examples/stretch-color/translations.json`。人物外观由编译器从角色卡插入，台词保留原文。准备好译文后执行：

```powershell
soda-storyboard translate examples/stretch-color/pages/stretch-color.json --apply examples/stretch-color/translations.json --json
```

如果哈希不匹配，重新查看待办并更新对应译文。没有待办时可以跳过写回。

```powershell
soda-storyboard validate examples/stretch-color/pages/stretch-color.json --json
soda-storyboard compile examples/stretch-color/pages/stretch-color.json --output examples/stretch-color/output/stretch-color.moss.json --json
soda-storyboard export-bundle examples/stretch-color/pages/stretch-color.json --json
```

</details>

编译得到 MOSS 使用的布局 JSON，导出得到 `examples/stretch-color/exports/stretch-color.storyboard.json`。分镜包把当前页、出场角色卡、项目设置与草稿缩略图装进一个文件，方便交给节点。导出本身只整理本地文件，不会提交生成任务。

## 6. 交给 ComfyUI，自己点击运行

在 ComfyUI 按 `Ctrl+O` 打开 `examples/stretch-color/workflows/stretch-color.workflow.json`。从 GitHub 单独下载时，用 **Raw / Download raw file** 保存 JSON 原文。

然后把刚导出的 `exports/stretch-color.storyboard.json` 拖到“导入分镜”节点预览区，或点击“上传”选择文件。配套工作流没有携带你电脑上的上传副本，所以打开工作流后仍需要上传分镜包。

![彩色分镜包的节点导入预览](images/stretch-color-import.png)

核对 **1024×1536、5 格、3 句台词、英文译文新鲜、本页不使用 LoRA**。在“逐格”里看故事，在“提示词”里看实际输出的 MOSS JSON，点“查看”打开大窗口。

![彩色分镜包的大窗口查看器](images/stretch-color-viewer.png)

在 `UNETLoader`、`CLIPLoader`、`VAELoader` 中重新选本机模型。此次使用 MOSS-Image SFT INT8、`qwen3.5_9b_w4a8_gptq.safetensors` 和 `flux2-vae.safetensors`，文本编码器类型选 **`moss_image`**。

配套工作流保存了本次实测参数：1024×1536、shift 5、50 步、CFG 3、`euler` / `simple`、SLG 单层 `22`、固定种子 `20261022`。确认批次数量为 **1** 后，手动点击“运行”。这套设置属于随包节点工作流，不等同于 CLI 的默认生成预设。

本页全为矩形，解码后直接接“排字” `SodaLetterPage`，再由 `SaveImage` 保存。工作流保留模型画出的格框，没有接 `SodaCutQuads` 重画边框。三句中文台词由程序绘制气泡和文字。

结果在最后的保存节点、任务历史和 ComfyUI 的 `output` 目录查看。详细连线、字体与节点编辑方法见 [ComfyUI 用法](08-comfyui.md)和[节点侧完整教程](https://github.com/cOkieeman/ComfyUI-Soda-Storyboard/blob/main/docs/tutorial-stretch-color.md)。

## 7. 看结果，再提出具体修改

![本地分镜草稿与生成并程序排字的成图](images/stretch-color-process.jpg)

先看主格人物是否完整、手部和双臂是否自然，再看各格发型、脸型和服装是否一致，最后读三句台词，检查气泡有没有挡脸。

本次成图的第 2 格仍偏坐姿，和“推开椅子站起”的描述不完全一致。下一轮可以明确提出：

> 第二格镜头稍微拉远，让椅面和站起后的腰胯都进入画面；臀部已经离开座面，双脚着地，表现起身后的重心。保留其他格子、角色外观和台词，先改草稿给我看。

插件修改后，重新确认、补译、导出，再上传到节点。ComfyUI 中的上传文件是副本，原项目保存后的变化需要通过新分镜包带过去。

本次在我们的机器上完整执行约 **102.5 秒**，仅供参考。硬件、模型版本与运行环境会影响耗时和画面，相同种子也不保证逐像素一致。

用完网页编辑器后，可以让插件停止后台服务：

```powershell
soda-storyboard edit examples/stretch-color --stop --json
```

[下一章：角色卡怎么写](04-characters.md) · [返回目录](README.md)
