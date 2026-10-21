from __future__ import annotations

import copy
import json
import shutil
from pathlib import Path

import pytest
from PIL import Image
from test_production_client import FakeComfy

from soda_storyboard.cli import main
from soda_storyboard.io import load_model, read_json, write_json
from soda_storyboard.production import api
from soda_storyboard.production.check import check
from soda_storyboard.production.errors import ProductionError
from soda_storyboard.production.state import PageState, configure

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "pudding"
    shutil.copytree(ROOT / "examples/pudding", root)
    return root


def connect(project: Path, fake: FakeComfy) -> None:
    configure(project, url=fake.url, poll_interval=0.001, timeout=2)


def add_loras(project: Path) -> None:
    for name in ("older", "younger"):
        path = project / "characters" / f"{name}.json"
        value = read_json(path)
        value["lora"] = {"path": f"{name}.safetensors", "strength": 0.8}
        write_json(path, value)


def run_cli(capsys: pytest.CaptureFixture, *args: str) -> object:
    code = main([*args, "--json"])
    output = capsys.readouterr()
    assert code == 0, output.out + output.err
    return json.loads(output.out)


def test_pudding_entire_cli_pipeline_through_http_fake(project: Path, capsys: pytest.CaptureFixture) -> None:
    with FakeComfy() as fake:
        connect(project, fake)
        root = str(project)
        original_page = read_json(project / "pages/pudding.json")
        generated = run_cli(capsys, "gen", "page", "pudding", "--project", root, "--seeds", "2")
        assert len(generated) == 2
        assert all(Path(item["path"]).is_file() for item in generated)
        assert Path(generated[0]["meta"]["candidate_sheet"]).is_file()
        assert generated[0]["meta"]["json_hash"] == generated[1]["meta"]["json_hash"]
        assert generated[0]["meta"]["model_file"].endswith(".safetensors")
        assert (project / "pages/pudding/compiled.moss.cut.json").is_file()
        compiled = json.loads(fake.prompts[0]["5"]["inputs"]["text"])
        assert "style" not in compiled
        assert all("panel_id" not in item for item in compiled["items"])
        run_cli(capsys, "pick", "pudding", generated[0]["path"], "--project", root)
        plan = run_cli(capsys, "plan", "pudding", "--project", root)
        assert plan["needs_pick"] is False
        assert plan["redraws"] == []
        split = run_cli(capsys, "split", "pudding", "--project", root)
        assert len(split) == len(original_page["panels"])
        redraw = run_cli(capsys, "redraw", "pudding", "p1", "--project", root)
        assert redraw["denoise"] == 0.45
        prompt = fake.prompts[-1]["5"]["inputs"]["text"]
        assert prompt.startswith("A single manga illustration")
        assert "multi_panel" not in prompt
        assert "No panel" not in prompt
        run_cli(capsys, "pick-panel", "pudding", "p1", redraw["path"], "--project", root)
        composed = run_cli(capsys, "compose", "pudding", "--project", root)
        assert Image.open(composed).size == (1024, 1536)
        assert not api.production_plan(project, "pudding")["needs_compose"]
        lettered = run_cli(capsys, "letter", "pudding", "--project", root, "--text", "t1")
        assert Path(lettered).is_file()
        assert Path(lettered).read_bytes() != Path(composed).read_bytes()
        exported = run_cli(capsys, "export", "pudding", "--project", root)
        assert Path(exported[0]).read_bytes() == Path(lettered).read_bytes()
        pdf = run_cli(capsys, "export", root, "--format", "pdf")
        assert Path(pdf[0]).read_bytes().startswith(b"%PDF")
        saved = read_json(project / "pages/pudding.json")
        saved.pop("production")
        for panel in saved["panels"]:
            panel.pop("production", None)
        assert saved == original_page
        assert len(fake.prompts) == 3


