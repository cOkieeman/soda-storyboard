# 给其他 AI 的分镜输出说明

把下面这段要求连同用户的故事直接交给其他 AI：

> 请把故事拆成一页可编辑漫画分镜，输出一个完整 JSON 对象，不要输出 ComfyUI 工作流。使用 `soda-storyboard-page-v1`，中文写剧情和台词。画布默认 1024×1536，坐标为左上角原点的像素；矩形是 `x,y,w,h`，四边形是顺边界排列的四点。格子不重叠、不越界，留出格间白边，`order` 从 1 连续编号，按右上到左下阅读。人物姿势必须与剧情一致。不要在画面描述中加“第 N 格”等会被画成文字的标签。台词、旁白和标题独立放 `texts`，原文保存在 `text`。没提供角色卡时，不要虚构 `character_id`：用中文描述人物并将角色引用留空。只在已有角色卡时使用对应 id。不要伪造自动译文或 source_hash；英文出图前由 Soda 插件通过 translate --todo/--apply 维护译文。用户的故事和已确认选择优先。

每个格子包含 `id,order,shape,shot,angle,description,character_ids,figures`。景别支持 `extreme_long,long,full,medium,close_up,extreme_close_up`；角度支持 `eye,high,low,bird,worm,dutch`。人物预设包括 `stand,walk,run,sit,crouch,wave,point,arms_up,hands_clasped,hand_on_chin,lie,back_view,handshake,hug`，朝向 `front,back,left,right`。人物的旧 `position` 可以是 left/center/right 或 0～1。

已有角色卡时，固定外观放 `appearance.zh/en`：发型发色、服装款式与颜色、尾巴或头饰等显著标志物；`clothing` 逐件写清颜色和款式，同页角色之间要有区分。`lora` 为可选字段，整页最多用一个 LoRA，其余角色或全员均按描述出图；不要安排为配角切换 LoRA 的后期步骤。项目 `lora_policy` 为 `single`（默认）或 `none`，页面可选 `lora_character`（角色 id / `none`，省略自动）。翻译待办只翻场景、动作、道具，外观、镜头、程序姿势、方位由编译器插入；含外观的旧整句缓存需要通过 `translate --todo/--apply` 重译迁移。

文字的 `panel_id` 可为空，表示页上文字；`kind` 支持 dialogue/narration/sfx/title/caption_tag，`bubble` 支持 speech/shout/thought/box/none。物件用 `objects`，包含 `id,rect,caption`，可选 `panel_id`，描述框直接编译成 object。单画布页使用 `canvas_mode: "single"` 和空 `panels`，照常放文字、物件或 `label: "character"` 的人物框。

完整示例（没有外部角色卡依赖）：

```json
{
  "format": "soda-storyboard-page-v1",
  "id": "sun-after-rain",
  "canvas_width": 1024,
  "canvas_height": 1536,
  "canvas_mode": "panels",
  "reading_direction": "rtl",
  "panel_gap": 24,
  "dialogue_mode": "moss_text",
  "text_direction": "vertical",
  "color_mode": "color",
  "description": "雨停后，女孩发现窗边开了一朵花。",
  "panels": [
    {"id": "p1", "order": 1, "shape": {"type": "rect", "x": 40, "y": 40, "w": 944, "h": 700}, "shot": "medium", "angle": "eye", "description": "短发女孩站在窗前，望着窗外渐亮的天空。", "character_ids": [], "figures": []},
    {"id": "p2", "order": 2, "shape": {"type": "rect", "x": 40, "y": 764, "w": 944, "h": 732}, "shot": "close_up", "angle": "eye", "description": "窗台的白色小花挂着水珠，阳光落在花瓣上。", "character_ids": [], "figures": []}
  ],
  "texts": [
    {"id": "t1", "text": "雨停了。", "kind": "dialogue", "panel_id": "p1", "speaker_id": null, "direction": "vertical", "bubble": "speech", "bbox": {"type": "rect", "x": 820, "y": 80, "w": 100, "h": 240}}
  ],
  "objects": [
    {"id": "flower-pot", "rect": {"type": "rect", "x": 360, "y": 1100, "w": 240, "h": 280}, "caption": "窗台上的白色陶瓷花盆", "panel_id": "p2", "label": "object"}
  ]
}
```

已有 MOSS 布局也可直接交给导入器，保留 `summary,items,bbox_format,bbox_coord_space`。中心原点的 yxyx 是 `[上,左,下,右]`，不能和本页格式的左上角像素坐标混用。宽松导入会解释常见别名和归一化坐标，但所有猜测都需要核对理解报告。
