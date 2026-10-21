# 编辑源分镜单

完整 JSON Schema 随 skill 放在 assets/storyboard-v1.schema.json，测试会核对其与仓库 schema 一致。编辑用户的页文件，不编辑编译后的 MOSS JSON 来补剧情。只修改用户要求的字段，其他字段和扩展信息保持原样。

## 项目与角色

项目目录有 project.json、characters/、pages/、可选 templates/。画布默认 1024×1536，宽高应为 16 的倍数；项目有 reading_direction、default_style_prefix、default_dialogue_mode、text_direction 和 color_mode。用户选定的英文画风写入项目或页面 style_prompt；tags 是英文标签列表，页面显式 tags 覆盖项目。旧 style_prefix 仍保留，但 summary 先使用 style_prompt 或英文兜底画风，再接旧前缀。

角色卡的核心字段是 id、display_name、trigger_words、lora（path / strength）、appearance（zh / en）、clothing、reference_images、approved_images，可空 age（如 20-year-old）、figure_hint（skirt 表示草稿裙摆）。appearance_en 应由 AI 根据用户中文补全。LoRA 路径由用户提供，只记录，不搜索或加载文件。

```shell
soda-storyboard character new --project my-story --id girl --name "女孩" --appearance-en "short black hair" --json
soda-storyboard character set girl --project my-story --name "澪" --trigger "girl_token" --lora "models/girl.safetensors" --lora-strength 0.75 --reference "refs/front.png" --json
soda-storyboard character list --project my-story --json
```

set 的 id 是位置参数，new 的 id 是 --id。set 按卡片里的 id 查找，文件名可以不同；没有角色就报错，不自动创建。set 只改给出的逻辑字段，保留未提供的原字段和扩展数据。重复 trigger / outfit / reference 表示替换该字段的整个列表。set 不提供删除字段的专用参数；需要删除时直接精确编辑源 JSON。负 LoRA 强度可以记录，NaN / Infinity 不接受；未建立 LoRA 时不能仅设强度。

## 页面与每格

页面 format 为 soda-storyboard-page-v1，包含 id、canvas_width、canvas_height、reading_direction（rtl / ltr）、style_prefix、description、panel_gap、dialogue_mode（moss_text / lettering）、panels。可选 text_direction 为 vertical / horizontal，color_mode 为 monochrome / color；style_prompt、tags 同项目。text_font_size 默认为 42（1024 宽画布的像素字号，随画布宽度等比缩放），text_max_chars 默认为 10，控制每列/行最多字符数。

Panel 的 id 稳定不变，order 从 1 连续编号，按 order 找“第几格”。shape 是左上角原点像素几何：rect 用 x,y,w,h；quad 用沿边界依次排列的四个 points。生成候选中的 order 要留在 Panel，不能塞进 shape。不要手写随意坐标替代已选版式。

- shot：extreme_long、long、full、medium、close_up、extreme_close_up。
- angle：eye、high、low、bird、worm、dutch。没有 back、over_shoulder、POV 枚举；这些观察方向写进 description，并选一个合法 angle。
- character_ids：角色 id 数组。description：这一格的可见画面、姿势、朝向、重点。可空 caption_en 优先成为 object caption，应包含格子位置、景别角度、每个人完整英文外观和动作。
- dialogue：对象数组，包含 speaker_id、text、bubble（speech / shout / thought / narration），可选 position。不说话就空数组。
- sfx：需要画出的拟声词字符串数组，不把速度线等画法当作文字。
- importance：1 / 2 / 3。status：draft / approved / needs_redraw。

page new 产生空 panels。选定格数后由 AI 先创建对应数量的 Panel 对象；layout suggest --page 才能按已有 order 写回形状，格数不符会报错。仅展示候选时传 panels，不传 page。写回布局保留其他原始字段，逐格改镜头时不要重新布局。

## 人物 figures 和独立 texts

Panel 可选 figures 数组。每个 figure 含 character_id、pose（默认 stand）、position（0～1 的水平位置，或 left / center / right）、facing（left / right / front / back）、可空 framing（full / waist / bust / face）。没有 figures 时按 character_ids 自动排开，rtl 下第一个在右边。framing 默认随景别：远景/全景 full，中景 waist，近景 bust，特写 face。

pose 预设：stand、walk、run、sit、crouch、wave、point、arms_up、hands_clasped、hand_on_chin、lie、back_view；未知值给 warning 并画 stand。人物名显示在头部附近，人物裁在所属格子内。用户调整姿势或站位时只改对应 figure。

页面可选 texts 数组，每个文字元素含：

- id：稳定且不重复；kind：dialogue / narration / sfx / title / caption_tag。
- text：原文，保留换行；竖排换行表示新列，横排表示新行。
- panel_id：所属格子，可空；speaker_id：对白说话人，可空。
- direction：vertical / horizontal，可空时跟随页面；bubble：speech / shout / thought / box / none。
- bbox：可空的左上角原点像素矩形 `{ "x": 40, "y": 50, "w": 70, "h": 280 }`，可加 type: rect；style_hint：可空英文样式和位置补充。

没有 bbox 时根据字数、方向和 text_font_size 自动估算并缩放放进格子。竖排宽=列数×字宽×1.3，高=每列最多字数×字高×1.15；横排交换轴。给定 bbox 原样保留，明显与方向不符时 validate 给 warning。旧 dialogue/sfx 编译时自动适配成 texts，不改源文件；迁移同一句话到 texts 后应删去旧 dialogue，避免重复。moss_text 输出独立 text 字段，caption 只写英文样式/位置；lettering 时所有文字留待后期，但草稿仍显示文字规划。

草稿稳定使用青色格子和格内人物、红色跨格人物/标题、绿色文字框。preview 默认草稿，--style boxes 为旧纯框线版。

## 出格图层

可选 overlays 数组，含 mode（moss / layer）、id、panel_id（可为 null）、character_id、rect、z_index（正整数）、description、status（planned / approved）、image_path（可为 null）。overlay 可跨出所属格子，但不能超出画布。角色引用必须存在；不修改出格图层时保持它不变。

新增 overlay 必须显式选 mode，默认选择 moss：preview 画红色大号人物，compile 生成 character 条目。layer 保留绿色虚线框，留待第 3 阶段抠图叠加。旧页省略 mode 时读成 layer；Python 新建 Overlay 默认 moss，序列化会写 mode。两种模式都会进 map；都不读取 image_path 或合成真实人物。不要把草稿人物说成已生成人物图层。跨格手法仅在登场/高潮/强调人物时按需使用。
