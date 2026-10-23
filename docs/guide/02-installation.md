# 2. 安装

如果准备和 AI 一起做分镜，从下面的命令行工具开始装，然后在 Codex 或 Claude Code 中启用插件。核心库需要 Python 3.12 或更新版本，安装包里已经带着网页编辑器，无需另装 Node。

如果手里已有分镜包，只想在 ComfyUI 出图，可以直接看本章的 [节点包安装](#安装-comfyui-节点包) 和模型准备部分。用 CLI 直接出图则可以走默认的 minimal 后端，它使用 ComfyUI 核心节点，不需要额外装这个导入节点包。

![安装完成后可打开的编辑器](images/stretch-color-editor.png)

图：核心库自带的网页编辑器。只编辑分镜时，不需要启动 ComfyUI。

## 安装命令行工具

核心库发布在 [PyPI](https://pypi.org/project/soda-storyboard/)。安装 [uv](https://docs.astral.sh/uv/) 后，在终端运行下面两条命令：第一条安装，第二条查看命令行帮助。

```powershell
uv tool install soda-storyboard
soda-storyboard --help
```

这样装的是 PyPI 上的最新版本。升级到新版本用 `uv tool upgrade soda-storyboard`；需要固定版本时写成 `uv tool install soda-storyboard==0.4.4`。每个版本的安装包也附在 [GitHub Releases](https://github.com/cOkieeman/soda-storyboard/releases) 里。

想试用仓库里尚未发布的新功能，可以在仓库根目录直接运行源码版本：

```powershell
uv run --no-sync soda-storyboard --help
```

这条源码入口和已发布的版本是两个可选入口；同一条命令不要混用两套环境。

如果 uv 找不到合适的 Python，可以在安装命令后加 `--python 3.12`。安装成功后若终端仍找不到 `soda-storyboard`，执行 `uv tool update-shell`，再关闭并重开终端；也可以直接运行安装器提示的工具目录中的可执行文件。

### 启动器文件在，但启动失败

如果 `soda-storyboard` 或安装器给出的可执行文件确实存在，却在解析参数前报：

```text
uv trampoline failed to canonicalize script path
```

先确认 uv 的工具环境里是否真的有这个包，不要只根据文件名判断：

```powershell
uv tool list
```

如果列表里没有 `soda-storyboard`，或条目指向已经失效的工具环境，强制重新安装：

```powershell
uv tool install --force soda-storyboard
```

安装后用两步确认版本和启动器都恢复：`uv tool list` 中 soda-storyboard 的版本应与 PyPI 上的最新版本一致，而 `soda-storyboard --help` 应返回子命令列表并以 0 退出。反馈问题时附上 `uv tool list` 显示的版本；不要把仍然报 trampoline 错误的空壳 exe 当成可用安装。

如果 `uv tool list` 本身因权限或 uv 缓存目录报错，先修复 uv 的工具目录权限，再重复上面的检查；这与“命令不存在”是两种不同的故障。

## 在 Codex 里启用插件

下载仓库 ZIP 或克隆仓库时，需要保留 `skill/` 里的隐藏清单目录。下面以 `~/tools/soda-storyboard` 为例，使用时换成仓库在你电脑上的实际路径。

```powershell
codex plugin marketplace add "~/tools/soda-storyboard/skill"
codex plugin add soda-storyboard@soda-storyboard-local
codex plugin list
```

如果宿主没有展开 `~`，参数里需要填写完整路径。安装后重启 Codex，在插件目录中确认 Soda Storyboard 已启用，然后开一个新聊天。输入 `@` 可以选择插件技能；CLI / IDE 的入口可能是 `/skills` 或 `$soda-storyboard`，以当前界面显示为准。

也可以从插件目录安装，两种入口选一个即可。插件列表显示已安装、已启用后，还需要在新聊天里选到并调用一次技能，确认当前会话已经加载它。

## 在 Claude Code 里启用插件

临时使用可以直接指定插件目录：

```powershell
claude --plugin-dir "~/tools/soda-storyboard/skill"
```

进入会话后输入 `/soda-storyboard:soda-storyboard`。如果希望在这个故事项目里持续使用插件，可以在项目目录中安装：

```powershell
claude plugin marketplace add "~/tools/soda-storyboard/skill"
claude plugin install soda-storyboard@soda-storyboard-local --scope local
```

安装后重新开会话，或执行 `/reload-plugins`。Python 工具和宿主插件需要分别安装：Python 工具提供实际执行的命令，插件则让 AI 知道怎样使用这些命令，与你一起完成分镜。

## 安装 ComfyUI 节点包

把 [ComfyUI-Soda-Storyboard](https://github.com/cOkieeman/ComfyUI-Soda-Storyboard) 放进 ComfyUI 的 `custom_nodes/ComfyUI-Soda-Storyboard/`。如果用的是便携版，在 `ComfyUI_windows_portable` 根目录运行下面的命令，用它自带的 Python 安装核心库（用 ComfyUI Manager 安装节点时会自动安装，可以跳过这一步）：

```powershell
.\python_embeded\python.exe -m pip install --upgrade soda-storyboard
.\python_embeded\python.exe -c "from importlib.metadata import version; print(version('soda-storyboard'))"
```

`python_embeded` 是便携版实际使用的目录名。普通安装则用运行 ComfyUI 的那个 Python 执行 `-m pip install`。两种方式安装后都需要重启 ComfyUI。

从 PyPI 安装的是预先打好的 wheel，已经包含网页资源和运行时数据，便携版无需现场构建。不要从 Git 源码安装：那需要构建后端，嵌入式 Python 环境未必具备这些条件。包也必须装进便携版自己的 Python，装到系统 Python 后，便携版仍可能找不到。

## 准备模型并检查

出图还需要 MOSS 模型和相应的加载节点。SFT 和 Base 是两个可选底模，做第一页时选其中一个即可。

| 文件 | 放在 ComfyUI 的模型目录 | 选择位置 |
| --- | --- | --- |
| MOSS-Image SFT 或 Base 权重 | `models/diffusion_models/`，可放子目录 | 工作流中的原生模型 Loader |
| `qwen3.5_9b_w4a8_gptq.safetensors` | `models/text_encoders/` | 文本编码器 Loader，类型与 MOSS 对应 |
| `flux2-vae.safetensors` | `models/vae/` | VAE Loader |
| 可选角色 LoRA | `models/loras/` | 原生 LoRA Loader，按本机列表选择 |

节点和模型的具体要求以 [节点仓库安装说明](https://github.com/cOkieeman/ComfyUI-Soda-Storyboard#安装) 及对应 MOSS 工作流为准。你可以按自己的目录调整文件名，CLI 配置中也要相应填写 ComfyUI 列表里的相对文件名。

建立故事项目后，可以用下面的命令配置并检查 CLI 与 ComfyUI 的连接：

```powershell
soda-storyboard comfy config --project examples/stretch-color --url http://127.0.0.1:8190 --model sft --preset draft --backend minimal --json
soda-storyboard comfy check --project examples/stretch-color --json
```

这两条命令从仓库根目录运行；使用自己的项目时替换项目路径。端口需要换成你的 ComfyUI 实际地址，模型放在子目录时还要按下拉列表填写 `--sft`、`--clip`、`--vae`。检查只读取节点和模型列表；导入节点负责读取分镜包，出图工作流所需的模型节点也要另外备齐。教程中的彩色成图使用配套节点工作流的 50 步与 SLG 参数，CLI 的 draft 预设用于另行试画。

[下一章：从这张彩色漫画开始](03-first-page.md) · [返回目录](README.md)
