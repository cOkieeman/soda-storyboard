# 示例：Soda-MOSS v2 API 工作流

`soda-moss-v2-json-api.json`：Soda-MOSS v2 在「JSON直通」模式下导出的 ComfyUI API 格式（98 个节点）。需要作者 ComfyUI 里安装的同一批自定义节点，主要作为 `comfy config --backend v2` 的格式参考。
状态：质量档（Turbo 关，50 步 / Euler / CFG3 / SLG22），SFT INT8，1024×1536，高清二采关，后处理只开 C（SeedVR2 4K）。

## 程序要改的节点

| 用途 | 节点 | 字段 | 说明 |
|---|---|---|---|
| MOSS 布局 JSON | `620` | `inputs.string` | 整份 JSON 字符串（`json.dumps(..., ensure_ascii=False)`） |
| 画布尺寸 | `150` | `inputs.resolution_json` | 字符串 `{"version":1,"width":W,"height":H}`，必须与布局 JSON 的画布一致 |
| 种子 | `84` | `inputs.seed` | 导出值是 -1（前端随机），**API 提交时必须换成具体整数** |
| 负面提示词 | `75` | `inputs.string` | |
| 存图 | `81` | `inputs.filename`、`inputs.path` | 输出在 ComfyUI `output/<path>/` 下，结果从 `/history` 的 `outputs["81"]` 读取 |
| 主模型 | `135:111` | `inputs.unet_name` | |
| 步数 / CFG / 采样器 | `135:105` / `135:102` / `135:513` | `int` / `float` / `sampler_name` | 快速档可改为 25 / 2.5 / `er_sde`，同时把 SLG 节点 `135:610` 从链路上拿掉（把 `77.inputs.model` 改接 `["135:516", 0]`） |

## 人物 LoRA

LoRA Manager 的堆叠节点（`301`/`302`/`303`/`77`）在 API 里的 `loras` 字段格式不稳定，不建议程序去填。
建议程序新增一个 `LoraLoaderModelOnly` 节点（自定义 id，例如 `sb_lora_1`）：输入接 `["135:610", 0]`，再把 `77.inputs.model` 改接到它。
**一次只加载一个人物 LoRA**（实测两个人物 LoRA 同时加载会互相吞掉）。

## 关掉 C（SeedVR2 超分）

草稿出图不需要 4K。做法：删掉 `152:227`、`152:228`、`152:229`、`152:340`、`152:341`、`152:760`；
把 `152:225.inputs` 改成只有 `any_02`，`152:343.inputs` 改成只有 `any_02`。删完要检查没有节点再引用已删除的 id。

## 单格重画（图生图）

不用 v2，直接用最小节点图，即 `soda_storyboard.production.graphs` 里的 i2i 图：
`UNETLoader → (LoraLoaderModelOnly) → ModelSamplingAuraFlow(shift 5)`，`CLIPLoader(type=moss_image)`，`VAELoader(flux2-vae)`，
`LoadImage → ImageScale → VAEEncode → KSampler(denoise 0.45) → VAEDecode → SaveImage`。
图片先用 `POST /upload/image`（multipart，字段 `image`）上传。局部重绘再加 `SetLatentNoiseMask`（遮罩取 `LoadImage` 的 alpha），见同一模块的 inpaint 图。
