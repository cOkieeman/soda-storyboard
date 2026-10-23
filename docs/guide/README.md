# soda-storyboard 使用说明

这套说明以彩色漫画「起身舒展」为例，带你从分镜做到成图：25 岁原创女主绯音结束工作，站起舒展身体，再邀请门边的同伴喝点东西。你会和 AI 商量镜头，在网页里调整动作与台词，最后把分镜包交给 ComfyUI 出图和排字。

![起身舒展：彩色分镜成图](images/stretch-color-finished.png)

本例为 1024×1536、五格右至左阅读，第三格用竖向全身画面突出舒展动作。黑长发、红紫眼和酒红礼服写在角色卡中，**纯提示词出图，无参考图输入、无角色 LoRA**；三句中文台词由程序后期排字。

完整材料在 [examples/stretch-color](../../examples/stretch-color/)：可以打开已有项目学习，也可以直接使用 [分镜包](../../examples/stretch-color/exports/stretch-color.storyboard.json) 和 [工作流](../../examples/stretch-color/workflows/stretch-color.workflow.json)，按第 8 章导入 ComfyUI。工作流打开后仍需上传分镜包、重新选择本机模型。

![起身舒展的草稿与生成阶段](images/stretch-color-process.jpg)

第一次使用插件，建议按第 1～3 章安装并打开已有示例，再讨论和编辑草稿。已经装好工具、想用这个案例出一张图，可以直接看第 8 章或配套的 [节点教程](https://github.com/cOkieeman/ComfyUI-Soda-Storyboard/blob/main/docs/tutorial-stretch-color.md)。

| 章节 | 你会用到的内容 |
| --- | --- |
| [1. 这是什么](01-overview.md) | 了解插件、核心库、编辑器与 ComfyUI 节点的关系 |
| [2. 安装](02-installation.md) | wheel、Codex / Claude Code 插件、便携版 ComfyUI、模型和连接检查 |
| [3. 从这张彩色漫画开始](03-first-page.md) | 先看「起身舒展」示例；也可按“**两句话、两格、从空目录开始**”主线完成角色、格子、译文与分镜包 |
| [4. 角色卡怎么写](04-characters.md) | 写清人物外观和服装，共用角色设定，了解可选 LoRA |
| [5. 网页编辑器](05-editor.md) | 格子、人物、关节、台词、最终提示词、保存与同步 |
| [6. 提示词是怎么来的](06-prompts.md) | 中文场景怎样编译成 MOSS JSON；译文状态和术语表 |
| [7. 出图和后期](07-generation.md) | 可选 CLI 出图、种子、细节修复、出框图层、拼页和排字 |
| [8. 在 ComfyUI 里用](08-comfyui.md) | 导入本例分镜包与工作流，看预览、选模型、运行和排字 |
| [9. 导入别人的分镜](09-import.md) | MOSS JSON、单画布、颜色分镜图和其他 AI 的输出 |
| [10. 常见问题与已知限制](10-troubleshooting.md) | 串衣服、人物太小、关节偏差、连接、端口和字体问题 |
| [11. 命令速查](11-cli-reference.md) | 按工作顺序查命令和常用参数 |

展示的成图由配套节点工作流运行：Quality 50 步、CFG 3、euler / simple、SLG 单层 22、种子 20261022。本机一次运行约 102.5 秒，耗时和结果会受硬件及模型版本影响。CLI 也提供 `draft` / `final` 候选生成，`final` 的基础采样参数与这里相同，任务登记和后处理按各自流程管理。

本例的五格成图使用正式发布的 **soda-storyboard 0.4.1** 验证；安装说明提供当前已发布版本的 wheel，版本以该章链接及 Releases 为准。后续源码变化见 [更新记录](../../CHANGELOG.md)。

如果用别的 AI 写分镜，可以把 [格式说明](../for-other-ai.md) 发给它。准备接入自己的程序时，再查 [共享 API](../bundle-api.md) 和 [页面 schema](../../schema/storyboard-v1.schema.json)；修改源码的步骤放在 [开发说明](../development.md)。
