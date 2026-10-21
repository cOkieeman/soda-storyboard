# Soda Storyboard 本地编辑器 API（P4a）

此文档用于 Gemini 开发基于 OpenKoma 的 React + TypeScript 前端。启动命令见 [README.md](README.md)。基础地址是 `http://127.0.0.1:8780`；所有 `/api/` 响应默认是 UTF-8 JSON，PNG 和 SSE 除外。以下页面、角色、编译、模板示例取自仓库 `examples/pudding`，服务测试与文档采样只操作其临时副本。

ID、ETag、任务 ID、时间和候选 ID 是运行时值，示例不可当作常量。JSON 示例没有省略对象字段；模板数组示例只列一项，实际可返回多项。生产计划示例来自当前 P3 的本地调用；异步出图结果示例表示假模块验证过的协议，不表示已经真实生成图片。

## 1. 通用约定

- 请求体必须是 JSON 对象，`Content-Type: application/json`；无参数 POST 可发送 `{}`。最大 4 MiB，不支持分块请求体；非法 JSON / NaN / Infinity 返回 400。
- ID 用文件名标识；页面 `id` 必须与 URL 一致。建议 ASCII 字母、数字、短横线和下划线；允许中文，禁止空值、首尾空白、点号及路径/Windows 文件名特殊字符。URL 路径片段用 `encodeURIComponent` 编码。
- 页面列表按 JSON 文件名排序；数组 `order` 是格子阅读顺序（从 1 连续排列）。第一页不固定叫 `pudding`，应从列表选取。
- 文件响应中的 `path` 是项目内相对路径。JSON 内保留未知字段，前端应以完整对象读改写，保留未编辑字段。预览与编译沿用 CLI 的项目默认值继承：缺省 text_direction/color_mode/tags 从项目读取，空 style_prompt 也继承项目；这不会单独改写分镜 JSON。
- 服务生成文件先写同目录临时文件，再原子替换；同一服务进程内的编辑请求串行写盘。核心校验及预览/版式/编译直接复用现有库。
- 服务无认证，只接受回环 Host；供本机单个服务进程管理一个项目。不要给同一个项目启动多个服务。CLI 不配合服务锁：保存会在校验后及替换前再次检查版本，但操作系统不提供与任意外部写入者之间的原子 compare-and-swap，外部工具应使用原子写入，并避免在同一瞬间争写。
- 静态资源来自 `--static` 目录；无 SPA 路由回退，前端可使用 HashRouter。

### 1.1 错误码

| HTTP | 含义及前端处理 |
| --- | --- |
| 200 / 201 | 成功 / 新建成功。页面响应可带 `warnings`。 |
| 202 | 已入队，响应是任务对象，不是最终出图结果。 |
| 204 | OPTIONS 成功，无响应体。 |
| 400 | JSON、参数、ID、路径、文件类型或预览资源限制有误。 |
| 403 | 不允许的 Origin 或非本地 Host。 |
| 404 | 页面、角色、任务、文件、候选或接口不存在。 |
| 405 | 已识别的资源不支持该方法；其他未知组合也可能返回 404。 |
| 409 | 缺少/不匹配 `If-Match`、旧版式候选或 ID 已存在。不得自动覆盖。 |
| 422 | 页面结构/语义校验有 error，原页面不写盘。显示问题列表。 |
| 500 | 文件操作或生产计划同步调用失败。后台任务失败仍通过任务对象返回。 |
| 501 | 无法导入 P3，所有出图相关接口返回“出图功能尚未安装”。 |

普通错误：

```json
{
  "error": "文件或资源不存在"
}
```

422 示例（例如把布丁页 p1 的宽度设为负数；实际可同时包含其他问题）：
```json
{
  "error": "页面校验失败",
  "valid": false,
  "exit_code": 1,
  "errors": [
    {
      "severity": "error",
      "code": "invalid_panel_bounds",
      "message": "格 p1 的宽高必须为正数",
      "panel_id": "p1",
      "field": "shape"
    }
  ],
  "warnings": [],
  "issues": [
    {
      "severity": "error",
      "code": "invalid_panel_bounds",
      "message": "格 p1 的宽高必须为正数",
      "panel_id": "p1",
      "field": "shape"
    }
  ]
}
```

### 1.2 ETag 与冲突处理

`GET /api/pages/{id}` 返回 `ETag` 响应头，JSON 中同样返回 `version`。版本格式为带双引号的 `mtime_ns-sha256(文件原始字节)`。即使 CLI 写入内容后保留 mtime，哈希也会阻止旧版本覆盖。

`PUT /api/pages/{id}`、`DELETE /api/pages/{id}`、`POST .../layout-apply`、`POST .../skew` 都必须发送 `If-Match`，原样使用 `version`（包含其内部双引号）。不接受 `*`、弱 ETag 或多个版本。省略同样返回 409。新建、角色/项目修改和生产任务不要求此头。

生产任务运行时，其页面的保存、版式应用、斜切和删除额外返回 409，含 `reason: "production_running"`、当前 current/version，以免 P3 结束时用任务启动时的内容覆盖编辑器的新修改。排队本身不会阻止保存。任务终态后重新读取页面再编辑；浏览、预览与 SSE 仍可使用。CLI 属于外部写入者，不受此保护。

```typescript
const base = 'http://127.0.0.1:8780';
const res = await fetch(`${base}/api/pages/pudding`);
const { page, version } = await res.json();
page.panels[2].description = '姐姐推眼镜，向前一步';
const saved = await fetch(`${base}/api/pages/pudding`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', 'If-Match': version },
  body: JSON.stringify(page),
});
const data = await saved.json();
// saved.status === 409: 保留本地 page，与 data.current 对比/合并。
// saved.ok: data.page 是保存后的完整页面，后续使用 data.version。
```

发生普通版本冲突时响应 `{error, current: Page, version}`，并带当前 ETag；`current` 是完整最新页面，结构见 3.2。候选过时则返回 `{error, page: Page, version}`。新建 ID 冲突仅返回 `{error}`。不要只更新 version 后自动重试旧数据。

## 2. 项目

### GET /api/project

返回项目原始设置、页面摘要和角色摘要；不会扫描或返回项目外文件。

请求：无请求体。

响应：HTTP 200。
```json
{
  "project": {
    "format": "soda-storyboard-project-v1",
    "name": "布丁争夺战",
    "default_style_prefix": "",
    "default_canvas_width": 1024,
    "default_canvas_height": 1536,
    "reading_direction": "rtl",
    "default_dialogue_mode": "moss_text",
    "text_direction": "vertical",
    "color_mode": "color",
    "style_prompt": "High-taste, fully colored 2D anime digital painting comic page, crisp clean line art with soft cel shading and gentle painterly highlights, bright warm kitchen daylight, fresh pastel palette of lemon yellow, soft pink and cool grey, expressive comedic facial expressions, zero rough sketch lines.",
    "tags": [
      "2girls",
      "sisters",
      "home kitchen",
      "open refrigerator",
      "pudding cup",
      "slapstick comedy"
    ]
  },
  "pages": [
    {
      "id": "pudding",
      "description": "A younger sister eats the older sister's pudding, panics and runs away.",
      "panel_count": 5,
      "version": "\"1792553078596086800-5569a2f3cb30516e3cd6e9760422c0b0c256ffaa79ff023ba27b10ba2d8ea50a\""
    }
  ],
  "characters": [
    {
      "id": "older",
      "display_name": "姐姐",
      "has_lora": false
    },
    {
      "id": "younger",
      "display_name": "妹妹",
      "has_lora": false
    }
  ]
}
```

### PATCH /api/project

只覆盖请求给出的顶层字段，其余字段保留；对象字段是整体替换，不递归合并。响应结构与 GET 相同。

请求 JSON：
```json
{
  "name": "布丁争夺战（续）"
}
```

响应：HTTP 200。
```json
{
  "project": {
    "format": "soda-storyboard-project-v1",
    "name": "布丁争夺战（续）",
    "default_style_prefix": "",
    "default_canvas_width": 1024,
    "default_canvas_height": 1536,
    "reading_direction": "rtl",
    "default_dialogue_mode": "moss_text",
    "text_direction": "vertical",
    "color_mode": "color",
    "style_prompt": "High-taste, fully colored 2D anime digital painting comic page, crisp clean line art with soft cel shading and gentle painterly highlights, bright warm kitchen daylight, fresh pastel palette of lemon yellow, soft pink and cool grey, expressive comedic facial expressions, zero rough sketch lines.",
    "tags": [
      "2girls",
      "sisters",
      "home kitchen",
      "open refrigerator",
      "pudding cup",
      "slapstick comedy"
    ]
  },
  "pages": [
    {
      "id": "pudding",
      "description": "A younger sister eats the older sister's pudding, panics and runs away.",
      "panel_count": 5,
      "version": "\"1792553078596086800-5569a2f3cb30516e3cd6e9760422c0b0c256ffaa79ff023ba27b10ba2d8ea50a\""
    }
  ],
  "characters": [
    {
      "id": "older",
      "display_name": "姐姐",
      "has_lora": false
    },
    {
      "id": "younger",
      "display_name": "妹妹",
      "has_lora": false
    }
  ]
}
```

## 3. 页面

### GET /api/pages

页面摘要中 `version` 与逐页 GET 相同。

请求：无请求体。

响应：HTTP 200。
```json
{
  "pages": [
    {
      "id": "pudding",
      "description": "A younger sister eats the older sister's pudding, panics and runs away.",
      "panel_count": 5,
      "version": "\"1792553078596086800-5569a2f3cb30516e3cd6e9760422c0b0c256ffaa79ff023ba27b10ba2d8ea50a\""
    }
  ]
}
```

### GET /api/pages/{id}

示例：`GET /api/pages/pudding`。响应头含 ETag。下面是完整真实页面，后文的 Page 均采用此结构。

请求：无请求体。

