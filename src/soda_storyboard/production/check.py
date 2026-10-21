# ruff: noqa: RUF001
# Chinese user-facing diagnostics intentionally use Chinese punctuation.
"""Read-only installation checks based on the server's actual node definitions."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from soda_storyboard.io import load_characters, read_json

from .client import ComfyClient
from .errors import ProductionError
from .graphs import minimal_graph, v2_graph
from .state import PageState, configure

type JSON = dict[str, Any]


def page_graph(state: PageState, prompt: str, **options: Any) -> JSON:  # noqa: ANN401 -- heterogeneous graph parameters
    if state.config["backend"] == "v2":
        workflow = state.config.get("workflow")
        if not workflow:
            msg = "v2 后端需要先用 comfy config --workflow 导入 API 工作流"
            raise ProductionError(msg)
        return v2_graph(read_json(state.local(workflow)), prompt, config=state.config, **options)
    return minimal_graph(prompt, config=state.config, **options)


def check(project_dir: str | Path) -> JSON:  # noqa: C901, PLR0912 -- read-only audit of nodes and model file lists
    config = configure(project_dir)
    client = ComfyClient(config["url"], timeout=config["timeout"])
    if config["backend"] == "v2":
        if not config.get("workflow"):
            msg = "v2 后端需要先用 comfy config --workflow 导入 API 工作流"
            raise ProductionError(msg)
        path = Path(config["workflow"])
        if not path.is_absolute():
            path = Path(project_dir) / path
        graph = v2_graph(read_json(path), "{}", config=config, preset=config["preset"])
    else:
        graph = minimal_graph("{}", config=config, preset=config["preset"], image="check.png", inpaint=True)
        graph["empty"] = {"class_type": "EmptyFlux2LatentImage", "inputs": {}}
    # Character LoRAs are checked without loading models or submitting a prompt.
    for character in load_characters(Path(project_dir) / "characters").values():
        if character.lora:
            graph["check_lora_" + character.id] = {
                "class_type": "LoraLoaderModelOnly",
                "inputs": {"lora_name": character.lora.path},
            }
    definitions = {}
    errors = []
    model_fields = {"unet_name", "clip_name", "vae_name", "lora_name"}
    for entry in graph.values():
        name = entry["class_type"]
        if name not in definitions:
            definitions[name] = client.object_info(name).get(name)
        definition = definitions[name]
        if definition is None:
            message = f"缺少 ComfyUI 节点：{name}"
            if message not in errors:
                errors.append(message)
            continue
        inputs = definition.get("input", {})
        specifications = {**inputs.get("required", {}), **inputs.get("optional", {})}
        for field, value in entry["inputs"].items():
            if field not in model_fields or not isinstance(value, str):
                continue
            spec = specifications.get(field)
            choices = spec[0] if isinstance(spec, list) and spec and isinstance(spec[0], list) else None
            if choices is None:
                errors.append(f"节点 {name} 未提供 {field} 的文件列表，无法确认模型是否存在")
            elif value.replace("\\", "/") not in {str(v).replace("\\", "/") for v in choices}:
                errors.append(f"模型文件不存在：{value}（节点 {name} / {field}）")
    return {
        "ok": not errors,
        "url": config["url"],
        "backend": config["backend"],
        "errors": errors,
        "nodes": sorted(definitions),
    }
