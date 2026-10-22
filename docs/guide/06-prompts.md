# 6. 提示词是怎么来的

打开最终提示词时，你会看到一整段描述，里面不只有自己写的中文场景，还有人物外观、朝向和“右上方竖格”这样的位置信息。它们来自分镜的不同部分，由程序在编译时拼起来。

默认用英文描述画面，台词保留中文原文。日常修改仍然用中文就行，下面解释这些内容怎样变成 MOSS 布局 JSON。

![绯音的五格分镜草稿](images/stretch-color-sketch.png)

这一章沿用「起身舒展」彩色示例。绯音的黑长发、酒红礼服来自角色卡；第一格坐着、第三格抬臂舒展来自人物设置和逐格描述；暖金灯光与冷紫帘幕来自场景和页面画风。可以对照[原始分镜页](../../examples/stretch-color/pages/stretch-color.json)、[角色卡](../../examples/stretch-color/characters/hiyone.json)和[完整 MOSS JSON](../../examples/stretch-color/output/stretch-color.moss.json)查看。

## 一格会拆成哪些内容

MOSS JSON 中，`summary` 说明整页的画风、阅读方向和留白要求。每格则有一个 `object` 条目，把几何位置、镜头、人物和场景放在一起。

这个条目的 caption 会先说格子在什么位置、是什么形状，再写景别和角度，接着是人名、角色卡外观与姿势，最后接上场景译文。你移动格子，顶部、左侧、横格或斜格这些方位说法就会重新计算。

人物另外有 `character` 条目，框的范围来自草稿骨架，帮助模型安排人物位置；`mode: moss` 的跨格人物也编译成这种条目。骨架通过人物框与姿势文字参与编译，这份工作流没有额外输入姿势控制图片。对白、旁白、拟声词和标题使用 `text` 条目时，原文单独放在 `text` 字段中。

台词模式决定文字在哪一步画。选 `moss_text` 时，原文和文字框会送给模型；选 `lettering` 时，编译会把台词留给后期排字，要求模型先画没有气泡的画面。绯音这一页采用 `lettering`，因此 MOSS JSON 中有 5 个 `object` 和 5 个 `character`，三句中文台词保留在分镜页及分镜包中，最后由排字节点绘制。

写内容时，可以按下面的分工修改：

| 内容 | 本例放在哪里 | 编译时怎样使用 |
| --- | --- | --- |
| 固定外观和服装 | `characters/hiyone.json` 的 `appearance.zh/en`、`clothing` | 各格统一读取；更换发型、眼睛或礼服时改这里 |
| 人物位置和基本姿势 | 每格的 `figures`，如 `pose: sit`、`facing: right` | 生成人物框与坐姿、朝向等短语 |
| 具体动作、表情和环境 | 每格 `description` | 翻译场景文字；例如手腕怎样相搭、肩髋错位和灯光 |
| 整页画风 | 页面的 `style_prompt` | 统一彩色动漫质感、线条、上色和光色 |
| 台词和文字位置 | 页面的独立 `texts` | 按台词模式送给模型或留给程序排字 |

第三格的自然舒展需要明确描述抬臂、轻微转身、一腿承重，并留出指尖和靴尖的空间。角色外观在角色卡里共用，场景描述只需安排她在这一格做什么。

## 翻译只处理场景、动作和道具

```powershell
soda-storyboard translate examples/stretch-color/pages/stretch-color.json --todo --json
```

本章命令从**仓库根目录**执行，需要已安装核心库 0.4.1。配套示例的五格已经补齐译文，原样执行时待办应为空；改过场景描述后才会列出需要更新的格子。

插件 AI 负责翻译待办中 `source_zh` 的场景、动作和道具，并按项目术语表选词。衣服和外观已经在角色卡里，镜头、方位和自动姿势也都有来源，译文里无需再写一遍。

下面是配套 [translations.json](../../examples/stretch-color/translations.json) 中第一格的真实记录。它对应放下笔、结束工作的场景，`source_hash` 是这一版中文内容的校验值：

```json
{
  "translations": [
    {
      "panel_id": "p1",
      "source_hash": "3a8f4ea456d50c584dd8a48a3585aa2fedb932e304bbfc9bcf1bb8ef43c7059a",
      "text": "Autograph cards are stacked neatly beside a pen and an open notebook on the table. She has just put down the pen and lifts her gaze with a relieved smile after finishing her work. Only softly blurred warm golden bulbs and muted violet curtains appear behind her, keeping the dressing room uncluttered."
    }
  ]
}
```