响应：HTTP 200。
```json
{
  "page": {
    "format": "soda-storyboard-page-v1",
    "id": "pudding",
    "canvas_width": 1024,
    "canvas_height": 1536,
    "reading_direction": "rtl",
    "style_prefix": "",
    "description": "A younger sister eats the older sister's pudding, panics and runs away.",
    "panel_gap": 20,
    "dialogue_mode": "moss_text",
    "text_direction": "vertical",
    "color_mode": "color",
    "panels": [
      {
        "id": "p1",
        "order": 1,
        "shape": {
          "type": "rect",
          "x": 520.0,
          "y": 24.0,
          "w": 480.0,
          "h": 476.0
        },
        "shot": "full",
        "angle": "eye",
        "character_ids": [
          "younger"
        ],
        "description": "冰箱前偷吃布丁",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Top-right panel: inside a bright home kitchen at night snack time, the younger sister: a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down crouches in front of the open refrigerator, happily eating a caramel pudding cup with a small spoon, the fridge light glowing on her face.",
        "figures": [
          {
            "character_id": "younger",
            "pose": "crouch",
            "position": "center",
            "facing": "front",
            "framing": null
          }
        ]
      },
      {
        "id": "p2",
        "order": 2,
        "shape": {
          "type": "rect",
          "x": 24.0,
          "y": 24.0,
          "w": 476.0,
          "h": 476.0
        },
        "shot": "medium",
        "angle": "eye",
        "character_ids": [
          "older"
        ],
        "description": "姐姐站在门口",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Top-left panel: the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest stands frozen in the kitchen doorway, one hand still on the door frame, her glasses glinting, staring at the empty pudding shelf in disbelief.",
        "figures": [
          {
            "character_id": "older",
            "pose": "stand",
            "position": "center",
            "facing": "front",
            "framing": null
          }
        ]
      },
      {
        "id": "p3",
        "order": 3,
        "shape": {
          "type": "rect",
          "x": 740.0,
          "y": 540.0,
          "w": 260.0,
          "h": 540.0
        },
        "shot": "close_up",
        "angle": "eye",
        "character_ids": [
          "older"
        ],
        "description": "姐姐推眼镜",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Middle-right small vertical panel: low-angle close-up of the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest pushing up her glasses with one finger, a cold, thin smile, a dark aura behind her as she slowly steps forward.",
        "figures": [
          {
            "character_id": "older",
            "pose": "hand_on_chin",
            "position": "center",
            "facing": "front",
            "framing": null
          }
        ]
      },
      {
        "id": "p4",
        "order": 4,
        "shape": {
          "type": "rect",
          "x": 24.0,
          "y": 540.0,
          "w": 256.0,
          "h": 540.0
        },
        "shot": "extreme_close_up",
        "angle": "eye",
        "character_ids": [
          "younger"
        ],
        "description": "妹妹捧着空布丁杯",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Middle-left small vertical panel: extreme close-up of the younger sister, a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down, holding an empty caramel pudding cup with a tiny spoon near her chin.",
        "figures": [
          {
            "character_id": "younger",
            "pose": "hands_clasped",
            "position": "center",
            "facing": "front",
            "framing": null
          }
        ]
      },
      {
        "id": "p5",
        "order": 5,
        "shape": {
          "type": "rect",
          "x": 24.0,
          "y": 1210.0,
          "w": 976.0,
          "h": 302.0
        },
        "shot": "full",
        "angle": "eye",
        "character_ids": [
          "younger",
          "older"
        ],
        "description": "妹妹逃跑，姐姐追赶",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Bottom wide panel: comedic chase, the younger sister: a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down bursts out of the frame to the left with her pink twin tails and hoodie strings flying straight up in fright, speed lines behind her; the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest chases from the right, glasses flashing white.",
        "figures": [
          {
            "character_id": "younger",
            "pose": "run",
            "position": 0.36,
            "facing": "left",
            "framing": null
          },
          {
            "character_id": "older",
            "pose": "run",
            "position": 0.74,
            "facing": "left",
            "framing": null
          }
        ]
      }
    ],
    "texts": [
      {
        "id": "t1",
        "text": "冰箱里的布丁\n是姐姐的宝贝",
        "kind": "narration",
        "panel_id": "p1",
        "speaker_id": null,
        "direction": "vertical",
        "bubble": "box",
        "bbox": {
          "type": "rect",
          "x": 920,
          "y": 44,
          "w": 70,
          "h": 286
        },
        "style_hint": null
      },
      {
        "id": "t2",
        "text": "吧唧",
        "kind": "sfx",
        "panel_id": "p1",
        "speaker_id": null,
        "direction": "horizontal",
        "bubble": "none",
        "bbox": {
          "type": "rect",
          "x": 560,
          "y": 380,
          "w": 100,
          "h": 90
        },
        "style_hint": "near the pudding cup"
      },
      {
        "id": "t3",
        "text": "……你在吃什么？",
        "kind": "dialogue",
        "panel_id": "p2",
        "speaker_id": "older",
        "direction": "vertical",
        "bubble": "speech",
        "bbox": {
          "type": "rect",
          "x": 40,
          "y": 50,
          "w": 70,
          "h": 280
        },
        "style_hint": null
      },
      {
        "id": "t4",
        "text": "是……是冰箱\n自己打开的！",
        "kind": "dialogue",
        "panel_id": null,
        "speaker_id": "younger",
        "direction": "vertical",
        "bubble": "shout",
        "bbox": {
          "type": "rect",
          "x": 250,
          "y": 500,
          "w": 120,
          "h": 280
        },
        "style_hint": null
      },
      {
        "id": "t5",
        "text": "哦？",
        "kind": "dialogue",
        "panel_id": "p3",
        "speaker_id": "older",
        "direction": "vertical",
        "bubble": "speech",
        "bbox": {
          "type": "rect",
          "x": 920,
          "y": 560,
          "w": 70,
          "h": 120
        },
        "style_hint": null
      },
      {
        "id": "t6",
        "text": "咻——！",
        "kind": "sfx",
        "panel_id": "p5",
        "speaker_id": null,
        "direction": "horizontal",
        "bubble": "none",
        "bbox": {
          "type": "rect",
          "x": 60,
          "y": 1230,
          "w": 220,
          "h": 90
        },
        "style_hint": null
      },
      {
        "id": "t7",
        "text": "站住！",
        "kind": "dialogue",
        "panel_id": "p5",
        "speaker_id": "older",
        "direction": "vertical",
        "bubble": "shout",
        "bbox": {
          "type": "rect",
          "x": 900,
          "y": 1225,
          "w": 80,
          "h": 175
        },
        "style_hint": null
      }
    ],
    "style_prompt": "High-taste, fully colored 2D anime digital painting comic page, crisp clean line art with soft cel shading and gentle painterly highlights, bright warm kitchen daylight, fresh pastel palette of lemon yellow, soft pink and cool grey, expressive comedic facial expressions, zero rough sketch lines.",
    "tags": [
      "2girls",
      "sisters",
      "home kitchen",
      "open refrigerator",
      "pudding cup",
      "slapstick comedy"
    ],
    "text_font_size": 42,
    "text_max_chars": 10,
    "overlays": [
      {
        "id": "panic",
        "character_id": "younger",
        "rect": {
          "type": "rect",
          "x": 220,
          "y": 470,
          "w": 580,
          "h": 720
        },
        "panel_id": "p2",
        "z_index": 1,
        "description": "turns around in total panic, caramel pudding at the corner of her lips, eyes wide with sweat drops, both hands raised defensively while hiding the empty pudding cup behind her back.",
        "status": "planned",
        "image_path": null,
        "mode": "moss"
      }
    ]
  },
  "version": "\"1792553078596086800-5569a2f3cb30516e3cd6e9760422c0b0c256ffaa79ff023ba27b10ba2d8ea50a\""
}
```

### PUT /api/pages/{id}

示例：`PUT /api/pages/pudding`，`If-Match` 见 1.2。整页保存，JSON **直接是 Page**，不是 `{page: ...}`。以下是在真实页面上修改第三格描述的完整请求；数组中保留了其他格、文字框和 overlay。保存前验证，只有 warning 时仍然写盘并返回 warning；error 返回 422。

请求 JSON：
```json
{
  "format": "soda-storyboard-page-v1",
  "id": "pudding",
  "canvas_width": 1024,
  "canvas_height": 1536,
  "reading_direction": "rtl",
  "style_prefix": "",
  "description": "A younger sister eats the older sister's pudding, panics and runs away.",
  "panel_gap": 20,
  "dialogue_mode": "moss_text",
  "text_direction": "vertical",
  "color_mode": "color",
  "panels": [
    {
      "id": "p1",
      "order": 1,
      "shape": {
        "type": "rect",
        "x": 520.0,
        "y": 24.0,
        "w": 480.0,
        "h": 476.0
      },
      "shot": "full",
      "angle": "eye",
      "character_ids": [
        "younger"
      ],
      "description": "冰箱前偷吃布丁",
      "dialogue": [],
      "sfx": [],
      "importance": 1,
      "status": "draft",
      "caption_en": "Top-right panel: inside a bright home kitchen at night snack time, the younger sister: a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down crouches in front of the open refrigerator, happily eating a caramel pudding cup with a small spoon, the fridge light glowing on her face.",
      "figures": [
        {
          "character_id": "younger",
          "pose": "crouch",
          "position": "center",
          "facing": "front",
          "framing": null
        }
      ]
    },
    {
      "id": "p2",
      "order": 2,
      "shape": {
        "type": "rect",
        "x": 24.0,
        "y": 24.0,
        "w": 476.0,
        "h": 476.0
      },
      "shot": "medium",
      "angle": "eye",
      "character_ids": [
        "older"
      ],
      "description": "姐姐站在门口",
      "dialogue": [],
      "sfx": [],
      "importance": 1,
      "status": "draft",
      "caption_en": "Top-left panel: the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest stands frozen in the kitchen doorway, one hand still on the door frame, her glasses glinting, staring at the empty pudding shelf in disbelief.",
      "figures": [
        {
          "character_id": "older",
          "pose": "stand",
          "position": "center",
          "facing": "front",
          "framing": null
        }
      ]
    },
    {
      "id": "p3",
      "order": 3,
      "shape": {
        "type": "rect",
        "x": 740.0,
        "y": 540.0,
        "w": 260.0,
        "h": 540.0
      },
      "shot": "close_up",
      "angle": "eye",
      "character_ids": [
        "older"
      ],
      "description": "姐姐推眼镜，向前一步",
      "dialogue": [],
      "sfx": [],
      "importance": 1,
      "status": "draft",
      "caption_en": "Middle-right small vertical panel: low-angle close-up of the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest pushing up her glasses with one finger, a cold, thin smile, a dark aura behind her as she slowly steps forward.",
      "figures": [
        {
          "character_id": "older",
          "pose": "hand_on_chin",
          "position": "center",
          "facing": "front",
          "framing": null
        }
      ]
    },
    {
      "id": "p4",
      "order": 4,
      "shape": {
        "type": "rect",
        "x": 24.0,
        "y": 540.0,
        "w": 256.0,
        "h": 540.0
      },
      "shot": "extreme_close_up",
      "angle": "eye",
      "character_ids": [
        "younger"
      ],
      "description": "妹妹捧着空布丁杯",
      "dialogue": [],
      "sfx": [],
      "importance": 1,
      "status": "draft",
      "caption_en": "Middle-left small vertical panel: extreme close-up of the younger sister, a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down, holding an empty caramel pudding cup with a tiny spoon near her chin.",
      "figures": [
        {
          "character_id": "younger",
          "pose": "hands_clasped",
          "position": "center",
          "facing": "front",
          "framing": null
        }
      ]
    },
    {
      "id": "p5",
      "order": 5,
      "shape": {
        "type": "rect",
        "x": 24.0,
        "y": 1210.0,
        "w": 976.0,
        "h": 302.0
      },
      "shot": "full",
      "angle": "eye",
      "character_ids": [
        "younger",
        "older"
      ],
      "description": "妹妹逃跑，姐姐追赶",
      "dialogue": [],
      "sfx": [],
      "importance": 1,
      "status": "draft",
      "caption_en": "Bottom wide panel: comedic chase, the younger sister: a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down bursts out of the frame to the left with her pink twin tails and hoodie strings flying straight up in fright, speed lines behind her; the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest chases from the right, glasses flashing white.",
      "figures": [
        {
          "character_id": "younger",
          "pose": "run",
          "position": 0.36,
          "facing": "left",
          "framing": null
        },
        {
          "character_id": "older",
          "pose": "run",
          "position": 0.74,
          "facing": "left",
          "framing": null
        }
      ]
    }
  ],
  "texts": [
    {
      "id": "t1",
      "text": "冰箱里的布丁\n是姐姐的宝贝",
      "kind": "narration",
      "panel_id": "p1",
      "speaker_id": null,
      "direction": "vertical",
      "bubble": "box",
      "bbox": {
        "type": "rect",
        "x": 920,
        "y": 44,
        "w": 70,
        "h": 286
      },
      "style_hint": null
    },
    {
      "id": "t2",
      "text": "吧唧",
      "kind": "sfx",
      "panel_id": "p1",
      "speaker_id": null,
      "direction": "horizontal",
      "bubble": "none",
      "bbox": {
        "type": "rect",
        "x": 560,
        "y": 380,
        "w": 100,
        "h": 90
      },
      "style_hint": "near the pudding cup"
    },
    {
      "id": "t3",
      "text": "……你在吃什么？",
      "kind": "dialogue",
      "panel_id": "p2",
      "speaker_id": "older",
      "direction": "vertical",
      "bubble": "speech",
      "bbox": {
        "type": "rect",
        "x": 40,
        "y": 50,
        "w": 70,
        "h": 280
      },
      "style_hint": null
    },
    {
      "id": "t4",
      "text": "是……是冰箱\n自己打开的！",
      "kind": "dialogue",
      "panel_id": null,
      "speaker_id": "younger",
      "direction": "vertical",
      "bubble": "shout",
      "bbox": {
        "type": "rect",
        "x": 250,
        "y": 500,
        "w": 120,
        "h": 280
      },
      "style_hint": null
    },
    {
      "id": "t5",
      "text": "哦？",
      "kind": "dialogue",
      "panel_id": "p3",
      "speaker_id": "older",
      "direction": "vertical",
      "bubble": "speech",
      "bbox": {
        "type": "rect",
        "x": 920,
        "y": 560,
        "w": 70,
        "h": 120
      },
      "style_hint": null
    },
    {
      "id": "t6",
      "text": "咻——！",
      "kind": "sfx",
      "panel_id": "p5",
      "speaker_id": null,
      "direction": "horizontal",
      "bubble": "none",
      "bbox": {
        "type": "rect",
        "x": 60,
        "y": 1230,
        "w": 220,
        "h": 90
      },
      "style_hint": null
    },
    {
      "id": "t7",
      "text": "站住！",
      "kind": "dialogue",
      "panel_id": "p5",
      "speaker_id": "older",
      "direction": "vertical",
      "bubble": "shout",
      "bbox": {
        "type": "rect",
        "x": 900,
        "y": 1225,
        "w": 80,
        "h": 175
      },
      "style_hint": null
    }
  ],
  "style_prompt": "High-taste, fully colored 2D anime digital painting comic page, crisp clean line art with soft cel shading and gentle painterly highlights, bright warm kitchen daylight, fresh pastel palette of lemon yellow, soft pink and cool grey, expressive comedic facial expressions, zero rough sketch lines.",
  "tags": [
    "2girls",
    "sisters",
    "home kitchen",
    "open refrigerator",
    "pudding cup",
    "slapstick comedy"
  ],
  "text_font_size": 42,
  "text_max_chars": 10,
  "overlays": [
    {
      "id": "panic",
      "character_id": "younger",
      "rect": {
        "type": "rect",
        "x": 220,
        "y": 470,
        "w": 580,
        "h": 720
      },
      "panel_id": "p2",
      "z_index": 1,
      "description": "turns around in total panic, caramel pudding at the corner of her lips, eyes wide with sweat drops, both hands raised defensively while hiding the empty pudding cup behind her back.",
      "status": "planned",
      "image_path": null,
      "mode": "moss"
    }
  ]
}
```

