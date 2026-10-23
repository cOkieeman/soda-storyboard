"""Regression coverage using synthetic projects and loopback fakes only."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
from test_production_client import FakeComfy
from test_production_pipeline import connect
from test_production_pipeline import project as project  # noqa: PLC0414 -- reusable fixture
from test_server_http import client as client  # noqa: PLC0414 -- reusable fixture

from soda_storyboard.cli import main
from soda_storyboard.figures import draw_primitives, sketch_geometry
from soda_storyboard.geometry import shape_polygon
from soda_storyboard.io import read_json, write_json
from soda_storyboard.models import POSES, Figure, Page, Panel, RectShape
from soda_storyboard.preview import _paste_panel_figures
from soda_storyboard.production import api
from soda_storyboard.production.cli import _estimate
from soda_storyboard.production.client import ComfyClient
from soda_storyboard.production.errors import ProductionError
from soda_storyboard.production.graphs import minimal_graph
from soda_storyboard.production.state import PageState
from soda_storyboard.templates import suggest_layouts
from soda_storyboard.validation import validate_page
from soda_storyboard.web_build import source_hash

if TYPE_CHECKING:
    from test_server_http import Client

# Tests intentionally exercise the node contract helper before any sampler exists.
# ruff: noqa: SLF001, RUF001


def rounded_page(layout: dict | None = None) -> dict:
    layout = layout or suggest_layouts(6, pick="hero-bottom-skew")[0]
    return {
        "format": "soda-storyboard-page-v1",
        "id": "pudding",
        "canvas_width": 1024,
        "canvas_height": 1536,
        "panel_gap": 24,
        "panels": [
            {
                "id": f"p{i}",
                "order": i,
                "shape": {"type": "quad", "points": [[round(v, 1) for v in pt] for pt in s["points"]]}
                if s["type"] == "quad"
                else {k: v for k, v in s.items() if k != "order"},
            }
            for i, s in enumerate(layout["panels"], 1)
        ],
    }


def test_rounded_skew_cli_and_put(client: Client, capsys: pytest.CaptureFixture) -> None:
    assert main(["layout", "suggest", "--panels", "6", "--pick", "hero-bottom-skew", "--json"]) == 0
    layout = json.loads(capsys.readouterr().out)[0]
    assert all(
        v == round(v, 2)
        for s in layout["panels"]
        if s["type"] == "quad"
        for point in s["points"]
        for v in point
    )
    page = rounded_page(layout)
    assert validate_page(Page.from_dict(page)).valid
    _, headers = client.page()
    assert client.call("PUT", "/api/pages/pudding", page, headers)[0] == 200
    assert main(["validate", str(client.root / "pages/pudding.json"), "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["valid"]


def test_cutout_optional_defaults() -> None:
    definition = {
        "input": {
            "required": {"image": ["IMAGE"], "model": [["general"]]},
            "optional": {
                "mask_blur": ["INT", {"default": 0}],
                "background": [["Alpha", "Color"], {"default": "Alpha"}],
                "invert": ["BOOLEAN", {"default": False}],
            },
        },
        "output": ["IMAGE"],
    }
    graph, _ = api._remove_background_node(definition, "BiRefNetRMBG")
    assert graph["inputs"]["mask_blur"] == 0
    assert graph["inputs"]["background"] == "Alpha"
    assert graph["inputs"]["invert"] is False


def test_mask_only_never_submits(project: Path, capsys: pytest.CaptureFixture) -> None:
    with FakeComfy() as fake:
        connect(project, fake)
        image = api.generate_page(project, "pudding", seeds=1)[0]
        api.pick_render(project, "pudding", image["path"])
        before = (project / "pages/pudding.json").read_bytes()
        count = len(fake.requests)
        assert (
            main(
                [
                    "inpaint",
                    "pudding",
                    "p5",
                    "--project",
                    str(project),
                    "--character",
                    "older",
                    "--mask-only",
                    "--json",
                ]
            )
            == 0
        )
        result = json.loads(capsys.readouterr().out)
        assert Path(result["mask"]).is_file()
        assert Path(result["preview"]).is_file()
        assert len(fake.requests) == count
        assert before == (project / "pages/pudding.json").read_bytes()


def test_compose_clears_all_gutters(project: Path) -> None:
    value = rounded_page()
    write_json(project / "pages/pudding.json", value)
    with FakeComfy() as fake:
        connect(project, fake)
        generated = api.generate_page(project, "pudding", seeds=1)[0]
        api.pick_render(project, "pudding", generated["path"])
    base = Image.new("RGB", (1024, 1536), "black")
    base.save(generated["path"])
    result = Image.open(api.compose_with_options(project, "pudding", cut_inset=0))
    assert result.getpixel((10, 10)) == (255, 255, 255)
    assert result.getpixel((500, 340)) == (255, 255, 255)
    assert result.getpixel((700, 180)) == (0, 0, 0)
    allowed = Image.new("L", result.size)
    draw = ImageDraw.Draw(allowed)
    for panel in value["panels"]:
        draw.polygon(shape_polygon(panel["shape"]), fill=255)
    # Allow only the newly drawn boundary strokes, never old gutter frames.
    outside = ImageChops.invert(allowed.filter(ImageFilter.MaxFilter(7)))
    ink = ImageChops.difference(result.convert("RGB"), Image.new("RGB", result.size, "white")).convert("L")
    assert not ImageChops.multiply(outside, ink).getbbox()


def test_sketch_geometry_endpoint(client: Client) -> None:
    status, _, body = client.call("GET", "/api/pages/pudding/sketch-geometry")
    assert status == 200
    page, _ = client.page()
    assert body["version"] == client.server.store.page("pudding")["version"]
    assert body["canvas"] == [1024, 1536]
    assert len(body["panels"]) == len(page["panels"])
    figure = next(f for p in body["panels"] for f in p["figures"])
    assert any(p["type"] == "circle" for p in figure["primitives"])
    assert all(p["type"] in {"circle", "line", "polygon"} for p in figure["primitives"])


def test_editor_write_source(client: Client) -> None:
    queue = client.server.events.subscribe()
    try:
        page, headers = client.page()
        page["description"] = "editor write"
        headers["X-Client-Id"] = "client-a"
        assert client.call("PUT", "/api/pages/pudding", page, headers)[0] == 200
        event, payload = queue.get(timeout=3)
        assert event == "file_changed"
        assert payload["source"] == "editor"
        assert payload["client_id"] == "client-a"
        value = read_json(client.root / "pages/pudding.json")
        value["description"] = "external write"
        write_json(client.root / "pages/pudding.json", value)
        event, payload = queue.get(timeout=3)
        assert event == "file_changed"
        assert payload["source"] == "external"
    finally:
        client.server.events.unsubscribe(queue)


def test_frontend_hash_normalizes_crlf(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    source = tmp_path / "src/sample.ts"
    source.write_bytes(b"const a = 1;\nconst b = 2;\n")
    lf = source_hash(tmp_path)
    source.write_bytes(source.read_bytes().replace(b"\n", b"\r\n"))
    assert source_hash(tmp_path) == lf


def test_character_put_source_and_no_duplicate_watch_event(client: Client) -> None:
    queue = client.server.events.subscribe()
    try:
        _, _, body = client.call("GET", "/api/characters/older")
        body["character"]["display_name"] = "Updated"
        status, headers, saved = client.call(
            "PUT", "/api/characters/older", body["character"], {"X-Client-Id": "client-b"}
        )
        assert status == 200
        event, payload = queue.get(timeout=3)
        assert event == "file_changed"
        assert payload["source"] == "editor"
        assert payload["client_id"] == "client-b"
        assert payload["page_id"] is None
        assert payload["character_id"] == "older"
        assert payload["version"] == headers["ETag"] == saved["version"]
        assert payload["operation_id"] == saved["operation_id"]
        with client.server.events.lock:
            client.server.events.poll()
        assert queue.empty()
    finally:
        client.server.events.unsubscribe(queue)


def test_skill_does_not_deny_shipped_production() -> None:
    skill = Path(__file__).resolve().parents[1] / "skill"
    obsolete = [
        "本插件不调用模型",
        "不是本插件已有 redraw 命令",
        "当前还没有自动完成这套重画流程",
        "这里没有自动生成或修图操作",
        "不要自行调用 ComfyUI 验证",
    ]
    for path in skill.rglob("*.md"):
        text = path.read_text(encoding="utf-8")
        assert not any(phrase in text for phrase in obsolete), path


@pytest.mark.parametrize(("tolerance", "valid"), [(0.5, True), (0, False), (0.1, False)])
def test_geometry_tolerance_applies_to_bounds_and_overlap(tolerance: float, *, valid: bool) -> None:
    page = Page(
        canvas_width=128,
        canvas_height=128,
        panel_gap=0,
        panels=[
            Panel("a", 1, RectShape(-0.2, 0, 64.4, 128)),
            Panel("b", 2, RectShape(64, 0, 64, 128)),
        ],
    )
    assert validate_page(page, geometry_tolerance=tolerance).valid is valid
    page.extra["geometry_tolerance"] = tolerance
    assert validate_page(page).valid is valid


@pytest.mark.parametrize("missing", ["parameter", "input", "output"])
def test_cutout_preflight_failure_never_submits(project: Path, missing: str) -> None:
    with FakeComfy() as fake:
        connect(project, fake)
        generated = api.generate_page(project, "pudding", seeds=1)[0]
        api.pick_render(project, "pudding", generated["path"])
        value = read_json(project / "pages/pudding.json")
        value["overlays"][0]["mode"] = "layer"
        write_json(project / "pages/pudding.json", value)
        definition = {"input": {"required": {"image": ["IMAGE"]}}, "output": ["IMAGE"]}
        if missing == "parameter":
            definition["input"]["required"]["unavailable"] = ["MODEL"]
        elif missing == "input":
            definition["input"]["required"] = {}
        else:
            definition["output"] = ["MASK"]
        fake.definitions["BiRefNetRMBG"] = definition
        count = len(fake.prompts)
        with pytest.raises(ProductionError, match="--png"):
            api.cutout(project, "pudding", value["overlays"][0]["id"])
        assert len(fake.prompts) == count


def test_execution_error_is_short_and_full_details_are_logged(tmp_path: Path) -> None:
    with FakeComfy() as fake:
        fake.fail = True
        client = ComfyClient(fake.url, timeout=2, poll_interval=0.001, log_directory=tmp_path)
        with pytest.raises(ProductionError, match="CUDA test failure") as caught:
            client.run(minimal_graph("test"), tmp_path / "unused.png")
        assert "任务号 1" in str(caught.value)
        assert "status_str" not in str(caught.value)
        assert len(str(caught.value)) < 500
        logged = json.loads(next(tmp_path.glob("comfy-*.json")).read_text(encoding="utf-8"))
        assert logged["status"]["messages"][0][1]["exception_message"] == "CUDA test failure"


def test_cutout_defaults_from_fake_object_info(project: Path) -> None:
    with FakeComfy() as fake:
        connect(project, fake)
        generated = api.generate_page(project, "pudding", seeds=1)[0]
        api.pick_render(project, "pudding", generated["path"])
        value = read_json(project / "pages/pudding.json")
        value["overlays"][0]["mode"] = "layer"
        write_json(project / "pages/pudding.json", value)
        fake.definitions["BiRefNetRMBG"] = {
            "input": {
                "required": {"image": ["IMAGE"], "model": [["general"]]},
                "optional": {
                    "mask_blur": ["INT", {"default": 0}],
                    "background": [["Alpha", "Color"], {"default": "Alpha"}],
                    "invert_output": ["BOOLEAN", {"default": False}],
                },
            },
            "output": ["IMAGE"],
        }
        api.cutout(project, "pudding", value["overlays"][0]["id"])
        assert "/object_info/BiRefNetRMBG" in fake.requests
        inputs = fake.prompts[-1]["cutout"]["inputs"]
        assert inputs["mask_blur"] == 0
        assert inputs["background"] == "Alpha"
        assert inputs["invert_output"] is False


def test_diagnostic_keeps_stack_and_tensor_out_of_console(tmp_path: Path) -> None:
    client = ComfyClient(log_directory=tmp_path)
    history = {
        "status": {
            "messages": [
                [
                    "execution_error",
                    {
                        "node_type": "BiRefNetRMBG",
                        "node_id": "cutout",
                        "exception_message": "Error in image processing: 'mask_blur'\n",
                        "traceback": ["upstream stack" * 1000],
                        "current_inputs": {"image": "tensor(...)"},
                    },
                ]
            ]
        }
    }
    error = client._execution_error("task-123", history)
    assert "BiRefNetRMBG" in str(error)
    assert "task-123" in str(error)
    assert "tensor" not in str(error)
    assert "upstream stack" not in str(error)
    assert json.loads(next(tmp_path.glob("comfy-*.json")).read_text(encoding="utf-8")) == history


def test_rejected_submit_logs_full_response(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = ComfyClient(log_directory=tmp_path)
    rejected = {
        "error": {"message": "missing parameter"},
        "node_errors": {"cutout": {"traceback": "long stack" * 1000}},
    }
    monkeypatch.setattr(client, "_json", lambda *_args: rejected)
    with pytest.raises(ProductionError, match="BiRefNetRMBG") as caught:
        client.submit({"cutout": {"class_type": "BiRefNetRMBG"}})
    assert "long stack" not in str(caught.value)
    assert "尚无任务号" in str(caught.value)
    assert json.loads(next(tmp_path.glob("comfy-*.json")).read_text(encoding="utf-8")) == rejected


def test_size_and_step_estimates(capsys: pytest.CaptureFixture) -> None:
    _estimate(1, "draft", 512, 768)
    assert "512×768、25 步预计约 10 秒" in capsys.readouterr().err
    _estimate(2, "final", 1024, 1536)
    assert "预计约 160 秒" in capsys.readouterr().err


@pytest.mark.parametrize("pose", sorted(set(POSES) | {"unknown"}))
@pytest.mark.parametrize("framing", ["full", "waist", "bust", "face"])
def test_api_primitives_match_png_figures(pose: str, framing: str) -> None:
    panel = Panel(
        "p",
        1,
        {"type": "quad", "points": [[40, 40], [220, 50], [210, 240], [50, 230]]},
        figures=[Figure("girl", pose=pose, facing="left", framing=framing)],
    )
    page = Page(canvas_width=256, canvas_height=256, panels=[panel])
    image = Image.new("RGB", (256, 256), "white")
    font = ImageFont.load_default()
    data = sketch_geometry(page, {}, font=font)["panels"][0]
    _paste_panel_figures(image, panel, page, {}, font=font, scale=1)
    expected = Image.new("RGBA", image.size)
    for figure in data["figures"]:
        draw_primitives(expected, figure, font=font)
    mask = Image.new("L", image.size)
    ImageDraw.Draw(mask).polygon([tuple(p) for p in data["clip"]], fill=255)
    expected.putalpha(ImageChops.multiply(expected.getchannel("A"), mask))
    paper = Image.new("RGB", image.size, "white")
    paper.paste(expected, (0, 0), expected)
    assert not ImageChops.difference(image, paper).getbbox()


@pytest.mark.skipif(not os.environ.get("SODA_T1_RUN"), reason="requires optional read-only T1 evidence")
def test_t1_copy_validate_mask_and_cutout_contract(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    source = Path(os.environ["SODA_T1_RUN"])
    original = (source / "story/pages/library-prank.json").read_bytes()
    project = tmp_path / "story"
    shutil.copytree(source / "story", project)
    path = project / "pages/library-prank.json"
    value = read_json(path)
    value["panel_gap"] = 24
    for panel in value["panels"]:
        if panel["shape"]["type"] == "quad":
            panel["shape"]["points"] = [[round(v, 1) for v in pt] for pt in panel["shape"]["points"]]
    write_json(path, value)
    assert main(["validate", str(path), "--json"]) == 0
    capsys.readouterr()

    def forbidden_client(_state: PageState) -> None:
        pytest.fail("mask-only attempted a ComfyUI connection")

    with monkeypatch.context() as patch:
        patch.setattr(PageState, "client", forbidden_client)
        assert (
            main(
                [
                    "inpaint",
                    "library-prank",
                    "p2",
                    "--project",
                    str(project),
                    "--character",
                    "whale",
                    "--mask-only",
                    "--json",
                ]
            )
            == 0
        )
        result = json.loads(capsys.readouterr().out)
        assert Path(result["preview"]).exists()
    contract = read_json(source / "evidence/39-cutout-nodes.json")
    graph, _ = api._remove_background_node(contract["BiRefNetRMBG"], "BiRefNetRMBG")
    assert graph["inputs"]["mask_blur"] == 0
    assert graph["inputs"]["background"] == "Alpha"
    assert graph["inputs"]["invert_output"] is False
    assert (source / "story/pages/library-prank.json").read_bytes() == original
