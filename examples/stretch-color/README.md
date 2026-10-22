# 起身舒展：插件与节点共用的彩色示例

![彩色五格漫画](../../docs/guide/images/stretch-color-finished.png)

跟随[插件教程](../../docs/guide/03-first-page.md)，可以从这份现成分镜开始练习：和插件讨论修改，打开网页编辑器调整人物与台词，确认后补译并导出，再到 ComfyUI 运行。[节点教程](../../docs/guide/08-comfyui.md)讲解文件交接与出图。

| 文件 | 用途 |
| --- | --- |
| [project.json](project.json) | 彩色画风、右至左阅读、程序排字等默认设置 |
| [pages/stretch-color.json](pages/stretch-color.json) | 五格构图、人物与独立文字框 |
| [characters/hiyone.json](characters/hiyone.json) | 25 岁原创女主绯音的中英文外观与服装 |
| [translations.json](translations.json) | 英文场景译文与来源哈希 |
| [exports/stretch-color.storyboard.json](exports/stretch-color.storyboard.json) | 上传给 ComfyUI“导入分镜”的单文件分镜包 |
| [workflows/stretch-color.workflow.json](workflows/stretch-color.workflow.json) | 在 ComfyUI 打开的配套工作流 |
| [output/stretch-color.moss.json](output/stretch-color.moss.json) | 生成时使用的布局与提示词 |
| [output/character-prompt.txt](output/character-prompt.txt) | 完整的角色英文提示词 |

本例使用已发布的核心库 0.4.1 验证，纯文字提示词，无图片条件输入和角色 LoRA。节点出图参数为 1024×1536、50 步、CFG 3、Euler / simple、SLG 单层 22、种子 20261022；VAE 解码后程序排字，再保存图像。该页全为矩形，不接斜切裁剪。

复制此目录作为自己的故事项目后，用 `edit` 打开已有页面，无需再次 `init` 或 `page new`。修改场景后先补译，再重新导出并上传分镜包。模型名称、ComfyUI 地址和字体应按本机环境选择；项目中的 `final` 是 CLI 预设，实际示例图以配套节点工作流的参数为准。

与[节点仓库同名示例](https://github.com/cOkieeman/ComfyUI-Soda-Storyboard/tree/main/examples/stretch-color)共用人物、页面、编译结果和成图。两边只按仓库结构分别放置分镜包和工作流。