响应：HTTP 200，完整 `{page: Page, version: string, warnings: Issue[]}`，示例：
```json
{
  "page": {
    "format": "soda-storyboard-page-v1",
    "id": "pudding",
    "canvas_width": 1024,
    "canvas_height": 1536,
    "reading_direction": "rtl",
    "style_prefix": "",
    "description": "A younger sister eats the older sister's pudding, panics and runs away.",
    "panel_gap": 20,
    "dialogue_mode": "moss_text",
    "text_direction": "vertical",
    "color_mode": "color",
    "panels": [
      {
        "id": "p1",
        "order": 1,
        "shape": {
          "type": "rect",
          "x": 520.0,
          "y": 24.0,
          "w": 480.0,
          "h": 476.0
        },
        "shot": "full",
        "angle": "eye",
        "character_ids": [
          "younger"
        ],
        "description": "冰箱前偷吃布丁",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Top-right panel: inside a bright home kitchen at night snack time, the younger sister: a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down crouches in front of the open refrigerator, happily eating a caramel pudding cup with a small spoon, the fridge light glowing on her face.",
        "figures": [
          {
            "character_id": "younger",
            "pose": "crouch",
            "position": "center",
            "facing": "front",
            "framing": null
          }
        ]
      },
      {
        "id": "p2",
        "order": 2,
        "shape": {
          "type": "rect",
          "x": 24.0,
          "y": 24.0,
          "w": 476.0,
          "h": 476.0
        },
        "shot": "medium",
        "angle": "eye",
        "character_ids": [
          "older"
        ],
        "description": "姐姐站在门口",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Top-left panel: the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest stands frozen in the kitchen doorway, one hand still on the door frame, her glasses glinting, staring at the empty pudding shelf in disbelief.",
        "figures": [
          {
            "character_id": "older",
            "pose": "stand",
            "position": "center",
            "facing": "front",
            "framing": null
          }
        ]
      },
      {
        "id": "p3",
        "order": 3,
        "shape": {
          "type": "rect",
          "x": 740.0,
          "y": 540.0,
          "w": 260.0,
          "h": 540.0
        },
        "shot": "close_up",
        "angle": "eye",
        "character_ids": [
          "older"
        ],
        "description": "姐姐推眼镜，向前一步",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Middle-right small vertical panel: low-angle close-up of the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest pushing up her glasses with one finger, a cold, thin smile, a dark aura behind her as she slowly steps forward.",
        "figures": [
          {
            "character_id": "older",
            "pose": "hand_on_chin",
            "position": "center",
            "facing": "front",
            "framing": null
          }
        ]
      },
      {
        "id": "p4",
        "order": 4,
        "shape": {
          "type": "rect",
          "x": 24.0,
          "y": 540.0,
          "w": 256.0,
          "h": 540.0
        },
        "shot": "extreme_close_up",
        "angle": "eye",
        "character_ids": [
          "younger"
        ],
        "description": "妹妹捧着空布丁杯",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Middle-left small vertical panel: extreme close-up of the younger sister, a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down, holding an empty caramel pudding cup with a tiny spoon near her chin.",
        "figures": [
          {
            "character_id": "younger",
            "pose": "hands_clasped",
            "position": "center",
            "facing": "front",
            "framing": null
          }
        ]
      },
      {
        "id": "p5",
        "order": 5,
        "shape": {
          "type": "rect",
          "x": 24.0,
          "y": 1210.0,
          "w": 976.0,
          "h": 302.0
        },
        "shot": "full",
        "angle": "eye",
        "character_ids": [
          "younger",
          "older"
        ],
        "description": "妹妹逃跑，姐姐追赶",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Bottom wide panel: comedic chase, the younger sister: a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down bursts out of the frame to the left with her pink twin tails and hoodie strings flying straight up in fright, speed lines behind her; the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest chases from the right, glasses flashing white.",
        "figures": [
          {
            "character_id": "younger",
            "pose": "run",
            "position": 0.36,
            "facing": "left",
            "framing": null
          },
          {
            "character_id": "older",
            "pose": "run",
            "position": 0.74,
            "facing": "left",
            "framing": null
          }
        ]
      }
    ],
    "texts": [
      {
        "id": "t1",
        "text": "冰箱里的布丁\n是姐姐的宝贝",
        "kind": "narration",
        "panel_id": "p1",
        "speaker_id": null,
        "direction": "vertical",
        "bubble": "box",
        "bbox": {
          "type": "rect",
          "x": 920.0,
          "y": 44.0,
          "w": 70.0,
          "h": 286.0
        },
        "style_hint": null
      },
      {
        "id": "t2",
        "text": "吧唧",
        "kind": "sfx",
        "panel_id": "p1",
        "speaker_id": null,
        "direction": "horizontal",
        "bubble": "none",
        "bbox": {
          "type": "rect",
          "x": 560.0,
          "y": 380.0,
          "w": 100.0,
          "h": 90.0
        },
        "style_hint": "near the pudding cup"
      },
      {
        "id": "t3",
        "text": "……你在吃什么？",
        "kind": "dialogue",
        "panel_id": "p2",
        "speaker_id": "older",
        "direction": "vertical",
        "bubble": "speech",
        "bbox": {
          "type": "rect",
          "x": 40.0,
          "y": 50.0,
          "w": 70.0,
          "h": 280.0
        },
        "style_hint": null
      },
      {
        "id": "t4",
        "text": "是……是冰箱\n自己打开的！",
        "kind": "dialogue",
        "panel_id": null,
        "speaker_id": "younger",
        "direction": "vertical",
        "bubble": "shout",
        "bbox": {
          "type": "rect",
          "x": 250.0,
          "y": 500.0,
          "w": 120.0,
          "h": 280.0
        },
        "style_hint": null
      },
      {
        "id": "t5",
        "text": "哦？",
        "kind": "dialogue",
        "panel_id": "p3",
        "speaker_id": "older",
        "direction": "vertical",
        "bubble": "speech",
        "bbox": {
          "type": "rect",
          "x": 920.0,
          "y": 560.0,
          "w": 70.0,
          "h": 120.0
        },
        "style_hint": null
      },
      {
        "id": "t6",
        "text": "咻——！",
        "kind": "sfx",
        "panel_id": "p5",
        "speaker_id": null,
        "direction": "horizontal",
        "bubble": "none",
        "bbox": {
          "type": "rect",
          "x": 60.0,
          "y": 1230.0,
          "w": 220.0,
          "h": 90.0
        },
        "style_hint": null
      },
      {
        "id": "t7",
        "text": "站住！",
        "kind": "dialogue",
        "panel_id": "p5",
        "speaker_id": "older",
        "direction": "vertical",
        "bubble": "shout",
        "bbox": {
          "type": "rect",
          "x": 900.0,
          "y": 1225.0,
          "w": 80.0,
          "h": 175.0
        },
        "style_hint": null
      }
    ],
    "style_prompt": "High-taste, fully colored 2D anime digital painting comic page, crisp clean line art with soft cel shading and gentle painterly highlights, bright warm kitchen daylight, fresh pastel palette of lemon yellow, soft pink and cool grey, expressive comedic facial expressions, zero rough sketch lines.",
    "tags": [
      "2girls",
      "sisters",
      "home kitchen",
      "open refrigerator",
      "pudding cup",
      "slapstick comedy"
    ],
    "text_font_size": 42.0,
    "text_max_chars": 10,
    "overlays": [
      {
        "id": "panic",
        "character_id": "younger",
        "rect": {
          "type": "rect",
          "x": 220.0,
          "y": 470.0,
          "w": 580.0,
          "h": 720.0
        },
        "panel_id": "p2",
        "z_index": 1,
        "description": "turns around in total panic, caramel pudding at the corner of her lips, eyes wide with sweat drops, both hands raised defensively while hiding the empty pudding cup behind her back.",
        "status": "planned",
        "image_path": null,
        "mode": "moss"
      }
    ]
  },
  "version": "\"1792559947154341800-a39de6013ea95eeb900d6c0822ff1c83832825e2d7bd982746c3f76f00229069\"",
  "warnings": []
}
```

