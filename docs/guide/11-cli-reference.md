# 11. 命令速查

需要自己敲命令时，可以按下面的分组查。表里省略了共同前缀 `soda-storyboard`，完整参数以本机 `soda-storyboard <子命令> --help` 为准。有些命令接页文件路径，有些接项目目录和页 id，使用时按各行的形式填写。本轮逐一运行了 29 条命令路径的 `--help`，另加 F10 新增的 `register-render`，共 30 次，返回码全部为 0；下面补齐了帮助里实际出现、原表遗漏的参数。

![草稿和成品](images/stretch-color-process.jpg)

「起身舒展」的本地草稿与彩色排字成图。本文命令中的 `my-project` 表示自己复制的故事目录，页 id 沿用 `stretch-color`；新建命令只用于尚不存在的项目、角色或页面。配套图使用节点工作流生成，CLI 自动出图是另一条可选路线。

## 项目、角色和页面

| 命令 | 用途与常用参数 |
| --- | --- |
| `init my-project` | 建项目；`--name`、`--width 1024 --height 1536`、`--direction rtl` |
| `character new --project my-project --id hiyone` | 新建角色；`--name`、`--trigger`、`--appearance-zh`、`--appearance-en`、`--role-en`、`--outfit`、`--reference`、`--output`；可选 `--lora`、`--lora-strength` |
| `character set hiyone --project my-project` | 只改给出的字段；`--name`、`--trigger`、`--appearance-zh`、`--appearance-en`、`--role-en`、`--lora`、`--lora-strength`；`--outfit`、`--reference` 可重复，传入时替换整项列表 |
| `character list --project my-project` | 列角色卡 |
| `page new --project my-project --id stretch-color` | 建空页；`--output`、`--width`、`--height`、`--direction`、`--style`、`--description`、`--dialogue-mode moss_text/lettering`、`--color-mode color/monochrome`、`--text-direction vertical/horizontal` |
| `page skew my-project/pages/stretch-color.json --panels p1,p2 --angle 8` | 倾斜相邻完整行 / 列的矩形分割线；`--axis auto/vertical/horizontal`，写回页面 |

`page new` 不会自动添加格子。插件或网页需要继续填 `panels` 和连续 `order`。画布宽高为 16 的倍数；`page skew` 角度必须严格在 -45°～45° 内，非法几何会拒绝保存。

## 版式、校验和编辑

| 命令 | 用途与常用参数 |
| --- | --- |
| `template list` | 列模板；`--panels 5` 按格数筛选 |
| `layout suggest --panels 5` | 候选版式；`--width`、`--height`、`--templates`、`--candidates 6`、`--importance "1,1,3,1,1"`、`--direction rtl`、`--preview-dir`、`--output`、`--write-page`；`--gap` 调格间距，`--skew 0` 只看矩形 |
| `layout suggest --page <页文件> --pick <真实模板id>` | 把选中版式写回已有格子的页；预览候选时不要传 `--page` |
| `layout extract <参考图>` | 提取框位；`--mode auto/color/standard`、`--preview`、`--direction`；保存模板用 `--save --name --project`，颜色保存问题见排错章 |
| `validate <页文件>` | 检查几何、角色与文字；`--max-dialogue-chars 20`、`--geometry-tolerance 0.5` |
| `preview <页文件>` | 本地草稿；`--output`、`--style sketch/boxes`、`--scale`、`--font` |
| `edit my-project` | 打开网页；`--detach`、`--page stretch-color`、`--no-browser`、`--port 8780`；`--stop` 停服务 |

模板 id 使用这次候选返回的值，不同格数的模板不能直接套用。查看候选时只传格数即可；`layout suggest --page` 是写回操作，未给 `--pick` 时也可能采用默认项，所以要在选好版式后使用。

## 翻译、编译和交接

