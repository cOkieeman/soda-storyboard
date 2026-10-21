# ruff: noqa: RUF001
# Chinese user-facing diagnostics intentionally use Chinese punctuation.
"""Build portable MOSS graphs or adapt a user-imported Soda-MOSS v2 API graph."""

from __future__ import annotations

import copy
import json
from typing import Any

from .errors import ProductionError

type JSON = dict[str, Any]
PRESETS = {
    "draft": {"steps": 25, "cfg": 2.5, "sampler_name": "er_sde", "scheduler": "simple"},
    "final": {"steps": 50, "cfg": 3, "sampler_name": "euler", "scheduler": "simple"},
}
DEFAULTS = {
    "url": "http://127.0.0.1:8190",
    "model": "sft",
    "preset": "draft",
    "backend": "minimal",
    "sft": r"MOSS-Image\MOSS-Image-SFT\moss_image_sft_int8_convrot.safetensors",
    "base": r"MOSS-Image\MOSS-Image-Base\moss_image_base_int8_convrot.safetensors",
    "clip": "qwen3.5_9b_w4a8_gptq.safetensors",
    "vae": "flux2-vae.safetensors",
    "timeout": 600,
    "poll_interval": 1,
    "workflow": None,
    "cut_inset": 12,
    "border_width": 3,
}


def node(class_type: str, **inputs: Any) -> JSON:  # noqa: ANN401 -- heterogeneous node inputs
    return {"class_type": class_type, "inputs": inputs}


def minimal_graph(  # noqa: PLR0913 -- explicit graph generation options
    prompt: str,
    *,
    config: JSON | None = None,
    model: str | None = None,
    preset: str = "draft",
    seed: int = 0,
    width: int = 1024,
    height: int = 1536,
    lora: JSON | None = None,
    image: str | None = None,
    denoise: float = 1,
    inpaint: bool = False,
    prefix: str = "soda-storyboard",
) -> JSON:
    cfg = {**DEFAULTS, **(config or {})}
    if preset not in PRESETS:
        msg = "预设必须是 draft 或 final"
        raise ProductionError(msg)
    if width <= 0 or height <= 0 or not 0 <= denoise <= 1 or seed < 0:
        msg = "尺寸必须为正数、种子不能为负、denoise 必须在 0 到 1 之间"
        raise ProductionError(msg)
    if inpaint and not image:
        msg = "局部重绘需要带透明遮罩的输入图片"
        raise ProductionError(msg)
    selected = model or cfg["model"]
    graph = {
        "1": node("UNETLoader", unet_name=cfg.get(selected, selected), weight_dtype="default"),
        "2": node("CLIPLoader", clip_name=cfg["clip"], type="moss_image", device="default"),
        "3": node("VAELoader", vae_name=cfg["vae"]),
        "5": node("CLIPTextEncode", text=prompt, clip=["2", 0]),
        "6": node("CLIPTextEncode", text="", clip=["2", 0]),
    }
    model_link = ["1", 0]
    if lora:
        graph["lora"] = node(
            "LoraLoaderModelOnly",
            model=model_link,
            lora_name=lora["path"],
            strength_model=lora.get("strength", 1),
        )
        model_link = ["lora", 0]
    graph["4"] = node("ModelSamplingAuraFlow", model=model_link, shift=5)
    model_link = ["4", 0]
    if preset == "final":
        graph["slg"] = node(
            "SkipLayerGuidanceDiTSimple",
            model=model_link,
            double_layers="",
            single_layers="22",
            start_percent=0,
            end_percent=1,
        )
        model_link = ["slg", 0]
    if image:
        graph["11"] = node("LoadImage", image=image)
        graph["13"] = node("VAEEncode", pixels=["11", 0], vae=["3", 0])
        latent = ["13", 0]
        if inpaint:
            graph["14"] = node("SetLatentNoiseMask", samples=latent, mask=["11", 1])
            latent = ["14", 0]
    else:
        graph["7"] = node("EmptyFlux2LatentImage", width=width, height=height, batch_size=1)
        latent = ["7", 0]
    graph["8"] = node(
        "KSampler",
        model=model_link,
        seed=seed,
        **PRESETS[preset],
        positive=["5", 0],
        negative=["6", 0],
        latent_image=latent,
        denoise=denoise,
    )
    graph["9"] = node("VAEDecode", samples=["8", 0], vae=["3", 0])
    output = ["9", 0]
    if inpaint:
        graph["15"] = node(
            "ImageCompositeMasked",
            destination=["11", 0],
            source=output,
            x=0,
            y=0,
            resize_source=False,
            mask=["11", 1],
        )
        output = ["15", 0]
    graph["10"] = node("SaveImage", images=output, filename_prefix=prefix)
    return graph