### POST /api/pages

示例中新建空页，省略的画布/阅读方向/样式等继承 project.json；也可提交含 panels/texts/overlays 的完整页面。ID 已存在返回 409。

请求 JSON：
```json
{
  "id": "pudding-next",
  "description": "布丁争夺战下一页"
}
```

响应：HTTP 201。
```json
{
  "page": {
    "format": "soda-storyboard-page-v1",
    "id": "pudding-next",
    "canvas_width": 1024,
    "canvas_height": 1536,
    "reading_direction": "rtl",
    "style_prefix": "",
    "description": "布丁争夺战下一页",
    "panel_gap": 24,
    "dialogue_mode": "moss_text",
    "text_direction": "vertical",
    "color_mode": "color",
    "panels": [],
    "texts": [],
    "style_prompt": "High-taste, fully colored 2D anime digital painting comic page, crisp clean line art with soft cel shading and gentle painterly highlights, bright warm kitchen daylight, fresh pastel palette of lemon yellow, soft pink and cool grey, expressive comedic facial expressions, zero rough sketch lines.",
    "tags": [
      "2girls",
      "sisters",
      "home kitchen",
      "open refrigerator",
      "pudding cup",
      "slapstick comedy"
    ],
    "text_font_size": 42.0,
    "text_max_chars": 10
  },
  "version": "\"1792559947156841900-523e021b2248ba57bd6b7ca4843a32f980090714c6887708ef3c65f996527ee9\"",
  "warnings": []
}
```

### DELETE /api/pages/{id}

示例：`DELETE /api/pages/pudding-next`，带该页 `If-Match`，无请求体。只将 pages/pudding-next.json 移入 .trash，不删除关联出图目录。可手动移回恢复；.trash 不能通过文件接口读取。

请求：无请求体。

响应：HTTP 200。
```json
{
  "id": "pudding-next",
  "trash_path": ".trash/pudding-next-35d135acbd0e49f4adc7a042641e1631.json"
}
```

## 4. 角色

### GET /api/characters

返回完整角色数组；与 /api/project 的角色摘要不同。

请求：无请求体。

响应：HTTP 200。
```json
{
  "characters": [
    {
      "format": "soda-storyboard-character-v1",
      "id": "older",
      "display_name": "姐姐",
      "trigger_words": [],
      "clothing": [],
      "reference_images": [],
      "approved_images": [],
      "appearance": {
        "en": "a tall young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest"
      },
      "age": "20-year-old",
      "figure_hint": "skirt"
    },
    {
      "format": "soda-storyboard-character-v1",
      "id": "younger",
      "display_name": "妹妹",
      "trigger_words": [],
      "clothing": [],
      "reference_images": [],
      "approved_images": [],
      "appearance": {
        "en": "a petite girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down"
      },
      "age": "14-year-old"
    }
  ]
}
```

### GET /api/characters/{id}

示例：`GET /api/characters/older`。

请求：无请求体。

响应：HTTP 200。
```json
{
  "character": {
    "format": "soda-storyboard-character-v1",
    "id": "older",
    "display_name": "姐姐",
    "trigger_words": [],
    "clothing": [],
    "reference_images": [],
    "approved_images": [],
    "appearance": {
      "en": "a tall young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest"
    },
    "age": "20-year-old",
    "figure_hint": "skirt"
  }
}
```

### PUT /api/characters/{id}

示例：`PUT /api/characters/older`。整张角色卡替换，URL 与 JSON 的 id 必须一致，保留前端未编辑字段。角色无 If-Match 保护，最后一次成功写入生效。

请求 JSON：
```json
{
  "format": "soda-storyboard-character-v1",
  "id": "older",
  "display_name": "姐姐",
  "trigger_words": [],
  "clothing": [],
  "reference_images": [],
  "approved_images": [],
  "appearance": {
    "en": "a tall young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest"
  },
  "age": "20-year-old",
  "figure_hint": "skirt"
}
```

响应：HTTP 200。
```json
{
  "character": {
    "format": "soda-storyboard-character-v1",
    "id": "older",
    "display_name": "姐姐",
    "trigger_words": [],
    "clothing": [],
    "reference_images": [],
    "approved_images": [],
    "appearance": {
      "en": "a tall young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest"
    },
    "age": "20-year-old",
    "figure_hint": "skirt"
  }
}
```

### POST /api/characters

以真实姐姐角色卡复制出新角色。只需 id 即可创建，其余默认值由核心模型补齐；角色卡的 LoRA/参考图路径是元数据，不会触发联网读取。

请求 JSON：
```json
{
  "format": "soda-storyboard-character-v1",
  "id": "older-copy",
  "display_name": "姐姐（副本）",
  "trigger_words": [],
  "clothing": [],
  "reference_images": [],
  "approved_images": [],
  "appearance": {
    "en": "a tall young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest"
  },
  "age": "20-year-old",
  "figure_hint": "skirt"
}
```

响应：HTTP 201。
```json
{
  "character": {
    "format": "soda-storyboard-character-v1",
    "id": "older-copy",
    "display_name": "姐姐（副本）",
    "trigger_words": [],
    "clothing": [],
    "reference_images": [],
    "approved_images": [],
    "appearance": {
      "en": "a tall young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest"
    },
    "age": "20-year-old",
    "figure_hint": "skirt"
  }
}
```

## 5. 检查与输出

### POST /api/pages/{id}/validate

示例：`POST /api/pages/pudding/validate`。检查磁盘上的当前页面，不保存请求内的页面；无效时 HTTP 仍为 200，用 valid 判断。编辑中的页面保存时由 PUT 自动校验。

请求 JSON：
```json
{
  "max_dialogue_chars": 20
}
```

响应：HTTP 200。
```json
{
  "valid": true,
  "exit_code": 0,
  "errors": [],
  "warnings": [],
  "issues": []
}
```

### GET /api/pages/{id}/preview.png?style=sketch&scale=1

示例：`GET /api/pages/pudding/preview.png?style=sketch&scale=0.25`。style 为 sketch（默认，火柴人草稿）或 boxes；0 < scale <= 2，输出最多 1600 万像素。响应 HTTP 200、Content-Type: image/png，示例为 256×384 PNG 二进制，没有 JSON 包装。直接用于 img.src，追加 v=version 可刷新浏览器缓存。

请求：无请求体。

### POST /api/pages/{id}/compile

示例：`POST /api/pages/pudding/compile`。返回 MOSS JSON 并写到项目根目录 pudding.moss.json。slant_mode 是 cut（默认）/ hint / rect；with_ids 默认 false。斜切 cut 模式另写 .moss.cut.json，with_ids 时写 .moss.map.json。path / paths 都是可交给文件接口的相对路径；不会接受任意输出路径。

请求 JSON：
```json
{
  "with_ids": true,
  "slant_mode": "cut"
}
```

响应：HTTP 200。
```json
{
  "moss": {
    "summary": {
      "meta": [
        "comic",
        "multi_panel",
        "digital_painting"
      ],
      "canvas": "multi_panel",
      "caption": "High-taste, fully colored 2D anime digital painting comic page, crisp clean line art with soft cel shading and gentle painterly highlights, bright warm kitchen daylight, fresh pastel palette of lemon yellow, soft pink and cool grey, expressive comedic facial expressions, zero rough sketch lines.; A younger sister eats the older sister's pudding, panics and runs away.; 2girls, sisters, home kitchen, open refrigerator, pudding cup, slapstick comedy; Japanese manga layout read right to left, clean white gutters; crisp Chinese comic text in clean speech bubbles and narration boxes"
    },
    "items": [
      {
        "label": "object",
        "caption": "Top-right panel: inside a bright home kitchen at night snack time, the younger sister: a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down crouches in front of the open refrigerator, happily eating a caramel pudding cup with a small spoon, the fridge light glowing on her face.",
        "bbox": [
          -744,
          8,
          -268,
          488
        ],
        "panel_id": "p1"
      },
      {
        "label": "object",
        "caption": "Top-left panel: the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest stands frozen in the kitchen doorway, one hand still on the door frame, her glasses glinting, staring at the empty pudding shelf in disbelief.",
        "bbox": [
          -744,
          -488,
          -268,
          -12
        ],
        "panel_id": "p2"
      },
      {
        "label": "character",
        "caption": "Main center character focus breaking across the middle panels: 14-year-old, a petite girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down, turns around in total panic, caramel pudding at the corner of her lips, eyes wide with sweat drops, both hands raised defensively while hiding the empty pudding cup behind her back.",
        "bbox": [
          -298,
          -292,
          422,
          288
        ],
        "overlay_id": "panic",
        "character_id": "younger"
      },
      {
        "label": "object",
        "caption": "Middle-right small vertical panel: low-angle close-up of the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest pushing up her glasses with one finger, a cold, thin smile, a dark aura behind her as she slowly steps forward.",
        "bbox": [
          -228,
          228,
          312,
          488
        ],
        "panel_id": "p3"
      },
      {
        "label": "object",
        "caption": "Middle-left small vertical panel: extreme close-up of the younger sister, a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down, holding an empty caramel pudding cup with a tiny spoon near her chin.",
        "bbox": [
          -228,
          -488,
          312,
          -232
        ],
        "panel_id": "p4"
      },
      {
        "label": "object",
        "caption": "Bottom wide panel: comedic chase, the younger sister: a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down bursts out of the frame to the left with her pink twin tails and hoodie strings flying straight up in fright, speed lines behind her; the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest chases from the right, glasses flashing white.",
        "bbox": [
          442,
          -488,
          744,
          488
        ],
        "panel_id": "p5"
      },
      {
        "label": "text",
        "caption": "Clean vertical Chinese narration text in a rectangular narration box in the top-right panel.",
        "text": "冰箱里的布丁\n是姐姐的宝贝",
        "bbox": [
          -724,
          408,
          -438,
          478
        ],
        "text_id": "t1",
        "panel_id": "p1",
        "speaker_id": null
      },
      {
        "label": "text",
        "caption": "Bold comic sound effect text with horizontal lettering in the top-right panel, near the pudding cup.",
        "text": "吧唧",
        "bbox": [
          -388,
          48,
          -298,
          148
        ],
        "text_id": "t2",
        "panel_id": "p1",
        "speaker_id": null
      },
      {
        "label": "text",
        "caption": "Clean vertical Chinese dialogue text in a white speech bubble in the top-left panel next to 20-year-old, a tall young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest.",
        "text": "……你在吃什么？",
        "bbox": [
          -718,
          -472,
          -438,
          -402
        ],
        "text_id": "t3",
        "panel_id": "p2",
        "speaker_id": "older"
      },
      {
        "label": "text",
        "caption": "Clean vertical Chinese dialogue text in a jagged shout bubble next to 14-year-old, a petite girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down.",
        "text": "是……是冰箱\n自己打开的！",
        "bbox": [
          -268,
          -262,
          12,
          -142
        ],
        "text_id": "t4",
        "panel_id": null,
        "speaker_id": "younger"
      },
      {
        "label": "text",
        "caption": "Clean vertical Chinese dialogue text in a white speech bubble in the middle-right small vertical panel next to 20-year-old, a tall young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest.",
        "text": "哦？",
        "bbox": [
          -208,
          408,
          -88,
          478
        ],
        "text_id": "t5",
        "panel_id": "p3",
        "speaker_id": "older"
      },
      {
        "label": "text",
        "caption": "Bold comic sound effect text with horizontal lettering in the bottom wide panel.",
        "text": "咻——！",
        "bbox": [
          462,
          -452,
          552,
          -232
        ],
        "text_id": "t6",
        "panel_id": "p5",
        "speaker_id": null
      },
      {
        "label": "text",
        "caption": "Clean vertical Chinese dialogue text in a jagged shout bubble in the bottom wide panel next to 20-year-old, a tall young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest.",
        "text": "站住！",
        "bbox": [
          457,
          388,
          632,
          468
        ],
        "text_id": "t7",
        "panel_id": "p5",
        "speaker_id": "older"
      }
    ],
    "bbox_coord_space": "abs_centralized",
    "bbox_format": "yxyx"
  },
  "path": "pudding.moss.json",
  "paths": {
    "moss": "pudding.moss.json",
    "map": "pudding.moss.map.json"
  }
}
```

