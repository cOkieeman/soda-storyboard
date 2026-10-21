from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from soda_storyboard.io import load_characters, load_page
from soda_storyboard.models import Character, Figure, Lora, Overlay, Page, Panel, RectShape
from soda_storyboard.production.api import select_lora
from soda_storyboard.production.errors import ProductionError
from soda_storyboard.production.graphs import DEFAULTS, minimal_graph, v2_graph

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("preset", ["draft", "final"])
@pytest.mark.parametrize("lora", [None, {"path": "girl.safetensors", "strength": 0.8}])
@pytest.mark.parametrize("mode", ["t2i", "i2i", "inpaint"])
def test_minimal_graph(preset: str, lora: dict | None, mode: str) -> None:
    graph = minimal_graph(
        '{"text":"中文"}',
        preset=preset,
        seed=17,
        model="base",
        lora=lora,
        image=None if mode == "t2i" else "image.png",
        inpaint=mode == "inpaint",
        denoise=0.85,
    )
    assert graph["1"]["inputs"]["unet_name"] == DEFAULTS["base"]
    assert graph["2"]["inputs"]["type"] == "moss_image"
    assert graph["4"]["inputs"]["shift"] == 5
    sampler = graph["8"]["inputs"]
    assert sampler["seed"] == 17
    assert sampler["steps"] == (25 if preset == "draft" else 50)
    assert sampler["cfg"] == (2.5 if preset == "draft" else 3)
    assert sampler["sampler_name"] == ("er_sde" if preset == "draft" else "euler")
    assert sampler["scheduler"] == "simple"
    assert ("slg" in graph) == (preset == "final")
    assert ("lora" in graph) == bool(lora)
    if lora:
        assert graph["4"]["inputs"]["model"] == ["lora", 0]
        assert graph["lora"]["inputs"]["strength_model"] == 0.8
    if mode == "inpaint":
        assert graph["14"]["inputs"]["mask"] == ["11", 1]
        assert graph["15"]["inputs"]["destination"] == ["11", 0]
        assert graph["10"]["inputs"]["images"] == ["15", 0]
    elif mode == "i2i":
        assert sampler["latent_image"] == ["13", 0]
    else:
        assert graph["7"]["inputs"] == {"width": 1024, "height": 1536, "batch_size": 1}


@pytest.mark.parametrize("preset", ["draft", "final"])
@pytest.mark.parametrize("lora", [None, {"path": "one.safetensors", "strength": 0.7}])
def test_v2_adaptation_from_actual_reference(preset: str, lora: dict | None) -> None:
    workflow = json.loads((ROOT / "examples/comfyui/soda-moss-v2-json-api.json").read_text(encoding="utf-8"))
    original = copy.deepcopy(workflow)
    workflow["301"]["inputs"]["loras"] = {"__value__": ["unexpected character"]}
    graph = v2_graph(
        workflow,
        '{"items":[]}',
        model="custom.safetensors",
        preset=preset,
        seed=12,
        width=800,
        height=1200,
        lora=lora,
        prefix="story/page",
    )
    assert graph["620"]["inputs"]["string"] == '{"items":[]}'
    assert json.loads(graph["150"]["inputs"]["resolution_json"])["width"] == 800
    assert graph["84"]["inputs"]["seed"] == 12
    assert graph["81"]["inputs"]["filename"] == "page"
    assert graph["81"]["inputs"]["path"] == "story"
    assert graph["135:111"]["inputs"]["unet_name"] == "custom.safetensors"
    assert graph["135:105"]["inputs"]["int"] == (25 if preset == "draft" else 50)
    expected = ["135:610" if preset == "final" else "135:516", 0]
    assert graph["77"]["inputs"]["model"] == (["sb_lora_1", 0] if lora else expected)
    if lora:
        assert graph["sb_lora_1"]["inputs"]["model"] == expected
    for key in ("301", "302", "303", "77"):
        assert graph[key]["inputs"]["loras"] == {"__value__": []}
    removed = {"152:227", "152:228", "152:229", "152:340", "152:341", "152:760"}
    assert not removed.intersection(graph)
    for key in ("152:225", "152:343"):
        assert list(graph[key]["inputs"]) == ["any_02"]
    for entry in graph.values():
        for value in entry["inputs"].values():
            if isinstance(value, list) and value and isinstance(value[0], str):
                assert value[0] not in removed
    assert original["84"]["inputs"]["seed"] == -1
    assert workflow["84"]["inputs"]["seed"] == -1


def test_model_overrides_and_invalid_parameters() -> None:
    assert (
        minimal_graph("test", model="sft", config={"sft": "replacement"})["1"]["inputs"]["unet_name"]
        == "replacement"
    )
    for kwargs in ({"preset": "bad"}, {"width": 0}, {"denoise": 1.1}, {"inpaint": True}):
        with pytest.raises(ProductionError):
            minimal_graph("test", **kwargs)
    with pytest.raises(ProductionError, match="缺少约定节点"):
        v2_graph({}, "test")


def test_auto_lora_counts_figures_and_stable_ties() -> None:
    page = Page(
        panels=[Panel("p", 1, RectShape(0, 0, 100, 100), character_ids=["a", "a"], figures=[Figure("b")])]
    )
    characters = {k: Character(k, k, lora=Lora(k)) for k in ("b", "a")}
    assert select_lora(page, characters)["character_id"] == "a"
    page.panels.append(Panel("q", 2, RectShape(0, 100, 100, 100), figures=[Figure("b")]))
    assert select_lora(page, characters)["character_id"] == "b"
    assert select_lora(page, characters, "a")["path"] == "a"
    assert select_lora(page, characters, "none") is None
    with pytest.raises(ProductionError, match="没有 LoRA"):
        select_lora(page, characters, "missing")
    page.overlays = [Overlay("hero", "a", RectShape(0, 0, 100, 100), mode="layer")]
    assert select_lora(page, characters)["character_id"] == "b"


def test_pudding_without_loras_does_not_invent_one() -> None:
    page = load_page(ROOT / "examples/pudding/pages/pudding.json")
    assert select_lora(page, load_characters(ROOT / "examples/pudding/characters")) is None