def v2_graph(  # noqa: C901, PLR0913 -- adaptation of the documented node table
    workflow: JSON,
    prompt: str,
    *,
    config: JSON | None = None,
    model: str | None = None,
    preset: str = "draft",
    seed: int = 0,
    width: int = 1024,
    height: int = 1536,
    lora: JSON | None = None,
    prefix: str = "soda-storyboard",
) -> JSON:
    cfg = {**DEFAULTS, **(config or {})}
    if preset not in PRESETS:
        msg = "预设必须是 draft 或 final"
        raise ProductionError(msg)
    graph = copy.deepcopy(workflow)
    try:
        graph["620"]["inputs"]["string"] = prompt
        graph["150"]["inputs"]["resolution_json"] = json.dumps(
            {"version": 1, "width": width, "height": height}
        )
        graph["84"]["inputs"]["seed"] = seed
        graph["81"]["inputs"].update(filename=prefix.rsplit("/", 1)[-1], path=prefix.rpartition("/")[0])
        selected = model or cfg["model"]
        graph["135:111"]["inputs"]["unet_name"] = cfg.get(selected, selected)
        graph["135:105"]["inputs"]["int"] = PRESETS[preset]["steps"]
        graph["135:102"]["inputs"]["float"] = PRESETS[preset]["cfg"]
        graph["135:513"]["inputs"]["sampler_name"] = PRESETS[preset]["sampler_name"]
        # Imported character stacks must never silently load a second character.
        for identifier in ("301", "302", "303", "77"):
            if identifier in graph:
                inputs = graph[identifier]["inputs"]
                inputs["loras"] = {"__value__": []}
                inputs["text"] = ""
        model_link = ["135:610" if preset == "final" else "135:516", 0]
        if lora:
            graph["sb_lora_1"] = node(
                "LoraLoaderModelOnly",
                model=model_link,
                lora_name=lora["path"],
                strength_model=lora.get("strength", 1),
            )
            model_link = ["sb_lora_1", 0]
        graph["77"]["inputs"]["model"] = model_link
        removed = {"152:227", "152:228", "152:229", "152:340", "152:341", "152:760"}
        for identifier in removed:
            graph.pop(identifier, None)
        for identifier in ("152:225", "152:343"):
            graph[identifier]["inputs"] = {"any_02": graph[identifier]["inputs"]["any_02"]}
        # Loader overrides apply to v2 as well as the portable backend.
        for item in graph.values():
            inputs = item["inputs"]
            if "clip_name" in inputs:
                inputs["clip_name"] = cfg["clip"]
            if "vae_name" in inputs:
                inputs["vae_name"] = cfg["vae"]
            for value in inputs.values():
                if isinstance(value, list) and value and isinstance(value[0], str) and value[0] in removed:
                    msg = f"v2 工作流仍引用已关闭的 SeedVR2 节点：{value[0]}"
                    raise ProductionError(msg)
    except (KeyError, TypeError) as exc:
        msg = f"v2 API 工作流缺少约定节点或字段：{exc}"
        raise ProductionError(msg) from exc
    return graph