## 6. 版式与斜切

### GET /api/templates?panels=5

panels 可省略；给出时须是 1～100 的整数。返回模板元数据，示例仅列第一项。这里 panels 几何是归一化坐标（0～1）；实际画布上的像素位置从 layout-suggest 取得，前端不要直接把模板几何写入页面。

请求：无请求体。

响应：HTTP 200。
```json
{
  "templates": [
    {
      "id": "balanced-grid",
      "ja": "均整グリッド",
      "en": "Balanced grid",
      "family": "standard",
      "minPanels": 1,
      "maxPanels": 6,
      "tags": [
        "standard",
        "conversation"
      ],
      "helpJa": "最も素直な段組み。会話・日常・説明の基準点。",
      "helpEn": "A neutral baseline for dialogue, daily scenes, and exposition.",
      "zh": "均衡网格",
      "helpZh": "适合对话、日常与说明的均衡分段。",
      "supported_panel_counts": [
        1,
        2,
        3,
        4,
        5,
        6,
        7
      ],
      "name": "均衡网格",
      "panel_count": 5,
      "panels": [
        {
          "type": "rect",
          "x": 0.51171875,
          "y": 0.029947916666666668,
          "w": 0.443359375,
          "h": 0.3029513888888889,
          "order": 1
        },
        {
          "type": "rect",
          "x": 0.044921875,
          "y": 0.029947916666666668,
          "w": 0.443359375,
          "h": 0.3029513888888889,
          "order": 2
        },
        {
          "type": "rect",
          "x": 0.51171875,
          "y": 0.3485243055555555,
          "w": 0.443359375,
          "h": 0.3029513888888889,
          "order": 3
        },
        {
          "type": "rect",
          "x": 0.044921875,
          "y": 0.3485243055555555,
          "w": 0.443359375,
          "h": 0.3029513888888889,
          "order": 4
        },
        {
          "type": "rect",
          "x": 0.044921875,
          "y": 0.6671006944444443,
          "w": 0.91015625,
          "h": 0.3029513888888889,
          "order": 5
        }
      ]
    }
  ]
}
```

### POST /api/pages/{id}/layout-suggest

示例：`POST /api/pages/pudding/layout-suggest`。只生成候选和 PNG，不修改页面。panels 可省略，否则必须等于当前页格数；importance 可为整数数组或 CLI 的逗号分隔字符串；candidates 默认 6，范围 1～32；gap、direction 默认当前页面；pick 是 template_id；skew 省略时混合，0 只返回矩形，角度须在 (-45,45)。templates 是项目内用户模板目录，不能越界。画布尺寸取当前页（与 CLI 的 --page 行为一致），不接收 output/write_page/preview_dir 等文件写入选项。

请求 JSON：
```json
{
  "candidates": 1,
  "skew": 0
}
```

响应：HTTP 200。
```json
{
  "version": "\"1792559947154341800-a39de6013ea95eeb900d6c0822ff1c83832825e2d7bd982746c3f76f00229069\"",
  "candidates": [
    {
      "id": "balanced-grid",
      "ja": "均整グリッド",
      "en": "Balanced grid",
      "family": "standard",
      "minPanels": 1,
      "maxPanels": 6,
      "tags": [
        "standard",
        "conversation"
      ],
      "helpJa": "最も素直な段組み。会話・日常・説明の基準点。",
      "helpEn": "A neutral baseline for dialogue, daily scenes, and exposition.",
      "zh": "均衡网格",
      "helpZh": "适合对话、日常与说明的均衡分段。",
      "supported_panel_counts": [
        1,
        2,
        3,
        4,
        5,
        6,
        7
      ],
      "template_id": "balanced-grid",
      "name": "均衡网格",
      "name_zh": "均衡网格",
      "name_ja": "均整グリッド",
      "description": "适合对话、日常与说明的均衡分段。",
      "hero_position": null,
      "panel_count": 5,
      "panels": [
        {
          "type": "rect",
          "x": 522.0,
          "y": 46.0,
          "w": 456.0,
          "h": 468.0,
          "order": 1
        },
        {
          "type": "rect",
          "x": 46.0,
          "y": 46.0,
          "w": 456.0,
          "h": 468.0,
          "order": 2
        },
        {
          "type": "rect",
          "x": 522.0,
          "y": 534.0,
          "w": 456.0,
          "h": 468.0,
          "order": 3
        },
        {
          "type": "rect",
          "x": 46.0,
          "y": 534.0,
          "w": 456.0,
          "h": 468.0,
          "order": 4
        },
        {
          "type": "rect",
          "x": 46.0,
          "y": 1022.0,
          "w": 932.0,
          "h": 468.0,
          "order": 5
        }
      ],
      "score": 1289808.0,
      "candidate_id": "e44353081d8f40a2949f55a6ebe99693-0",
      "preview_url": "/api/files/.server/layouts/e44353081d8f40a2949f55a6ebe99693-0.png"
    }
  ]
}
```

### POST /api/pages/{id}/layout-apply

示例：`POST /api/pages/pudding/layout-apply`，If-Match 必须与生成候选时的 version 相同。保留格子业务字段、figures、texts 和 overlays，只改版式几何及请求的 gap/direction；文字 bbox 不自动跟随格子移动。返回完整已保存页面及 warnings。候选只在当前进程内有效，最多保留最近 256 个，过期返回 404。

请求 JSON：
```json
{
  "candidate_id": "e44353081d8f40a2949f55a6ebe99693-0"
}
```

响应：HTTP 200。
```json
{
  "page": {
    "format": "soda-storyboard-page-v1",
    "id": "pudding",
    "canvas_width": 1024,
    "canvas_height": 1536,
    "reading_direction": "rtl",
    "style_prefix": "",
    "description": "A younger sister eats the older sister's pudding, panics and runs away.",
    "panel_gap": 20,
    "dialogue_mode": "moss_text",
    "text_direction": "vertical",
    "color_mode": "color",
    "panels": [
      {
        "id": "p1",
        "order": 1,
        "shape": {
          "type": "rect",
          "x": 522.0,
          "y": 46.0,
          "w": 456.0,
          "h": 468.0
        },
        "shot": "full",
        "angle": "eye",
        "character_ids": [
          "younger"
        ],
        "description": "冰箱前偷吃布丁",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Top-right panel: inside a bright home kitchen at night snack time, the younger sister: a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down crouches in front of the open refrigerator, happily eating a caramel pudding cup with a small spoon, the fridge light glowing on her face.",
        "figures": [
          {
            "character_id": "younger",
            "pose": "crouch",
            "position": "center",
            "facing": "front",
            "framing": null
          }
        ]
      },
      {
        "id": "p2",
        "order": 2,
        "shape": {
          "type": "rect",
          "x": 46.0,
          "y": 46.0,
          "w": 456.0,
          "h": 468.0
        },
        "shot": "medium",
        "angle": "eye",
        "character_ids": [
          "older"
        ],
        "description": "姐姐站在门口",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Top-left panel: the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest stands frozen in the kitchen doorway, one hand still on the door frame, her glasses glinting, staring at the empty pudding shelf in disbelief.",
        "figures": [
          {
            "character_id": "older",
            "pose": "stand",
            "position": "center",
            "facing": "front",
            "framing": null
          }
        ]
      },
      {
        "id": "p3",
        "order": 3,
        "shape": {
          "type": "rect",
          "x": 522.0,
          "y": 534.0,
          "w": 456.0,
          "h": 468.0
        },
        "shot": "close_up",
        "angle": "eye",
        "character_ids": [
          "older"
        ],
        "description": "姐姐推眼镜，向前一步",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Middle-right small vertical panel: low-angle close-up of the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest pushing up her glasses with one finger, a cold, thin smile, a dark aura behind her as she slowly steps forward.",
        "figures": [
          {
            "character_id": "older",
            "pose": "hand_on_chin",
            "position": "center",
            "facing": "front",
            "framing": null
          }
        ]
      },
      {
        "id": "p4",
        "order": 4,
        "shape": {
          "type": "rect",
          "x": 46.0,
          "y": 534.0,
          "w": 456.0,
          "h": 468.0
        },
        "shot": "extreme_close_up",
        "angle": "eye",
        "character_ids": [
          "younger"
        ],
        "description": "妹妹捧着空布丁杯",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Middle-left small vertical panel: extreme close-up of the younger sister, a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down, holding an empty caramel pudding cup with a tiny spoon near her chin.",
        "figures": [
          {
            "character_id": "younger",
            "pose": "hands_clasped",
            "position": "center",
            "facing": "front",
            "framing": null
          }
        ]
      },
      {
        "id": "p5",
        "order": 5,
        "shape": {
          "type": "rect",
          "x": 46.0,
          "y": 1022.0,
          "w": 932.0,
          "h": 468.0
        },
        "shot": "full",
        "angle": "eye",
        "character_ids": [
          "younger",
          "older"
        ],
        "description": "妹妹逃跑，姐姐追赶",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Bottom wide panel: comedic chase, the younger sister: a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down bursts out of the frame to the left with her pink twin tails and hoodie strings flying straight up in fright, speed lines behind her; the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest chases from the right, glasses flashing white.",
        "figures": [
          {
            "character_id": "younger",
            "pose": "run",
            "position": 0.36,
            "facing": "left",
            "framing": null
          },
          {
            "character_id": "older",
            "pose": "run",
            "position": 0.74,
            "facing": "left",
            "framing": null
          }
        ]
      }
    ],
    "texts": [
      {
        "id": "t1",
        "text": "冰箱里的布丁\n是姐姐的宝贝",
        "kind": "narration",
        "panel_id": "p1",
        "speaker_id": null,
        "direction": "vertical",
        "bubble": "box",
        "bbox": {
          "type": "rect",
          "x": 920.0,
          "y": 44.0,
          "w": 70.0,
          "h": 286.0
        },
        "style_hint": null
      },
      {
        "id": "t2",
        "text": "吧唧",
        "kind": "sfx",
        "panel_id": "p1",
        "speaker_id": null,
        "direction": "horizontal",
        "bubble": "none",
        "bbox": {
          "type": "rect",
          "x": 560.0,
          "y": 380.0,
          "w": 100.0,
          "h": 90.0
        },
        "style_hint": "near the pudding cup"
      },
      {
        "id": "t3",
        "text": "……你在吃什么？",
        "kind": "dialogue",
        "panel_id": "p2",
        "speaker_id": "older",
        "direction": "vertical",
        "bubble": "speech",
        "bbox": {
          "type": "rect",
          "x": 40.0,
          "y": 50.0,
          "w": 70.0,
          "h": 280.0
        },
        "style_hint": null
      },
      {
        "id": "t4",
        "text": "是……是冰箱\n自己打开的！",
        "kind": "dialogue",
        "panel_id": null,
        "speaker_id": "younger",
        "direction": "vertical",
        "bubble": "shout",
        "bbox": {
          "type": "rect",
          "x": 250.0,
          "y": 500.0,
          "w": 120.0,
          "h": 280.0
        },
        "style_hint": null
      },
      {
        "id": "t5",
        "text": "哦？",
        "kind": "dialogue",
        "panel_id": "p3",
        "speaker_id": "older",
        "direction": "vertical",
        "bubble": "speech",
        "bbox": {
          "type": "rect",
          "x": 920.0,
          "y": 560.0,
          "w": 70.0,
          "h": 120.0
        },
        "style_hint": null
      },
      {
        "id": "t6",
        "text": "咻——！",
        "kind": "sfx",
        "panel_id": "p5",
        "speaker_id": null,
        "direction": "horizontal",
        "bubble": "none",
        "bbox": {
          "type": "rect",
          "x": 60.0,
          "y": 1230.0,
          "w": 220.0,
          "h": 90.0
        },
        "style_hint": null
      },
      {
        "id": "t7",
        "text": "站住！",
        "kind": "dialogue",
        "panel_id": "p5",
        "speaker_id": "older",
        "direction": "vertical",
        "bubble": "shout",
        "bbox": {
          "type": "rect",
          "x": 900.0,
          "y": 1225.0,
          "w": 80.0,
          "h": 175.0
        },
        "style_hint": null
      }
    ],
    "style_prompt": "High-taste, fully colored 2D anime digital painting comic page, crisp clean line art with soft cel shading and gentle painterly highlights, bright warm kitchen daylight, fresh pastel palette of lemon yellow, soft pink and cool grey, expressive comedic facial expressions, zero rough sketch lines.",
    "tags": [
      "2girls",
      "sisters",
      "home kitchen",
      "open refrigerator",
      "pudding cup",
      "slapstick comedy"
    ],
    "text_font_size": 42.0,
    "text_max_chars": 10,
    "overlays": [
      {
        "id": "panic",
        "character_id": "younger",
        "rect": {
          "type": "rect",
          "x": 220.0,
          "y": 470.0,
          "w": 580.0,
          "h": 720.0
        },
        "panel_id": "p2",
        "z_index": 1,
        "description": "turns around in total panic, caramel pudding at the corner of her lips, eyes wide with sweat drops, both hands raised defensively while hiding the empty pudding cup behind her back.",
        "status": "planned",
        "image_path": null,
        "mode": "moss"
      }
    ]
  },
  "version": "\"1792559947185171000-8abeecba63b15df7d3a016d6d5bfe6ce79a9fb55dfedef51174d81559873c2ff\"",
  "warnings": []
}
```

