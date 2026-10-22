# soda-storyboard 使用说明

这套说明从“天台上的猫胡子”这个小故事开始，带你做完一页漫画。你会和 AI 商量怎么拆格，在网页里调整人物与台词，然后用 ComfyUI 出图、排字和导出。

![从草稿到成品](images/workflow-triptych.jpg)

天台页的草稿、整页出图和排字成品。生成图来自 draft 档实测，三阶段取自不同轮次。

刚接触 soda-storyboard，可以从第 1～3 章读起。手里已经有分镜包，直接去 ComfyUI 出图就好，从第 8 章开始。

| 章节 | 你会用到的内容 |
| --- | --- |
| [1. 这是什么](01-overview.md) | 了解几个部分的关系，决定从哪里开始 |
| [2. 安装](02-installation.md) | wheel、Codex / Claude Code 插件、便携版 ComfyUI、模型和连接检查 |
| [3. 十分钟做出第一页](03-first-page.md) | 跟着一个小故事，从拆格做到导出 |
| [4. 角色卡怎么写](04-characters.md) | 写清人物外观，减少串衣服，选择本页 LoRA |
| [5. 网页编辑器](05-editor.md) | 格子、人物、关节、台词、最终提示词、保存与同步 |
| [6. 提示词是怎么来的](06-prompts.md) | 中文内容怎样编译成 MOSS JSON；译文状态和术语表 |
| [7. 出图和后期](07-generation.md) | draft / final、种子、细节修复、出框图层、拼页和排字 |
| [8. 在 ComfyUI 里用](08-comfyui.md) | 导入分镜包、看预览、选工作流、在原生 Loader 选 LoRA |
| [9. 导入别人的分镜](09-import.md) | MOSS JSON、单画布、颜色分镜图和其他 AI 的输出 |
| [10. 常见问题与已知限制](10-troubleshooting.md) | 串衣服、人物太小、关节偏差、连接、端口和字体问题 |
| [11. 命令速查](11-cli-reference.md) | 按工作顺序查命令和常用参数 |

说明基于当前仓库的 0.4.1 待发布代码。安装页的下载地址仍是已发布的 0.4.0；本页 LoRA 选择、服装提醒和新版场景译文等功能，需要等包含它们的版本发布后升级，差异见 [更新记录](../../CHANGELOG.md)。

如果用别的 AI 写分镜，可以把 [格式说明](../for-other-ai.md) 发给它。准备接入自己的程序时，再查 [共享 API](../bundle-api.md) 和 [页面 schema](../../schema/storyboard-v1.schema.json)；修改源码的步骤放在 [开发说明](../development.md)。