| 命令 | 用途与常用参数 |
| --- | --- |
| `translate <页文件> --todo` | 列出需由 AI 翻译的场景、动作与道具 |
| `translate <页文件> --apply <译文文件>` | 按来源哈希校验并写回译文 |
| `compile <页文件>` | 生成 MOSS JSON；`--output`、`--slant-mode cut/hint/rect`、`--size-check 1024x1536`；调试才用 `--with-ids` |
| `export-bundle <页文件>` | 导出单文件分镜包；`--output`、`--no-sketch` |
| `import <外来文件>` | 只读理解报告；加 `--project my-project --page-id imported` 保存；支持 MOSS / 宽松 JSON / Markdown |

`cut` 默认生成矩形采样布局并为斜格写裁剪文件；`hint` 用内接矩形提示斜线；`rect` 用外接矩形供调试，可能重叠。没有斜格就不会有 cut 文件。

## ComfyUI 和生成

`comfy config` 读写本地设置，`pick` 和 `plan` 也只操作本地项目。`comfy check` 读取服务信息；`gen page` 会向 ComfyUI 提交采样任务。

| 命令 | 用途与常用参数 |
| --- | --- |
| `comfy config --project my-project` | 查看 / 改配置；`--url`、`--model`、`--workflow`、`--preset`、`--backend`、`--sft`、`--base`、`--clip`、`--vae`、`--timeout`、`--poll-interval`、`--cut-inset`、`--border-width` |
| `comfy config --project my-project --backend v2 --workflow <API工作流>` | 可选 v2 后端；默认 minimal 不需要该文件，不能拿前端画布 JSON 代替 API JSON |
| `comfy check --project my-project` | 读取当前后端所需节点和模型列表；实际采样还需要运行生成命令 |
| `gen page stretch-color --project my-project` | 整页候选；`--seeds 4` 或重复 `--seed`；`--preset draft/final`、`--model base/sft/<文件名>`、`--lora auto/none/<角色id>` |
| `pick stretch-color <候选路径> --project my-project` | 选已登记的整页候选 |
| `plan stretch-color --project my-project` | 看后期计划，可在选图前查看 |

生产命令里的 `stretch-color` 也可以换成页 JSON 路径。需要让 AI 或脚本处理结果时，加 `--json` 即可取得机器可读输出。

## 后期和导出

`register-render` 是 0.4.2 新增的命令。

| 命令 | 用途与常用参数 |
| --- | --- |
| `register-render stretch-color <图片>` | 登记外部生成的整页、单格或 layer 候选；`--project`、`--select`、`--seed`、`--source`、`--preset`、`--model`；`--panel` 与 `--overlay` 互斥，图片会复制到项目生产目录 |
| `split stretch-color --project my-project` | 按框切格，保存四边形遮罩 |
| `redraw stretch-color p3 --project my-project --mode detail` | 重画一格修细节；`--character` 可指定 swap 角色，`--denoise 0.45`、`--seed`；swap 为高级选项 |
| `inpaint stretch-color p3 --project my-project --character hiyone` | 局部重绘；先加 `--mask-only` 看遮罩，再考虑生成；`--denoise`、`--margin 24`、`--feather 16`、`--seed` |
| `pick-panel stretch-color p3 <候选路径> --project my-project` | 选该格已登记的重画候选 |
| `cutout stretch-color hero --project my-project` | 为 layer 图层生成透明图；`--seed`；加 `--png <透明图>` 则离线导入 |
| `compose stretch-color --project my-project` | 拼页、裁斜格、叠图层；`--cut-inset 12`、`--border-width 3` |
| `letter stretch-color --project my-project` | 程序排字；`--font <字体>`，`--text <文字id>` 可重复 |
| `export stretch-color --project my-project --format png` | 导出当前页 PNG；目标换项目目录并用 `--format pdf` 导出整本 |

## 文件通常放哪里

```text
my-project/
  project.json
  characters/
  pages/stretch-color.json
  pages/stretch-color/renders/
  pages/stretch-color/panels/
  previews/
  exports/
  logs/
```

以每次命令返回的实际路径为准，尤其是带时间和种子的图片。stdout 编译的附属文件会放进该页生产子目录；指定 `--output` 时，cut / map 跟在输出 JSON 旁。

需要编程接口可看 [分镜包 API](../bundle-api.md)，要修改核心库看 [开发说明](../development.md)。

[返回目录](README.md)
