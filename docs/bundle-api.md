# 分镜包共享 API（0.4.x）

`bundle` 负责单文件交换；不访问网络，不读取 LoRA 或参考图片，不提交生成任务。包内的项目、页面和角色卡保留扩展字段以及 `caption_auto_en`；文件信息经过便携化，参考图只留文件名。草稿仅由本地 Pillow 从分镜数据绘制。

## 读取

```python
from soda_storyboard.bundle import load_bundle

page, characters, project_settings, warnings = load_bundle(path_or_dict)
```

输入为 JSON 文件路径（str / Path）或已解析 dict。返回四元组：`Page`、`dict[str, Character]`、项目设置 dict、警告字符串 list。项目提供画布、阅读方向、文字和颜色模式、画风、标签及 `caption_language` 默认值，页面显式值优先；未设置语言时默认英文，新鲜译文用于出图，缺失或过期仍按 F5 回退中文。输入不被修改。

兼容裸分镜页 JSON。无角色卡时给出警告，仍可使用页面已有画面描述；未知角色外观与 LoRA 不会被虚构。结构或几何错误用 ValueError / TypeError 拒绝。警告用于展示，不应按整句中文做程序分支。

## 编译

```python
from soda_storyboard.bundle import compile_bundle

result = compile_bundle(path_or_dict, dialogue_mode=None, slant_mode="cut", include_triggers=True)
```

返回 dict 的稳定键：`moss`（MOSS dict）、`width` / `height`（int）、`lora`（建议项或 None）、`warnings`（list[str]）。建议项包含 `character_id`、`filename` 和 `strength`，只提供模型文件名，不提供机器路径，也不加载模型。

`dialogue_mode=None` 遵循页/项目设置，可显式用 `moss_text` 或 `lettering`；`slant_mode` 为 cut / hint / rect。默认包含触发词，`include_triggers=False` 用于不想自动注入角色触发词的调用方；台词原文始终保留。输出复用同一套 `compile_page`，不会调用旧节点的重复 caption_en 追加逻辑。调用方需要 JSON 字符串时自行 `json.dumps(result["moss"], ensure_ascii=False)`。

## 导出与节点契约

CLI：`soda-storyboard export-bundle <页> [--output <路径>] [--no-sketch] [--json]`。默认路径为项目 exports/<页id>.storyboard.json；错误校验拒绝写入，译文警告提示 translate --todo。

顶层格式固定为 `soda-storyboard-bundle-v1`，含 exported_at、generator、project、page、characters；sketch_png_base64 可省略。出场角色包含格子人物、人物图层和说话人引用，未引用的项目角色不打包。PNG 长边 768，最多 2 MiB / 400 万像素；整个 UTF-8 JSON 最多 16 MiB，与现有节点读取上限一致。图像、模型和外部附件不嵌入，只有这张草稿缩略图可以嵌入。

节点后续接入时可以保留上传和界面逻辑，将文件读取与编译改用 `load_bundle` / `compile_bundle`；现有节点的 `parse_bundle` 已能读取本格式，不应再对手动 caption_en 额外追加人物外观。安装核心 wheel 0.4.0 后，节点才能使用这些新接口。

## 公开分析 API 与稳定性

- `soda_storyboard.canvas_sizes.CANVAS_PRESETS` 和 `infer_dimensions(value) -> (width, height)`：共享的 MOSS 尺寸表和纵横比吸附规则。
- `soda_storyboard.importers.import_moss(raw, *, default_color_mode="monochrome") -> (Page, report)`：识别格子、文字、物件/人物框和单画布，保留原 MOSS 条目及未知字段。
- `import_storyboard(source, *, page_id=None, default_color_mode="monochrome") -> (Page, report)`：补充宽松 JSON / Markdown。report 的公开键包括 guesses、warnings、unrecognized_items、canvas、panel_count；MOSS 报告还含 text_count、object_count、preserved_items。单画布由 page.extra["canvas_mode"] == "single" 表示（序列化为顶层 canvas_mode）。

上述名称列入各模块及包根 `__all__`。0.4.x 保持已有参数、返回类型、包格式标记和必需键兼容；可增加可选字段和警告。理解报告的推断结果会随修复改善，不保证每个启发式结果或警告措辞永远不变；应按格式标记和结构字段消费，不按中文文案解析。破坏式格式变化需新标记或主版本迁移说明；内部下划线函数不属于稳定接口。
