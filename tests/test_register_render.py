from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest
from PIL import Image
from test_production_pipeline import project as project  # noqa: PLC0414 -- shared project fixture

from soda_storyboard.cli import main
from soda_storyboard.io import read_json, write_json
from soda_storyboard.production import api
from soda_storyboard.production.errors import ProductionError
from soda_storyboard.production.state import PageState


def image_file(path: Path, *, alpha: bool = False) -> Path:
    Image.new("RGBA" if alpha else "RGB", (32, 32), (255, 0, 0, 128) if alpha else "red").save(path)
    return path


def test_register_external_image_then_pick_and_compose(project: Path) -> None:
    source = image_file(project.parent / "worker.png")
    record = api.register_render(
        project,
        "pudding",
        source,
        seed=123,
        preset="worker-final",
        model="custom",
        source="hub-worker",
        meta={"job_id": "job-1"},
    )
    path = Path(record["path"])
    assert path.is_relative_to(project / "pages/pudding/renders")
    assert path.read_bytes() == source.read_bytes()
    assert record["seed"] == 123
    assert record["source"] == "hub-worker"
    assert record["meta"]["preset"] == "worker-final"
    assert record["meta"]["model"] == "custom"
    assert record["meta"]["job_id"] == "job-1"
    saved = read_json(project / "pages/pudding.json")["production"]
    assert "selected_render" not in saved
    assert not Path(saved["renders"][0]["path"]).is_absolute()
    source.unlink()
    api.pick_render(project, "pudding", record["path"])
    assert Path(api.compose_page(project, "pudding")).is_file()


def test_register_select_invalidates_previous_stages(project: Path) -> None:
    source = image_file(project / "local.png")
    api.register_render(project, "pudding", "local.png", select=True)
    api.compose_page(project, "pudding")
    record = api.register_render(project, "pudding", source, select=True)
    state = PageState(project, "pudding")
    assert state.base() == Path(record["path"])
    assert "composed" not in state.production
    assert len(state.production["renders"]) == 2


@pytest.mark.parametrize("contents", [b"not an image", b"\x89PNG\r\n\x1a\n"])
def test_register_rejects_non_image_without_writing(project: Path, contents: bytes) -> None:
    source = project.parent / "bad.png"
    source.write_bytes(contents)
    page = project / "pages/pudding.json"
    before = page.read_bytes()
    with pytest.raises(ProductionError, match="图片"):
        api.register_render(project, "pudding", source, select=True)
    assert page.read_bytes() == before
    assert not (project / "pages/pudding/renders").exists()


def test_register_writeback_keeps_edit_and_parallel_candidates(
    project: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = image_file(project.parent / "worker.png")
    barrier = Barrier(2)
    save = PageState.save

    def coordinated_save(state: PageState) -> None:
        barrier.wait(timeout=10)
        save(state)

    monkeypatch.setattr(PageState, "save", coordinated_save)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(api.register_render, project, "pudding", source, seed=seed) for seed in (1, 2)]
        errors = [future.exception(timeout=15) for future in futures]
        if failures := [error for error in errors if error is not None]:
            message = "Concurrent registration failed"
            raise ExceptionGroup(message, failures)
        records = [future.result(timeout=15) for future in futures]
    saved = read_json(project / "pages/pudding.json")
    assert {record["seed"] for record in saved["production"]["renders"]} == {1, 2}
    assert len({record["path"] for record in records}) == 2