### POST /api/pages/{id}/skew

示例：`POST /api/pages/pudding/skew`，带当前页 If-Match。panels 为至少两个不同的现有相邻格 ID，也接受逗号分隔字符串；angle 默认 8 度，axis 为 auto（默认）/vertical/horizontal。与 CLI 一样检查完整相邻组，复用 skew_rectangles，写回前验证。返回完整页面和 warnings。

请求 JSON：
```json
{
  "panels": [
    "p1",
    "p2"
  ],
  "angle": 8,
  "axis": "auto"
}
```

响应：HTTP 200。
```json
{
  "page": {
    "format": "soda-storyboard-page-v1",
    "id": "pudding",
    "canvas_width": 1024,
    "canvas_height": 1536,
    "reading_direction": "rtl",
    "style_prefix": "",
    "description": "A younger sister eats the older sister's pudding, panics and runs away.",
    "panel_gap": 20,
    "dialogue_mode": "moss_text",
    "text_direction": "vertical",
    "color_mode": "color",
    "panels": [
      {
        "id": "p1",
        "order": 1,
        "shape": {
          "type": "quad",
          "points": [
            [
              486.64955706601705,
              24.0
            ],
            [
              1000.0,
              24.0
            ],
            [
              1000.0,
              500.0
            ],
            [
              553.5469943843553,
              500.0
            ]
          ]
        },
        "shot": "full",
        "angle": "eye",
        "character_ids": [
          "younger"
        ],
        "description": "冰箱前偷吃布丁",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Top-right panel: inside a bright home kitchen at night snack time, the younger sister: a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down crouches in front of the open refrigerator, happily eating a caramel pudding cup with a small spoon, the fridge light glowing on her face.",
        "figures": [
          {
            "character_id": "younger",
            "pose": "crouch",
            "position": "center",
            "facing": "front",
            "framing": null
          }
        ]
      },
      {
        "id": "p2",
        "order": 2,
        "shape": {
          "type": "quad",
          "points": [
            [
              24.0,
              24.0
            ],
            [
              466.45300561564466,
              24.0
            ],
            [
              533.350442933983,
              500.0
            ],
            [
              24.0,
              500.0
            ]
          ]
        },
        "shot": "medium",
        "angle": "eye",
        "character_ids": [
          "older"
        ],
        "description": "姐姐站在门口",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Top-left panel: the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest stands frozen in the kitchen doorway, one hand still on the door frame, her glasses glinting, staring at the empty pudding shelf in disbelief.",
        "figures": [
          {
            "character_id": "older",
            "pose": "stand",
            "position": "center",
            "facing": "front",
            "framing": null
          }
        ]
      },
      {
        "id": "p3",
        "order": 3,
        "shape": {
          "type": "rect",
          "x": 740.0,
          "y": 540.0,
          "w": 260.0,
          "h": 540.0
        },
        "shot": "close_up",
        "angle": "eye",
        "character_ids": [
          "older"
        ],
        "description": "姐姐推眼镜",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Middle-right small vertical panel: low-angle close-up of the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest pushing up her glasses with one finger, a cold, thin smile, a dark aura behind her as she slowly steps forward.",
        "figures": [
          {
            "character_id": "older",
            "pose": "hand_on_chin",
            "position": "center",
            "facing": "front",
            "framing": null
          }
        ]
      },
      {
        "id": "p4",
        "order": 4,
        "shape": {
          "type": "rect",
          "x": 24.0,
          "y": 540.0,
          "w": 256.0,
          "h": 540.0
        },
        "shot": "extreme_close_up",
        "angle": "eye",
        "character_ids": [
          "younger"
        ],
        "description": "妹妹捧着空布丁杯",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Middle-left small vertical panel: extreme close-up of the younger sister, a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down, holding an empty caramel pudding cup with a tiny spoon near her chin.",
        "figures": [
          {
            "character_id": "younger",
            "pose": "hands_clasped",
            "position": "center",
            "facing": "front",
            "framing": null
          }
        ]
      },
      {
        "id": "p5",
        "order": 5,
        "shape": {
          "type": "rect",
          "x": 24.0,
          "y": 1210.0,
          "w": 976.0,
          "h": 302.0
        },
        "shot": "full",
        "angle": "eye",
        "character_ids": [
          "younger",
          "older"
        ],
        "description": "妹妹逃跑，姐姐追赶",
        "dialogue": [],
        "sfx": [],
        "importance": 1,
        "status": "draft",
        "caption_en": "Bottom wide panel: comedic chase, the younger sister: a petite 14-year-old girl with bouncy pink twin tails, big round amber eyes, rosy cheeks, an oversized bright yellow hoodie with the hood down bursts out of the frame to the left with her pink twin tails and hoodie strings flying straight up in fright, speed lines behind her; the older sister: a tall 20-year-old young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest chases from the right, glasses flashing white.",
        "figures": [
          {
            "character_id": "younger",
            "pose": "run",
            "position": 0.36,
            "facing": "left",
            "framing": null
          },
          {
            "character_id": "older",
            "pose": "run",
            "position": 0.74,
            "facing": "left",
            "framing": null
          }
        ]
      }
    ],
    "texts": [
      {
        "id": "t1",
        "text": "冰箱里的布丁\n是姐姐的宝贝",
        "kind": "narration",
        "panel_id": "p1",
        "speaker_id": null,
        "direction": "vertical",
        "bubble": "box",
        "bbox": {
          "type": "rect",
          "x": 920.0,
          "y": 44.0,
          "w": 70.0,
          "h": 286.0
        },
        "style_hint": null
      },
      {
        "id": "t2",
        "text": "吧唧",
        "kind": "sfx",
        "panel_id": "p1",
        "speaker_id": null,
        "direction": "horizontal",
        "bubble": "none",
        "bbox": {
          "type": "rect",
          "x": 560.0,
          "y": 380.0,
          "w": 100.0,
          "h": 90.0
        },
        "style_hint": "near the pudding cup"
      },
      {
        "id": "t3",
        "text": "……你在吃什么？",
        "kind": "dialogue",
        "panel_id": "p2",
        "speaker_id": "older",
        "direction": "vertical",
        "bubble": "speech",
        "bbox": {
          "type": "rect",
          "x": 40.0,
          "y": 50.0,
          "w": 70.0,
          "h": 280.0
        },
        "style_hint": null
      },
      {
        "id": "t4",
        "text": "是……是冰箱\n自己打开的！",
        "kind": "dialogue",
        "panel_id": null,
        "speaker_id": "younger",
        "direction": "vertical",
        "bubble": "shout",
        "bbox": {
          "type": "rect",
          "x": 250.0,
          "y": 500.0,
          "w": 120.0,
          "h": 280.0
        },
        "style_hint": null
      },
      {
        "id": "t5",
        "text": "哦？",
        "kind": "dialogue",
        "panel_id": "p3",
        "speaker_id": "older",
        "direction": "vertical",
        "bubble": "speech",
        "bbox": {
          "type": "rect",
          "x": 920.0,
          "y": 560.0,
          "w": 70.0,
          "h": 120.0
        },
        "style_hint": null
      },
      {
        "id": "t6",
        "text": "咻——！",
        "kind": "sfx",
        "panel_id": "p5",
        "speaker_id": null,
        "direction": "horizontal",
        "bubble": "none",
        "bbox": {
          "type": "rect",
          "x": 60.0,
          "y": 1230.0,
          "w": 220.0,
          "h": 90.0
        },
        "style_hint": null
      },
      {
        "id": "t7",
        "text": "站住！",
        "kind": "dialogue",
        "panel_id": "p5",
        "speaker_id": "older",
        "direction": "vertical",
        "bubble": "shout",
        "bbox": {
          "type": "rect",
          "x": 900.0,
          "y": 1225.0,
          "w": 80.0,
          "h": 175.0
        },
        "style_hint": null
      }
    ],
    "style_prompt": "High-taste, fully colored 2D anime digital painting comic page, crisp clean line art with soft cel shading and gentle painterly highlights, bright warm kitchen daylight, fresh pastel palette of lemon yellow, soft pink and cool grey, expressive comedic facial expressions, zero rough sketch lines.",
    "tags": [
      "2girls",
      "sisters",
      "home kitchen",
      "open refrigerator",
      "pudding cup",
      "slapstick comedy"
    ],
    "text_font_size": 42.0,
    "text_max_chars": 10,
    "overlays": [
      {
        "id": "panic",
        "character_id": "younger",
        "rect": {
          "type": "rect",
          "x": 220.0,
          "y": 470.0,
          "w": 580.0,
          "h": 720.0
        },
        "panel_id": "p2",
        "z_index": 1,
        "description": "turns around in total panic, caramel pudding at the corner of her lips, eyes wide with sweat drops, both hands raised defensively while hiding the empty pudding cup behind her back.",
        "status": "planned",
        "image_path": null,
        "mode": "moss"
      }
    ]
  },
  "version": "\"1792559947193674800-737158c2a10c109f7755c763e8fbb633b1fb6833a74680521be2e61603b55450\"",
  "warnings": []
}
```

