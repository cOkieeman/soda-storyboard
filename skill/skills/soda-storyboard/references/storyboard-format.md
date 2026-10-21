# 编辑源分镜单

完整 JSON Schema 随 skill 放在 assets/storyboard-v1.schema.json，测试会核对其与仓库 schema 一致。编辑用户的页文件，不编辑编译后的 MOSS JSON 来补剧情。只修改用户要求的字段，其他字段和扩展信息保持原样。

## 项目与角色

项目目录有 project.json、characters/、pages/、可选 templates/。画布默认 1024×1536，宽高应为 16 的倍数；项目有 reading_direction、default_style_prefix、default_dialogue_mode、text_direction 和 color_mode。用户选择的风格可写入项目默认或页面 style_prefix；不替用户选择。

角色卡的核心字段是 id、display_name、trigger_words、lora（path / strength）、appearance（zh / en）、clothing、reference_images、approved_images。LoRA 路径由用户提供，只记录，不搜索或加载文件。

```shell
soda-storyboard character new --project my-story --id girl --name "女孩" --appearance-en "short black hair" --json
soda-storyboard character set girl --project my-story --name "澪" --trigger "girl_token" --lora "models/girl.safetensors" --lora-strength 0.75 --reference "refs/front.png" --json
soda-storyboard character list --project my-story --json
```

set 的 id 是位置参数，new 的 id 是 --id。set 按卡片里的 id 查找，文件名可以不同；没有角色就报错，不自动创建。set 只改给出的逻辑字段，保留未提供的原字段和扩展数据。重复 trigger / outfit / reference 表示替换该字段的整个列表。set 不提供删除字段的专用参数；需要删除时直接精确编辑源 JSON。负 LoRA 强度可以记录，NaN / Infinity 不接受；未建立 LoRA 时不能仅设强度。

## 页面与每格

页面 format 为 soda-storyboard-page-v1，包含 id、canvas_width、canvas_height、reading_direction（rtl / ltr）、style_prefix、description、panel_gap、dialogue_mode（moss_text / lettering）、panels。可选 text_direction 为 vertical / horizontal，color_mode 为 monochrome / color。

Panel 的 id 稳定不变，order 从 1 连续编号，按 order 找“第几格”。shape 是左上角原点像素几何：rect 用 x,y,w,h；quad 用沿边界依次排列的四个 points。生成候选中的 order 要留在 Panel，不能塞进 shape。不要手写随意坐标替代已选版式。

- shot：extreme_long、long、full、medium、close_up、extreme_close_up。
- angle：eye、high、low、bird、worm、dutch。没有 back、over_shoulder、POV 枚举；这些观察方向写进 description，并选一个合法 angle。
- character_ids：角色 id 数组。description：这一格的可见画面、姿势、朝向、重点。
- dialogue：对象数组，包含 speaker_id、text、bubble（speech / shout / thought / narration），可选 position。不说话就空数组。
- sfx：需要画出的拟声词字符串数组，不把速度线等画法当作文字。
- importance：1 / 2 / 3。status：draft / approved / needs_redraw。

page new 产生空 panels。选定格数后由 AI 先创建对应数量的 Panel 对象；layout suggest --page 才能按已有 order 写回形状，格数不符会报错。仅展示候选时传 panels，不传 page。写回布局保留其他原始字段，逐格改镜头时不要重新布局。

## 出格图层

可选 overlays 数组，含 id、panel_id（可为 null）、character_id、rect、z_index（正整数）、description、status（planned / approved）、image_path（可为 null）。overlay 可跨出所属格子，但不能超出画布。角色引用必须存在；不修改出格图层时保持它不变。

preview 仅画出“出格”虚线框，不读取 image_path 或合成透明人物。compile 不把 overlay 交给 MOSS；with-ids 的 map 会列出它。不要把“已规划出格位置”说成“已生成人物图层”。