def test_lora_plan_swap_and_inpaint_candidates(project: Path) -> None:
    add_loras(project)
    with FakeComfy() as fake:
        connect(project, fake)
        generated = api.generate_page(project, "pudding", seeds=1, lora="younger")
        api.pick_render(project, "pudding", generated[0]["path"])
        plan = api.production_plan(project, "pudding")
        assert plan["main_character"] == "younger"
        assert {p["mode"] for p in plan["redraws"]} == {"swap", "inpaint"}
        swap_plan = next(p for p in plan["redraws"] if p["mode"] == "swap")
        redraw = api.redraw_panel(
            project, "pudding", swap_plan["panel_id"], mode="swap", character_id="older"
        )
        assert redraw["denoise"] == 0.85
        assert [
            n["inputs"]["lora_name"]
            for n in fake.prompts[-1].values()
            if n["class_type"] == "LoraLoaderModelOnly"
        ] == ["older.safetensors"]
        api.pick_panel(project, "pudding", swap_plan["panel_id"], redraw["path"])
        assert swap_plan not in api.production_plan(project, "pudding")["redraws"]
        local = next(p for p in plan["redraws"] if p["mode"] == "inpaint")
        with pytest.raises(ProductionError, match="两人同格"):
            api.redraw_panel(project, "pudding", local["panel_id"], mode="swap", character_id="older")
        painted = api.inpaint_panel(project, "pudding", local["panel_id"], character_id="older")
        assert Path(painted["mask"]).is_file()
        assert fake.prompts[-1]["14"]["inputs"]["mask"] == ["11", 1]
        api.pick_panel(project, "pudding", local["panel_id"], painted["path"])
        assert local not in api.production_plan(project, "pudding")["redraws"]


def test_config_and_check_missing_nodes_models_and_unreachable(
    project: Path, capsys: pytest.CaptureFixture
) -> None:
    with FakeComfy() as fake:
        connect(project, fake)
        assert check(project)["ok"]
        assert not fake.prompts
        fake.missing.add("KSampler")
        configure(project, model="not-there.safetensors")
        report = check(project)
        assert report["ok"] is False
        assert any("KSampler" in error for error in report["errors"])
        assert any("not-there.safetensors" in error for error in report["errors"])
        assert main(["comfy", "check", "--project", str(project)]) == 2
        assert "缺少 ComfyUI 节点" in capsys.readouterr().out
    assert main(["comfy", "check", "--project", str(project)]) == 2
    output = capsys.readouterr()
    assert "无法连接 ComfyUI" in output.err
    assert "Traceback" not in output.err
    assert main(["comfy", "check", "--project", str(project), "--json"]) == 2
    assert "无法连接 ComfyUI" in json.loads(capsys.readouterr().out)["error"]
    assert (
        run_cli(capsys, "comfy", "config", "--project", str(project), "--preset", "final")["preset"]
        == "final"
    )
    assert read_json(project / "project.json")["comfy"]["preset"] == "final"


def test_v2_end_to_end_and_model_roundtrips(project: Path) -> None:
    with FakeComfy() as fake:
        connect(project, fake)
        configure(project, backend="v2", workflow=str(ROOT / "examples/comfyui/soda-moss-v2-json-api.json"))
        generated = api.generate_page(project, "pudding", seeds=1, preset="final")
        assert "620" in fake.prompts[0]
        assert "subfolder=v2" in fake.views[0]
        api.pick_render(project, "pudding", generated[0]["path"])
        raw = read_json(project / "pages/pudding.json")
        assert load_model(project / "pages/pudding.json").to_dict()["production"] == raw["production"]
        assert load_model(project / "project.json").to_dict()["comfy"]["backend"] == "v2"