def test_register_writeback_preserves_edit_during_import(
    project: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = image_file(project.parent / "worker.png")
    page = project / "pages/pudding.json"
    save = PageState.save

    def editing_save(state: PageState) -> None:
        latest = read_json(page)
        latest["panels"][0]["description"] = "edited while importing"
        latest["texts"][0]["text"] = "new dialogue"
        write_json(page, latest)
        save(state)

    monkeypatch.setattr(PageState, "save", editing_save)
    api.register_render(project, "pudding", source, select=True)
    saved = read_json(page)
    assert saved["panels"][0]["description"] == "edited while importing"
    assert saved["texts"][0]["text"] == "new dialogue"
    assert saved["production"]["selected_render"]


def test_register_panel_candidate_supports_pick_and_compose(project: Path) -> None:
    source = image_file(project.parent / "worker.png")
    api.register_render(project, "pudding", source, select=True)
    record = api.register_render(project, "pudding", source, panel_id="p1", seed=9)
    api.pick_panel(project, "pudding", "p1", record["path"])
    assert Path(api.compose_page(project, "pudding")).is_file()
    state = PageState(project, "pudding")
    panel = state.panel("p1")["production"]
    assert panel["selected"] == state.relative(Path(record["path"]))
    assert panel["renders"][0]["source_render"] == state.production["selected_render"]


def test_register_layer_candidate_is_inactive_until_selected(project: Path) -> None:
    source = image_file(project.parent / "worker.png", alpha=True)
    page = project / "pages/pudding.json"
    raw = read_json(page)
    raw["overlays"] = [{"id": "layer", "mode": "layer", "rect": {"x": 0, "y": 0, "w": 32, "h": 32}}]
    write_json(page, raw)
    base = project.parent / "base.png"
    Image.new("RGB", (32, 32), "blue").save(base)
    api.register_render(project, "pudding", base, select=True)
    api.register_render(project, "pudding", source, overlay_id="layer")
    assert "path" not in PageState(project, "pudding").production["overlays"]["layer"]
    record = api.register_render(project, "pudding", source, overlay_id="layer", select=True)
    state = PageState(project, "pudding")
    layer = state.production["overlays"]["layer"]
    assert layer["path"] == state.relative(Path(record["path"]))
    assert len(layer["renders"]) == 2
    composed = api.compose_page(project, "pudding")
    with Image.open(composed) as image:
        assert image.getpixel((16, 16)) == (128, 0, 127)


def test_register_selects_panel_and_clears_it_when_new_page_is_selected(project: Path) -> None:
    source = image_file(project.parent / "worker.png")
    api.register_render(project, "pudding", source, select=True)
    record = api.register_render(project, "pudding", source, panel_id="p1", select=True)
    state = PageState(project, "pudding")
    assert state.panel("p1")["production"]["selected"] == state.relative(Path(record["path"]))
    api.register_render(project, "pudding", source, select=True)
    assert "selected" not in PageState(project, "pudding").panel("p1")["production"]


def test_register_reuses_f9_destination_boundary_check(project: Path) -> None:
    source = image_file(project.parent / "worker.png")
    outside = project.parent / "outside"
    outside.mkdir()
    link = project / "pages/pudding/renders"
    link.parent.mkdir(parents=True)
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        if os.name != "nt":
            raise
        import _winapi  # noqa: PLC0415 -- Windows junction needs no symlink privilege

        _winapi.CreateJunction(str(outside), str(link))
    with pytest.raises(ProductionError, match="路径"):
        api.register_render(project, "pudding", source)
    assert not list(outside.iterdir())
    assert "production" not in read_json(project / "pages/pudding.json")


def test_register_panel_selection_rejects_concurrent_base_change(
    project: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = image_file(project.parent / "worker.png")
    api.register_render(project, "pudding", source, select=True)
    other = api.register_render(project, "pudding", source)
    import_render = api._import_render  # noqa: SLF001 -- controlled concurrent import boundary
    copied = []

    def switching_import(state: PageState, image_path: Path, folder: Path) -> Path:
        destination = import_render(state, image_path, folder)
        copied.append(destination)
        api.pick_render(project, "pudding", other["path"])
        return destination

    monkeypatch.setattr(api, "_import_render", switching_import)
    with pytest.raises(ProductionError, match="冲突"):
        api.register_render(project, "pudding", source, panel_id="p1", select=True)
    state = PageState(project, "pudding")
    assert state.base() == Path(other["path"])
    assert "selected" not in state.panel("p1").get("production", {})
    assert copied[0].is_file()


@pytest.mark.parametrize("change", ["delete", "mode"])
def test_register_rejects_concurrent_layer_removal(
    project: Path,
    monkeypatch: pytest.MonkeyPatch,
    change: str,
) -> None:
    source = image_file(project.parent / "worker.png", alpha=True)
    page = project / "pages/pudding.json"
    raw = read_json(page)
    raw["overlays"] = [{"id": "layer", "mode": "layer", "rect": {"x": 0, "y": 0, "w": 32, "h": 32}}]
    write_json(page, raw)
    import_render = api._import_render  # noqa: SLF001 -- controlled concurrent import boundary

    def editing_import(state: PageState, image_path: Path, folder: Path) -> Path:
        destination = import_render(state, image_path, folder)
        latest = read_json(page)
        if change == "delete":
            latest["overlays"] = []
        else:
            latest["overlays"][0]["mode"] = "inline"
        write_json(page, latest)
        return destination

    monkeypatch.setattr(api, "_import_render", editing_import)
    with pytest.raises(ProductionError, match="冲突"):
        api.register_render(project, "pudding", source, overlay_id="layer", select=True)
    assert "layer" not in read_json(page).get("production", {}).get("overlays", {})


@pytest.mark.parametrize(
    "options",
    [
        {"panel_id": "missing"},
        {"overlay_id": "missing"},
        {"panel_id": "p1", "overlay_id": "layer"},
        {"seed": -1},
    ],
)
def test_register_rejects_invalid_target_or_seed(project: Path, options: dict) -> None:
    source = image_file(project.parent / "worker.png")
    with pytest.raises(ProductionError):
        api.register_render(project, "pudding", source, **options)


def test_register_cli_json(project: Path, capsys: pytest.CaptureFixture[str]) -> None:
    source = image_file(project.parent / "worker.png")
    assert (
        main(
            [
                "register-render",
                "pudding",
                str(source),
                "--project",
                str(project),
                "--select",
                "--seed",
                "22",
                "--source",
                "hub-worker",
                "--json",
            ]
        )
        == 0
    )
    result = json.loads(capsys.readouterr().out)
    assert result["seed"] == 22
    assert result["source"] == "hub-worker"
    assert PageState(project, "pudding").base() == Path(result["path"])
