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

项目 `lora_policy` 为 `single`（默认）或 `none`；`none` 下 `lora` 返回 None。页面 `lora_character` 为角色 id 或 `none`，省略时按有 LoRA 角色出场格子的实际面积加权选择，同权重按 id；没有可用 LoRA 时返回 None。角色卡的 `lora` 明确可省略。其他角色始终按角色卡描述出图，`warnings` 字符串列表包含信息说明“本页 LoRA：Sylvia（0.8）；鲸鱼娘按角色描述出图”或“本页不使用 LoRA”，不再报告多 LoRA 角色风险；CLI validate 将这类说明放在 info / infos，warnings 保留实际提醒。

`dialogue_mode=None` 遵循页/项目设置，可显式用 `moss_text` 或 `lettering`；`slant_mode` 为 cut / hint / rect。默认包含触发词，`include_triggers=False` 用于不想自动注入角色触发词的调用方；台词原文始终保留。输出复用同一套 `compile_page`，不会调用旧节点的重复 caption_en 追加逻辑。调用方需要 JSON 字符串时自行 `json.dumps(result["moss"], ensure_ascii=False)`。

自动 caption 由程序按“方位 → 景别、角度 → 名字 + 角色卡 appearance.en + 姿势 → 场景译文”组装，同一角色在各格使用相同外观。多人同格分别说明服装并追加区分句。译文 `source_hash` 只覆盖需翻译的中文场景、动作、道具，角色外观改变不会过期；旧含外观整句缓存标为需要重新翻译，使用 `translate --todo/--apply` 迁移，迁移前仍允许中文后备。

`translate --apply` 自动设置 `caption_auto_en.format: "scene-v1"`。缺少标记的旧缓存为 `legacy`，不静默沿用。离线 A/B 脚本建议传 `--translations` 场景译文；其保留的 `--english-page` 若携带旧整句缓存，也会提示迁移并回退中文。

## 导出与节点契约

CLI：`soda-storyboard export-bundle <页> [--output <路径>] [--no-sketch] [--json]`。默认路径为项目 exports/<页id>.storyboard.json；错误校验拒绝写入，译文警告提示 translate --todo。

顶层格式固定为 `soda-storyboard-bundle-v1`，含 exported_at、generator、project、page、characters；sketch_png_base64 可省略。出场角色包含格子人物、人物图层和说话人引用，未引用的项目角色不打包。PNG 长边 768，最多 2 MiB / 400 万像素；整个 UTF-8 JSON 最多 16 MiB，与现有节点读取上限一致。图像、模型和外部附件不嵌入，只有这张草稿缩略图可以嵌入。

节点后续接入时可以保留上传和界面逻辑，将文件读取与编译改用 `load_bundle` / `compile_bundle`；现有节点的 `parse_bundle` 已能读取本格式，不应再对手动 caption_en 额外追加人物外观。安装核心 wheel 0.4.0 后，节点才能使用这些新接口。

## 公开分析 API 与稳定性

- `soda_storyboard.canvas_sizes.CANVAS_PRESETS` 和 `infer_dimensions(value) -> (width, height)`：共享的 MOSS 尺寸表和纵横比吸附规则。
- `soda_storyboard.importers.import_moss(raw, *, default_color_mode="monochrome") -> (Page, report)`：识别格子、文字、物件/人物框和单画布，保留原 MOSS 条目及未知字段。
- `import_storyboard(source, *, page_id=None, default_color_mode="monochrome") -> (Page, report)`：补充宽松 JSON / Markdown。report 的公开键包括 guesses、warnings、unrecognized_items、canvas、panel_count；MOSS 报告还含 text_count、object_count、preserved_items。单画布由 page.extra["canvas_mode"] == "single" 表示（序列化为顶层 canvas_mode）。

上述名称列入各模块及包根 `__all__`。0.4.x 保持已有参数、返回类型、包格式标记和必需键兼容；可增加可选字段和警告。理解报告的推断结果会随修复改善，不保证每个启发式结果或警告措辞永远不变；应按格式标记和结构字段消费，不按中文文案解析。破坏式格式变化需新标记或主版本迁移说明；内部下划线函数不属于稳定接口。

## 登记外部生成图片（0.4.2）

Hub Worker 等调用方自行完成出图后，可通过生产 API 登记本地图片；接口不连接 ComfyUI，也不提交生成任务。

```python
from pathlib import Path


def register_render(
    project_dir: str | Path,
    page_id: str,
    image_path: str | Path,
    *,
    seed: int | None = None,
    preset: str | None = None,
    model: str | None = None,
    source: str = "external",
    select: bool = False,
    panel_id: str | None = None,
    overlay_id: str | None = None,
    meta: dict | None = None,
) -> dict: ...
```

以上为类型签名。`image_path` 可以是项目外的绝对路径；相对路径以项目目录为基准。接口验证图片可完整解码，复制到 `pages/<页id>/` 下唯一命名的生产文件，项目内输入也会复制，以保留独立候选。目标路径复用生产路径边界检查，拒绝通过符号链接越出项目。保留原图片字节、尺寸和透明通道，不自动缩放。

省略 `panel_id` 和 `overlay_id` 时，候选追加到页面 `production.renders`；`select=True` 同时设置 `selected_render`，清除旧底图的单格选中记录及过期 compose/letter 记录。`panel_id` 与 `overlay_id` 互斥：单格候选写入该格的 `production.renders`，绑定当前已选整页底图（因此必须先选底图），`select=True` 设置该格 `selected`；图层必须是已有的 `mode: "layer"`，候选写入页面 `production.overlays[id].renders`，`select=True` 同时更新该图层的生效记录。未选中的图层候选不会自动叠加。

返回记录为 `{"path": "绝对路径", "seed": 123或null, "source": "hub-worker", "meta": {...}}`；单格记录还含项目内相对路径 `source_render`。磁盘记录的文件路径始终为项目内相对路径。`meta` 保留自定义 JSON 元数据，显式 `preset` / `model` 覆盖同名键，`created_at` 由接口填写；种子省略时记录 null，不虚构随机种子。外部预设和模型名按元数据保存，无需匹配本地 ComfyUI 配置。

```python
from soda_storyboard.production.api import register_render

record = register_render(
    r"E:\stories\chapter1",
    "page01",
    r"E:\worker-output\page01.png",
    seed=123,
    preset="final",
    model="worker-model.safetensors",
    source="hub-worker",
    select=True,
    meta={"job_id": "job-42"},
)
# select=False 时，也可稍后 pick_render(project_dir, "page01", record["path"])
# 单格：register_render(project_dir, "page01", panel_png, panel_id="p1", select=True)
# 图层：register_render(project_dir, "page01", rgba_png, overlay_id="hero", select=True)
```

```powershell
soda-storyboard register-render page01 E:\worker-output\page01.png --project E:\stories\chapter1 --select --seed 123 --source hub-worker --preset final --model worker-model.safetensors --json
# 单格、图层分别加 --panel p1 或 --overlay hero；二者互斥。
```

登记与选中通过共享文件锁、production 字段合并及版本检查一次写回，保留登记期间保存的页面正文和其他候选。互相冲突的选中操作会抛出 `ProductionError`，不覆盖并发编辑；已复制图片保留在生产目录，调用方重新读取后可重试。无效图片、目标 id、种子或越界目标也以 `ProductionError` 拒绝。整页候选可继续使用 `pick_render` / CLI `pick`，单格候选可使用 `pick_panel` / `pick-panel`，已选记录直接供 `compose_page` / `compose` 使用。