## 7. 出图与生产

每次请求通过 importlib 尝试导入 `soda_storyboard.production.api`。导入失败时，本节所有接口（包括 renders 和 plan）同步返回 501：

```json
{
  "error": "出图功能尚未安装"
}
```

所有生产 POST（包括 pick、compose、letter、export）都进入同一个串行队列，返回 HTTP 202、`Location: /api/jobs/{id}` 和完整 Job。POST 时只做本地参数检查，不等待生产结束。每个 Job 的 `operation` 对应 generate/pick/redraw/compose/letter/export；export 的 page_id 为 null。

`seeds` 默认 4，建议出图按钮显示即将生成的张数，确认用户此次要求后再发送。不要因为 409、网络重连或暂时未收到结果自动重复提交生成。各函数按照 P3 固定签名调用；额外参数返回 400。

### POST /api/pages/{id}/generate

示例：`POST /api/pages/pudding/generate`。seeds 是 1～32 的整数；preset 为 draft/final，model 可省略或 null（由 P3 使用项目默认值），也可 base/sft/自定义模型名；lora 默认 auto，也可 none/角色 ID。Job.result 是 P3 返回的候选列表，每项含 path、seed、meta。

请求 JSON：
```json
{
  "seeds": 4,
  "preset": "draft",
  "model": null,
  "lora": "auto"
}
```

响应：HTTP 202。
```json
{
  "id": "a15c7d937c314fe295981f4be0d84352",
  "operation": "generate",
  "page_id": "pudding",
  "status": "queued",
  "message": "排队中",
  "progress": null,
  "cancel_requested": false,
  "result": null,
  "error": null
}
```

### GET /api/pages/{id}/renders

示例：`GET /api/pages/pudding/renders`。按 P3 实际的 `page.production.renders` 登记记录关联 `pages/pudding/renders/*.png`。每张候选含 path/url，已登记时另带 seed/meta；metadata 是完整登记记录数组，selected_render 来自 production.selected_render，candidate_sheet 是独立拼图的 path/url 或 null。候选拼图及有登记记录时的未登记 PNG 不会混入可选底图。兼容旧页面顶层 renders/selected_render；无登记记录时回退为磁盘图片列表（除 *_candidates.png）。

请求：无请求体。

响应：HTTP 200。示例为选定一张合成测试底图后的状态：

```json
{
  "renders": [
    {
      "path": "pages/pudding/renders/20261021_42.png",
      "seed": 42,
      "meta": {
        "preset": "draft",
        "lora": null
      },
      "url": "/api/files/pages/pudding/renders/20261021_42.png"
    }
  ],
  "metadata": [
    {
      "path": "pages/pudding/renders/20261021_42.png",
      "seed": 42,
      "meta": {
        "preset": "draft",
        "lora": null
      }
    }
  ],
  "selected_render": "pages/pudding/renders/20261021_42.png",
  "candidate_sheet": {
    "path": "pages/pudding/renders/20261021_candidates.png",
    "url": "/api/files/pages/pudding/renders/20261021_candidates.png"
  }
}
```

### POST /api/pages/{id}/pick

示例：`POST /api/pages/pudding/pick`。render_path 必须是项目内已存在的图片，推荐直接使用 renders 返回的相对 path。任务结果是 pick_render 返回的对象；完成后刷新 Page。

请求 JSON：
```json
{
  "render_path": "pages/pudding/renders/20261021_42.png"
}
```

响应：HTTP 202。
```json
{
  "id": "a15c7d937c314fe295981f4be0d84352",
  "operation": "pick",
  "page_id": "pudding",
  "status": "queued",
  "message": "排队中",
  "progress": null,
  "cancel_requested": false,
  "result": null,
  "error": null
}
```

### GET /api/pages/{id}/plan

示例：`GET /api/pages/pudding/plan`。同步调用 production_plan，不提交生成。下例来自当前 P3 对真实布丁页的本地调用（尚未选底图）：needs_pick/needs_compose 指示后续操作，redraws/cuts/overlays 是待处理项目，lettering 给出排字需求，warnings 给出中文提示。内部键来自 P3，前端应容忍后续扩展。

请求：无请求体。

响应：HTTP 200。

```json
{
  "page_id": "pudding",
  "selected_render": null,
  "needs_pick": true,
  "main_character": null,
  "redraws": [],
  "cuts": [],
  "overlays": [],
  "lettering": {
    "needed": false,
    "text_ids": []
  },
  "needs_compose": true,
  "warnings": []
}
```

### POST /api/pages/{id}/panels/{panel_id}/redraw

示例：`POST /api/pages/pudding/panels/p3/redraw`。mode 为 detail（默认）/swap；character_id 可省略或 null，denoise 可省略或 null（交给 P3 按模式选择）或 0～1。格子不存在立即 404。此接口只覆盖约定的 redraw_panel 签名。

请求 JSON：
```json
{
  "mode": "swap",
  "character_id": "older",
  "denoise": 0.85
}
```

响应：HTTP 202。
```json
{
  "id": "a15c7d937c314fe295981f4be0d84352",
  "operation": "redraw",
  "page_id": "pudding",
  "status": "queued",
  "message": "排队中",
  "progress": null,
  "cancel_requested": false,
  "result": null,
  "error": null
}
```

### POST /api/pages/{id}/compose

示例：`POST /api/pages/pudding/compose`。按 P3 固定签名无选项。Job.result 是输出图片路径字符串。

请求 JSON：
```json
{}
```

响应：HTTP 202。
```json
{
  "id": "a15c7d937c314fe295981f4be0d84352",
  "operation": "compose",
  "page_id": "pudding",
  "status": "queued",
  "message": "排队中",
  "progress": null,
  "cancel_requested": false,
  "result": null,
  "error": null
}
```

### POST /api/pages/{id}/letter

示例：`POST /api/pages/pudding/letter`。按 P3 固定签名无选项。Job.result 是排字图片路径字符串；字体等由 P3 负责。

请求 JSON：
```json
{}
```

响应：HTTP 202。
```json
{
  "id": "a15c7d937c314fe295981f4be0d84352",
  "operation": "letter",
  "page_id": "pudding",
  "status": "queued",
  "message": "排队中",
  "progress": null,
  "cancel_requested": false,
  "result": null,
  "error": null
}
```

### POST /api/export

page_ids 可省略/null（整个项目）或页面 ID 数组；format 默认 png，可为 pdf。调用 P3 export(project_dir, page_ids=..., fmt=...)。Job.result 是输出路径数组。文件接口仅允许图片/JSON，因此 PDF 从本地输出路径打开，不通过 /api/files 下载。

请求 JSON：
```json
{
  "page_ids": [
    "pudding"
  ],
  "format": "png"
}
```

响应：HTTP 202。
```json
{
  "id": "a15c7d937c314fe295981f4be0d84352",
  "operation": "export",
  "page_id": null,
  "status": "queued",
  "message": "排队中",
  "progress": null,
  "cancel_requested": false,
  "result": null,
  "error": null
}
```

## 8. 后台任务

状态流转：`queued → running → completed | failed | cancelled`；排队取消为 `queued → cancelled`。运行时 `cancel_requested: true` 保持 running，直到明确的安全回调或当前步骤返回；不会同时启动第二项 GPU 工作。

任务保存在内存里，服务重启即丢失（查询 404）。图片和项目文件保留。取消不承诺回滚：只有 P3 的 stage=candidate（下一张提交前）或 stage=completed（GPU 完成后）回调会中断调用；stage=submitted/waiting 和未知回调继续等待当前 GPU 工作完成。没有安全 progress 回调的生产函数执行到返回，已提交的底层步骤也可能已经写入结果。服务不会调用 ComfyUI 的全局 interrupt 来影响其他任务。前端应展示“正在取消”，直到终态，再刷新磁盘状态。后台错误不改变任务查询的 HTTP 状态，`status: failed` 的 error 才是中文失败原因。

### GET /api/jobs/{id}

示例：`GET /api/jobs/a15c7d937c314fe295981f4be0d84352`。queued/running/completed/failed/cancelled 共五种状态；progress 由回调规范化为 `{args: [...], ...回调关键字参数}`，无回调时为 null。result 原样保留 P3 JSON 结构；路径可能是 P3 返回的本地绝对路径，图片展示优先重新请求 renders 得到安全 URL。

请求：无请求体。

响应：HTTP 200。
```json
{
  "id": "a15c7d937c314fe295981f4be0d84352",
  "operation": "generate",
  "page_id": "pudding",
  "status": "completed",
  "message": "已完成",
  "progress": {
    "args": [
      1,
      4
    ],
    "message": "候选完成"
  },
  "cancel_requested": false,
  "result": [
    {
      "path": "pages/pudding/renders/20261021_42.png",
      "seed": 42,
      "meta": {
        "preset": "draft"
      }
    }
  ],
  "error": null
}
```

失败示例：
```json
{
  "id": "a15c7d937c314fe295981f4be0d84352",
  "operation": "generate",
  "page_id": "pudding",
  "status": "failed",
  "message": "任务失败",
  "progress": null,
  "cancel_requested": false,
  "result": null,
  "error": "任务执行失败：测试模型文件不存在"
}
```

### POST /api/jobs/{id}/cancel

示例：`POST /api/jobs/a15c7d937c314fe295981f4be0d84352/cancel`。排队任务立即 cancelled，不再调用 P3；运行任务返回下例等待安全边界；终态重复取消无副作用。

请求 JSON：
```json
{}
```

响应：HTTP 200。
```json
{
  "id": "a15c7d937c314fe295981f4be0d84352",
  "operation": "generate",
  "page_id": "pudding",
  "status": "running",
  "message": "已请求取消，等待当前步骤结束",
  "progress": null,
  "cancel_requested": true,
  "result": null,
  "error": null
}
```

## 9. 项目文件

### GET /api/files/{项目内相对路径}

示例：`GET /api/files/characters/older.json`。只读，允许 .json、.png、.jpg、.jpeg、.webp、.gif、.bmp（后缀不区分大小写）。JSON 原样返回（没有包装），图片返回实际 MIME 二进制。路径按 / 分隔，各段 encodeURIComponent；禁止 ..、驱动器/ADS、绝对越界、越界符号链接，隐藏路径除 .server 缓存外拒绝。不存在返回 404，不允许的路径/类型返回 400。其他图片示例：`GET /api/files/.server/layouts/{candidate_id}.png`。

请求：无请求体。

响应：HTTP 200。
```json
{
  "format": "soda-storyboard-character-v1",
  "id": "older",
  "display_name": "姐姐",
  "trigger_words": [],
  "clothing": [],
  "reference_images": [],
  "approved_images": [],
  "appearance": {
    "en": "a tall young woman with straight glossy black shoulder-length bob hair, thin silver-framed glasses, calm sharp dark eyes, a crisp white blouse under a soft grey knit vest"
  },
  "age": "20-year-old",
  "figure_hint": "skirt"
}
```

## 10. 实时事件（SSE）