def test_pick_invalidation_and_export_stage_precedence(project: Path) -> None:
    with FakeComfy() as fake:
        connect(project, fake)
        renders = api.generate_page(project, "pudding", seeds=2)
        api.pick_render(project, "pudding", renders[0]["path"])
        composed = api.compose_page(project, "pudding")
        Image.new("RGB", (1024, 1536), "red").save(composed)
        assert Image.open(api.export(project)[0]).getpixel((0, 0)) == (255, 0, 0)
        lettered = api.letter_page(project, "pudding")
        Image.new("RGB", (1024, 1536), "green").save(lettered)
        assert Image.open(api.export(project)[0]).getpixel((0, 0)) == (0, 128, 0)
        api.pick_render(project, "pudding", renders[1]["path"])
        assert PageState(project, "pudding").image_stage("lettered") is None
        assert Path(api.export(project)[0]).read_bytes() == Path(renders[1]["path"]).read_bytes()


def test_project_export_order_and_quad_composition(project: Path) -> None:
    with FakeComfy() as fake:
        connect(project, fake)
        base = read_json(project / "pages/pudding.json")
        base["panels"] = [
            {
                "id": "p",
                "order": 1,
                "shape": {"type": "quad", "points": [[0, 80], [300, 0], [300, 400], [0, 400]]},
            }
        ]
        base["texts"] = []
        write_json(project / "pages/pudding.json", base)
        for page_id in ("page2", "page10"):
            page = copy.deepcopy(base)
            page["id"] = page_id
            write_json(project / "pages" / f"{page_id}.json", page)
            renders = api.generate_page(project, page_id, seeds=1)
            api.pick_render(project, page_id, renders[0]["path"])
        metadata = read_json(project / "project.json")
        metadata["pages"] = ["page10", "page2"]
        write_json(project / "project.json", metadata)
        exported = api.export(project)
        assert [Path(p).stem for p in exported] == ["page10", "page2"]
        composed = Image.open(api.compose_page(project, "page2"))
        assert composed.getpixel((5, 5)) == (255, 255, 255)
        assert composed.getpixel((20, 77)) == (255, 255, 255)
        assert composed.getpixel((150, 200)) != (255, 255, 255)


def test_cutout_no_node_does_not_submit_and_import_layers_above_letters(project: Path) -> None:
    page_path = project / "pages/pudding.json"
    page = read_json(page_path)
    page["overlays"] = [
        {
            "id": "hero",
            "character_id": "older",
            "mode": "layer",
            "rect": {"type": "rect", "x": 0, "y": 0, "w": 100, "h": 100},
        }
    ]
    write_json(page_path, page)
    with FakeComfy() as fake:
        connect(project, fake)
        generated = api.generate_page(project, "pudding", seeds=1)
        api.pick_render(project, "pudding", generated[0]["path"])
        with pytest.raises(ProductionError, match="缺少抠图节点"):
            api.cutout(project, "pudding", "hero")
        assert len(fake.prompts) == 1
        api.letter_page(project, "pudding")
        png = project / "cutout.png"
        transparent = Image.new("RGBA", (100, 100), (255, 0, 0, 0))
        transparent.paste((255, 0, 0, 255), (20, 20, 80, 100))
        transparent.save(png)
        result = api.cutout(project, "pudding", "hero", png=png)
        assert Image.open(result["page_path"]).getpixel((50, 50)) == (255, 0, 0)
        assert "lettered" in result["page_path"]
        assert api.production_plan(project, "pudding")["overlays"][0]["needs_cutout"] is False
        assert len(fake.prompts) == 1


