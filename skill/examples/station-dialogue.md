# 示例：车站回头，从想法到 MOSS JSON

这是保留旧 dialogue 格式的兼容性示范对话，不表示插件开发时已替用户运行预览或出图。新页优先按当前文件格式写独立 texts、英文 caption_en 和 figures，本文随包 JSON 保留旧字段用于回归验证。实际使用时应嵌入工具生成的线框 PNG；这里用文字标出展示位置。

## 听片段、建立角色

用户：女孩在车站听见熟悉的声音，回头想说什么，最后又没说。帮我做成一页日漫。

AI：你想让结尾更像舍不得离开，还是已经决定告别？这一页只出现女孩一个人吗？

用户：舍不得。另一个人只在画面外，别露面。

AI：女孩叫什么？有固定外观、触发词或人物 LoRA 吗？没有的话也能先做分镜。

用户：叫澪，黑色短发，浅色校服，背帆布包。触发词 girl_token，LoRA 路径 models/girl.safetensors，参考图 refs/girl.png。

AI：我会把她记作 girl，以后每格引用这个角色。她的 LoRA 先用默认 0.8。你还没指定画法，可以选清爽赛璐珞（Clean 2D anime comic, crisp outlines, flat cel shading）、彩色厚涂（Fully colored 2D digital painting, gentle painterly highlights）或黑白网点（Black-and-white manga, crisp ink lines, screentone shading）。只写 anime 可能偏 3D。

用户：画风用 clean 2D cel-shaded, crisp line art, screentone shading。

AI 内部操作（用户无需读命令原文；新目录、新角色才执行 new）：

```shell
soda-storyboard init my-story --name "车站回头" --direction rtl --json
soda-storyboard character new --project my-story --id girl --name "澪" --trigger "girl_token" --lora "models/girl.safetensors" --appearance-zh "黑色短发" --outfit "浅色校服" --outfit "帆布包" --reference "refs/girl.png" --json
```

## 选择拆格

AI：我给你三个读法。

- A，四格：先半身看她停住；再靠近看回头的眼神，第 2 格说“……是你？”；第 3 格从头到脚看她抓包带，说“我正要走。”；最后拉远，门快关上，她只笑了一下。结尾停在没说出的那句话。
- B，五格：开头先交代整个站台，再把停步、回头、攥紧包带分开，最后停在迟疑的微笑。“……是你？”在第 3 格，“我正要走。”在第 4 格。多一格让犹豫留久一点。
- C，三格：站台上的背影；近看她回头，说“……是你？我正要走。”；最后是门快关上的远景和没有说出口的告别。更快，但少看一次细微反应。

**【停下来等用户确认 ①】AI 在此结束当前回复，等待选择；没有创建定稿或编译。**

用户：A，四格。

## 选择版式

AI 内部操作：

```shell
soda-storyboard layout suggest --panels 4 --candidates 6 --direction rtl --preview-dir my-story/previews/candidates --json
```

AI：【实际界面依次嵌入返回的六张线框；下面的名称以当次 JSON 为准，不能假定固定排序。】

AI：这次六个选项可以这样看：

- balanced-grid：规则网格，每次停顿差不多长，适合安静地看她犹豫。
- hero-top-skew：上面的大格先突出突然停步，下面的斜边让反应稍显紧张。
- dialogue-stagger：宽窄交替，像一句话和一次反应来回接住。
- action-step-skew：把回头拆成更急促的推进，动作感更强。
- cinematic-stack：横向画面依次铺开，让站台和沉默占更多空间。
- hero-bottom-skew：前面逐步铺垫，最后用大格留住迟疑的微笑，斜边会增加起伏。

AI：你更想选哪一种？

**【停下来等用户确认 ②】等待用户选版式，不把排名第一当作默认授权。**

用户：就上段大格，下面带斜边的那个。

AI：好，用这次候选里对应的 hero-top-skew。它会让开头的停步先占据注意力，再看细微反应。

## 落成页文件并给预览

AI 内部先创建空页，再补四个具有 id、order 和占位 shape 的 Panel 对象，之后写回所选几何。画风用用户刚才给的原文；当前新流程还会把它存到项目 style_prompt，补全 appearance_en 和每格 caption_en、figures，并把对白迁到独立 texts 以定位。下列旧格式文件保留用于兼容测试。

```shell
soda-storyboard page new --project my-story --id station-turn --style "clean 2D cel-shaded, crisp line art, screentone shading" --description "女孩在车站听见熟悉的声音，回头欲言又止。" --dialogue-mode moss_text --text-direction vertical --color-mode monochrome --json
soda-storyboard layout suggest --page my-story/pages/station-turn.json --pick hero-top-skew --json
soda-storyboard validate my-story/pages/station-turn.json --json
soda-storyboard preview my-story/pages/station-turn.json --output my-story/previews/station-turn.png --json
```

可复现的写回后页文件是 [station-page.before.json](assets/station-page.before.json)，角色卡为 [girl.json](assets/girl.json)；它们供测试和理解结构，实际操作别覆盖用户已有角色。

AI：【嵌入当前页线框 PNG。】现在是四格，第 2、3 格各放一句短台词，其余格不加话。对白保持短句，是为了减少 MOSS 写错字。你想改哪一格？

## 只改第 3 格

用户：第 3 格改成从背后看。

AI 内部按 order=3 找到 p3，只替换该格 description 为“从女孩背后低角度拍摄全身，列车驶过站台；她站在光影交界处，手指抓紧包带。”。保留 full 景别、low 角度、几何、台词、角色和其他三格。结果见 [station-page.after.json](assets/station-page.after.json)。

```shell
soda-storyboard validate my-story/pages/station-turn.json --json
soda-storyboard preview my-story/pages/station-turn.json --output my-story/previews/station-turn.v2.png --json
```

AI：【嵌入修改后的线框。】第 3 格已经改为背面，台词和其余格子保持原样。当前新流程会把对应 figure.facing 改为 back，并在带火柴人的草稿中显示背面；遗留文件只改 description 用于验证旧格式。真实成图的姿态仍要复查。整页还有想调整的吗？

**【停下来等用户确认 ③】未收到当前版本整页满意的确认，不 compile。**

用户：满意了，可以编译。

## 编译并交付

```shell
soda-storyboard validate my-story/pages/station-turn.json --json
soda-storyboard compile my-story/pages/station-turn.json --output my-story/output/station-turn.moss.json --slant-mode cut --json
```

AI：布局 JSON 已准备好，文件是 my-story/output/station-turn.moss.json（实际回复给可点击的绝对路径）。把它粘进 Soda-MOSS v2 的“JSON直通”框，工作流尺寸设为本页的 1024×1536。带斜边的格子先按矩形生成，之后用同目录 station-turn.moss.cut.json 裁剪；裁剪自动化留在第 3 阶段，现在还没有替你出图或裁图。

这页只有澪使用人物 LoRA，没有同时加载多个人物 LoRA 的问题。若以后加另一个带 LoRA 的角色，要一次只用一个，其他人的格子单独处理；两人同格的局部重绘接缝目前还没解决。