### GET /api/events

无请求体。返回 HTTP 200、`Content-Type: text/event-stream; charset=utf-8`。每条事件为 event/data 加空行，data 是单行 JSON；连接空闲时每秒发 `: heartbeat` 注释。浏览器 EventSource 自动重连。本协议不提供历史重放或 Last-Event-ID 保证，所以连接/重连必须刷新状态。

```typescript
const events = new EventSource('http://127.0.0.1:8780/api/events');
events.addEventListener('ready', () => refreshProjectAndCurrentPage());
events.addEventListener('resync', () => refreshProjectAndCurrentPage());
events.addEventListener('file_changed', e => {
  const change = JSON.parse((e as MessageEvent).data);
  // 有未保存编辑时先提示并保留编辑，不能直接用服务器 Page 覆盖。
  // change.page_id 对应当前页时，再 GET 页面并比较 version。
});
events.addEventListener('job', e => {
  const job = JSON.parse((e as MessageEvent).data);
  // 更新任务卡片；完成/取消/失败后重新读取页面、renders、plan。
});
// 页面卸载：events.close()
```

第一次连接（及重连）立即发送：

```text
event: ready
data: {"refresh":true}

```

后台每秒比较项目内图片/JSON 的 mtime_ns 与大小；不监视隐藏目录（包括 .server/.trash/.git）。直接 pages/*.json 的事件带 page_id 和最新版本；非页面文件 page_id/version 为 null；删除时 version 为 null。不能可靠区分 CLI、AI、编辑器自身写入，所以 source 固定 unknown，前端只能提示“页面已在外部修改”，不要编造“AI 刚修改了第 3 格”。编辑器自身保存产生的事件可按 version 与已知保存结果相同去重。文件极短暂的中间状态及一秒内反复修改会合并；CLI 写到半途的非法 JSON 会在后续扫描重试。

外部修改事件（change 还可为 added/deleted）：

```text
event: file_changed
data: {"path": "pages/pudding.json", "change": "modified", "page_id": "pudding", "version": "\"1792553078596086800-5569a2f3cb30516e3cd6e9760422c0b0c256ffaa79ff023ba27b10ba2d8ea50a\"", "source": "unknown", "message": "页面已在外部修改"}

```

删除事件：

```text
event: file_changed
data: {"path": "pages/pudding.json", "change": "deleted", "page_id": "pudding", "version": null, "source": "unknown", "message": "页面已在外部修改"}

```

任务排队、启动、每次 progress、完成/失败/取消时都发送完整 Job：

```text
event: job
data: {"id": "a15c7d937c314fe295981f4be0d84352", "operation": "generate", "page_id": "pudding", "status": "completed", "message": "已完成", "progress": {"args": [1, 4], "message": "候选完成"}, "cancel_requested": false, "result": [{"path": "pages/pudding/renders/20261021_42.png", "seed": 42, "meta": {"preset": "draft"}}], "error": null}

```

每个 SSE 客户端最多缓冲 256 个事件；积压时清空旧事件并要求全量刷新：

```text
event: resync
data: {"message":"事件积压，请重新读取项目"}

```

断线时可轮询 `GET /api/jobs/{id}`（例如 1 秒一次）；重新连上后刷新当前任务。pending job ID 可保存在前端会话中，重启后查询 404 时告知记录失效。

## 11. CORS 与监听

仅允许 `http://localhost:5173`、`http://127.0.0.1:5173` 及与请求 Host 完全同源的 `http://本地回环地址:服务端口`。允许响应含 `Access-Control-Allow-Origin: 请求源`、`Vary: Origin` 和 `Access-Control-Expose-Headers: ETag`。不使用 Cookie 或 credentials；不返回星号。没有 Origin 的本地 CLI 请求允许访问。

### OPTIONS /api/pages/pudding（其他资源同理）

无 JSON 请求体。开发服务器预检示例：

```http
OPTIONS /api/pages/pudding HTTP/1.1
Host: 127.0.0.1:8780
Origin: http://localhost:5173
Access-Control-Request-Method: PUT
Access-Control-Request-Headers: Content-Type, If-Match
```

响应 204、空响应体：

```http
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, If-Match
Access-Control-Max-Age: 600
Vary: Origin
```

不允许的 Origin 和非本地 Host 返回 403 且没有允许跨域的响应头。CLI 启动接受 127.0.0.1、localhost、::1 等回环地址，拒绝 0.0.0.0、:: 和局域网 IP。IPv6 地址需写作 `http://[::1]:8780`。

## 12. 前端数据字段

所有坐标是画布像素，原点在左上、x 向右、y 向下（仅 GET templates 的归一化几何例外）。画布缩放是视图变换，保存前要换算回画布坐标。

### Page

| 字段 | 类型 / 含义 |
| --- | --- |
| format / id | soda-storyboard-page-v1 / 页面文件 ID。 |
| canvas_width / canvas_height | 正整数，布丁例为 1024×1536。 |
| reading_direction | rtl 或 ltr；保存格子时仍需显式维护 order。 |
| panel_gap | 最小格间距；写回版式时参与校验。 |
| panels | Panel[]；数组可显示重排，真实阅读顺序用 order。 |
| texts | Text[]，全页坐标，推荐使用这一层维护文字框。 |
| overlays | Overlay[]，可省略或空数组，独立出格层。 |
| dialogue_mode | moss_text：文字送入 MOSS；lettering：后续程序排字。 |
| text_direction | vertical / horizontal，全页默认方向。 |
| text_font_size / text_max_chars | 字号（默认 42）/每列字数（默认 10），用于排字估算。 |
| color_mode | color / monochrome。 |
| description / style_prefix / style_prompt / tags | 页描述、风格前缀、详细风格（可 null）、标签数组。 |
| 其他键 | 兼容元数据与 P3 生产记录，必须保留。 |

### Panel

| 字段 | 类型 / 含义 |
| --- | --- |
| id / order | 格 ID / 从 1 开始连续且不重复的阅读序号。 |
| shape | rect `{type,x,y,w,h}` 或 quad `{type,points:[[x,y],...]}`；quad 必须四点且为有效凸多边形。 |
| shot | extreme_long / long / full / medium / close_up / extreme_close_up。 |
| angle | eye / high / low / bird / worm / dutch。 |
| character_ids | 角色 ID 数组，对应项目 characters 里的角色。 |
| description / caption_en | 中文/英文画面描述；不要互相覆盖。 |
| dialogue | 兼容旧台词对象数组：speaker_id、text、bubble、可选 position；已有值需保留。 |
| sfx | 旧拟声词字符串数组。推荐新编辑写入 Page.texts，避免重复呈现。 |
| figures | Figure[]，角色站位和火柴人姿态。 |
| importance / status | 版式权重（默认 1）/draft、approved、needs_redraw。 |

### Figure（位于 Panel.figures）

| 字段 | 类型 / 含义 |
| --- | --- |
| character_id | 角色 ID，不能引用不存在的角色。 |
| pose | stand、walk、run、sit、crouch、wave、point、arms_up、hands_clasped、hand_on_chin、lie、back_view；未知值有 warning，预览回退 stand。 |
| position | left / center / right 或 0～1 的数字，是格子内水平位置。 |
| facing | left / right / front / back。 |
| framing | null / full / waist / bust / face。 |

布丁页 p5 的真实 figures：

```json
[
  {
    "character_id": "younger",
    "pose": "run",
    "position": 0.36,
    "facing": "left",
    "framing": null
  },
  {
    "character_id": "older",
    "pose": "run",
    "position": 0.74,
    "facing": "left",
    "framing": null
  }
]
```

### Text（位于 Page.texts）

| 字段 | 类型 / 含义 |
| --- | --- |
| id | 唯一文字 ID。 |
| text | Unicode 文本，保留换行。 |
| kind | dialogue / narration / sfx / title / caption_tag。 |
| panel_id | 关联格 ID 或 null；允许跨格文字。 |
| speaker_id | 说话人角色 ID 或 null。 |
| direction | vertical / horizontal / null（继承页面）。 |
| bubble | speech / shout / thought / box / none。 |
| bbox | rect 或 null；为 null 时由核心排字估算，拖动时写显式全页 bbox。 |
| style_hint | 字符串或 null。 |

布丁页 t3 的真实文字框：

```json
{
  "id": "t3",
  "text": "……你在吃什么？",
  "kind": "dialogue",
  "panel_id": "p2",
  "speaker_id": "older",
  "direction": "vertical",
  "bubble": "speech",
  "bbox": {
    "type": "rect",
    "x": 40,
    "y": 50,
    "w": 70,
    "h": 280
  },
  "style_hint": null
}
```

### Overlay（位于 Page.overlays）

| 字段 | 类型 / 含义 |
| --- | --- |
| id / character_id | 唯一图层 ID / 角色 ID。 |
| rect | 全页坐标矩形。 |
| panel_id | 关联的来源格或 null。 |
| z_index | >=1，层级高于格子。 |
| description | 出格人物画面描述。 |
| status | planned / approved。 |
| image_path | 图片路径或 null，实际使用交给 P3。 |
| mode | moss：由整页生成；layer：后续单独生成/抠图叠加。 |

布丁页真实 overlay：

```json
{
  "id": "panic",
  "character_id": "younger",
  "rect": {
    "type": "rect",
    "x": 220,
    "y": 470,
    "w": 580,
    "h": 720
  },
  "panel_id": "p2",
  "z_index": 1,
  "description": "turns around in total panic, caramel pudding at the corner of her lips, eyes wide with sweat drops, both hands raised defensively while hiding the empty pudding cup behind her back.",
  "status": "planned",
  "image_path": null,
  "mode": "moss"
}
```

### Character

角色完整实例见 4。主要字段为 id、display_name、trigger_words、appearance（zh/en）、clothing、reference_images、approved_images，以及可选 lora `{path,strength}`、age、figure_hint。第一版角色列表可只展示摘要，但保存角色卡应保留全部字段。

## 13. 前端对接顺序与接口索引

初始化 project → 读取选定 Page/version → 订阅 SSE → 本地编辑 → PUT/冲突合并 → 版式候选/预览/编译 → 生产 POST → 等待 Job 终态 → 刷新 Page/renders/plan。生产任务运行期间，同一页的写入会返回 reason=production_running 的 409；前端保留本地草稿，任务完成后重新获取版本再合并。外部 CLI 写入不能由此锁阻止。

| 模块 | 接口 |
| --- | --- |
| 项目 | GET/PATCH /api/project |
| 页面 | GET/POST /api/pages；GET/PUT/DELETE /api/pages/{id} |
| 角色 | GET/POST /api/characters；GET/PUT /api/characters/{id} |
| 检查/输出 | POST /api/pages/{id}/validate；GET /api/pages/{id}/preview.png；POST /api/pages/{id}/compile |
| 版式 | GET /api/templates；POST /api/pages/{id}/layout-suggest、layout-apply、skew |
| 出图 | POST /api/pages/{id}/generate、pick、compose、letter；GET /api/pages/{id}/renders、plan |
| 重画/导出 | POST /api/pages/{id}/panels/{panel_id}/redraw；POST /api/export |
| 文件 | GET /api/files/{relative_path} |
| 任务 | GET /api/jobs/{id}；POST /api/jobs/{id}/cancel |
| 推送 | GET /api/events：ready、resync、file_changed、job |
| 跨域 | OPTIONS；仅允许两种 Vite 来源及同源 |