@pytest.mark.parametrize("with_lora", [True, False])
def test_generated_cutout_uses_detected_node_and_one_lora(project: Path, *, with_lora: bool) -> None:
    if with_lora:
        add_loras(project)
    page_path = project / "pages/pudding.json"
    page = read_json(page_path)
    page["overlays"] = [
        {
            "id": "hero",
            "character_id": "older",
            "mode": "layer",
            "rect": {"type": "rect", "x": 0, "y": 0, "w": 100, "h": 200},
        }
    ]
    write_json(page_path, page)
    with FakeComfy() as fake:
        connect(project, fake)
        generated = api.generate_page(project, "pudding", seeds=1)
        api.pick_render(project, "pudding", generated[0]["path"])
        fake.definitions["RMBG"] = {
            "input": {"required": {"image": ["IMAGE"], "model": [["BiRefNet", "other"]]}},
            "output": ["IMAGE", "MASK"],
        }
        result = api.cutout(project, "pudding", "hero")
        assert Path(result["path"]).is_file()
        assert fake.prompts[-1]["cutout"]["class_type"] == "RMBG"
        if with_lora:
            assert fake.prompts[-1]["lora"]["inputs"]["lora_name"] == "older.safetensors"
        else:
            assert "lora" not in fake.prompts[-1]


def test_invalid_selections_do_not_submit(project: Path) -> None:
    with FakeComfy() as fake:
        connect(project, fake)
        for invalid in (0, -1, True):
            with pytest.raises(ProductionError, match="seeds"):
                api.generate_page(project, "pudding", seeds=invalid)
        with pytest.raises(ProductionError, match="选定"):
            api.compose_page(project, "pudding")
        with pytest.raises(ProductionError, match="未登记"):
            api.pick_render(project, "pudding", "arbitrary.png")
        assert not fake.prompts


def test_partial_generation_keeps_successes_and_api_errors_are_chinese(project: Path) -> None:
    with FakeComfy() as fake:
        connect(project, fake)

        def fail_second(event: dict) -> None:
            if event.get("stage") == "candidate" and event.get("index") == 2:
                fake.reject = True

        with pytest.raises(ProductionError, match="missing-model"):
            api.generate_page(project, "pudding", seeds=2, progress=fail_second)
        saved = read_json(project / "pages/pudding.json")["production"]["renders"]
        assert len(saved) == 1
        assert (project / saved[0]["path"]).is_file()
        api.pick_render(project, "pudding", saved[0]["path"])
        api.compose_page(project, "pudding")
        assert PageState(project, "pudding").image_stage("composed")
        configure(project, cut_inset=5)
        assert PageState(project, "pudding").image_stage("composed") is None
    with pytest.raises(ProductionError, match="找不到分镜页"):
        api.generate_page(project / "missing-project", "pudding", seeds=1)
    (project / "project.json").write_text("{broken", encoding="utf-8")
    with pytest.raises(ProductionError, match="生产操作失败"):
        api.generate_page(project, "pudding", seeds=1)


def test_export_uses_natural_page_order_without_project_override(project: Path) -> None:
    base = read_json(project / "pages/pudding.json")
    for page_id in ("page10", "page2"):
        page = copy.deepcopy(base)
        page["id"] = page_id
        write_json(project / "pages" / f"{page_id}.json", page)
    from soda_storyboard.production.state import page_ids  # noqa: PLC0415 -- scoped assertion helper

    assert page_ids(project) == ["page2", "page10", "pudding"]


def test_explicit_program_lettering_is_not_sent_to_moss(project: Path) -> None:
    path = project / "pages/pudding.json"
    page = read_json(path)
    page["texts"][0]["render_mode"] = "lettering"
    page["texts"][0]["text"] = "PROGRAM LETTERING"
    write_json(path, page)
    with FakeComfy() as fake:
        connect(project, fake)
        generated = api.generate_page(project, "pudding", seeds=1)
        compiled = json.loads(fake.prompts[0]["5"]["inputs"]["text"])
        assert all(item.get("text") != "PROGRAM LETTERING" for item in compiled["items"])
        assert any(item.get("text") for item in compiled["items"])
        api.pick_render(project, "pudding", generated[0]["path"])
        assert api.production_plan(project, "pudding")["lettering"]["text_ids"] == ["t1"]
        composed = Path(api.compose_page(project, "pudding")).read_bytes()
        assert Path(api.letter_page(project, "pudding")).read_bytes() != composed