改过中文时，必须使用**当前待办**给出的新哈希与新内容，更新项目中的 `translations.json`；上面的旧哈希只适用于未改动的这一版。准备好译文文件后写回：

```powershell
soda-storyboard translate examples/stretch-color/pages/stretch-color.json --apply examples/stretch-color/translations.json --json
```

因此，`--todo` 和 `--apply` 之间还有 AI 写译文这一步。核心库和网页本身不调用翻译服务，只负责列待办、校验和保存。

## “新鲜”“过期”“需要重新翻译”

| 状态 | 含义 | 下一步 |
| --- | --- | --- |
| 新鲜 | 缓存对应当前中文来源 | 可继续编译 |
| 过期 | 场景、动作或道具的中文变了 | 重跑待办、翻译、写回 |
| 缺失 | 这一格还没有缓存 | 让 AI 补译 |
| 需要重新翻译 / legacy | 旧缓存没有新版场景译文标记 | 根据新的 `source_zh` 重新翻，不沿用含外观的旧整句 |

译文是否过期，看的是待翻译中文有没有变。只是挪了格子或改了角色卡上的衣服，场景译文仍然有效；编译会取最新的位置和外观。`--apply` 自动在页面的 `caption_auto_en` 缓存中写入 `format: scene-v1` 标记，用来和旧整句缓存区分；提交译文的 JSON 无需手写该标记。本例五格缓存都已使用 `scene-v1`。

缺失或过期的格子会提醒，并退回整理后的中文，所以文件能导出，并不表示每一格都已用上英文。写回遇到哈希不符，通常说明中文在翻译期间又变了，重新列待办、按新内容翻译即可。

如果希望“签名卡”这样的词每次译法一致，可以在项目 `project.json` 里加术语表：

```json
{"glossary": {"签名卡": "autograph card"}}
```

把这段字段合并进原文件即可。如果本来就想用中文出图，设置 `caption_language: zh` 后沿用中文，不需要为了清空英文待办而换语言。

## 看一个真实编译结果

彩色页的第一格编译后，画面条目如下。这是配套 `stretch-color.moss.json` 中的真实 `object`；完整文件还包含 `summary`、人物和其他格子：

```json
{
  "label": "object",
  "caption": "Top-right horizontal panel: Medium shot, eye-level. 绯音, a beautiful 25-year-old adult anime woman, a delicate softly tapered face and small refined chin, large luminous crimson-purple eyes with finely drawn upper lashes and subtle burgundy eyeshadow, a tiny softly indicated nose and soft slightly parted lips, long flowing silky jet-black hair reaching her waist with neat straight blunt bangs and short hime-cut side locks framing the cheeks, a voluptuous yet harmonious hourglass silhouette with a full bust, defined slender waist and long graceful legs, wearing a fitted opaque wine-red halter evening dress with off-shoulder bow straps and a draped side-slit skirt, wine-red lace gloves, black over-the-knee boots, silver four-point star earrings and a silver geometric pendant necklace, sitting, facing right. Autograph cards are stacked neatly beside a pen and an open notebook on the table. She has just put down the pen and lifts her gaze with a relieved smile after finishing her work. Only softly blurred warm golden bulbs and muted violet curtains appear behind her, keeping the dressing room uncluttered.",
  "bbox": [-718, 12, -419, 464]
}
```

对照这段就能看出：`Top-right horizontal panel` 来自格框位置；`Medium shot, eye-level` 来自镜头；长发、红紫眼和酒红礼服来自角色卡；`sitting, facing right` 来自第一格的 `figures`；后面才是 AI 补译的签名卡、放笔和后台环境。译文仍然要交代谁在做什么，只是不必再描述一遍长相。

编译命令：

```powershell
soda-storyboard compile examples/stretch-color/pages/stretch-color.json --output examples/stretch-color/output/stretch-color.moss.json --slant-mode cut --json
```

坐标也在编译时转换：源页用左上角像素 `x/y/w/h`，MOSS 用中心原点的整数 `[y_min, x_min, y_max, x_max]`，并声明 `abs_centralized` 和 `yxyx`。平时在编辑器里摆位置，无需手算。

本例全为矩形格，不会产生斜切裁剪文件。有斜切格的其他页面使用默认 `cut` 时，还会产生 `*.moss.cut.json`，供后期按真实四边形裁剪；给模型的是 `*.moss.json`。`--with-ids` 用于调试，会增加辅助字段和 map，日常交付无需加。

[下一章：出图和后期](07-generation.md) · [返回目录](README.md)
