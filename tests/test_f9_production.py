"""Regression coverage for persisted production paths and concurrent writeback."""

from __future__ import annotations

import copy
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
import test_server_http as server_tests
from PIL import Image

from soda_storyboard.io import read_json, write_json
from soda_storyboard.production import api
from soda_storyboard.production.errors import ProductionError
from soda_storyboard.production.state import PageState

if TYPE_CHECKING:
    from test_server_http import Client

client = server_tests.client
EXAMPLE = Path(__file__).resolve().parents[1] / "examples/pudding"
PAGE_URL = "/api/pages/pudding"


@pytest.fixture
def project(tmp_path: Path) -> Path:
    target = tmp_path / "project"
    shutil.copytree(EXAMPLE, target)
    return target


def test_http_rejects_production_file_boundary_bypass(client: Client) -> None:
    secret = client.root.parent / "private.txt"
    secret.write_text("private production boundary regression", encoding="utf-8")
    page, headers = client.page()
    page["production"] = {"selected_render": str(secret)}
    status, _, result = client.call("PUT", PAGE_URL, page, headers)
    # Exercise the complete former PUT -> export -> download chain even when
    # validation refuses the write. No generated job or real backend is used.
    export_status, _, job = client.call("POST", "/api/export", {"page_ids": ["pudding"], "format": "png"})
    assert export_status == 202
    finished = client.wait_job(job["id"])
    download_status, _, download = client.call("GET", "/api/files/exports/pudding.png")
    assert status == 422, result
    assert finished["status"] == "failed"
    assert download_status == 404
    assert download != secret.read_bytes()


@pytest.mark.parametrize(
    "path",
    [
        "../private.png",
        "pages/../../private.png",
        "C:/private.png",
        "C:private.png",
        "//host/share/a.png",
        "/private.png",
    ],
)
def test_persisted_production_paths_reject_unsafe_syntax(project: Path, path: str) -> None:
    page_path = project / "pages/pudding.json"
    raw = read_json(page_path)
    raw["production"] = {"selected_render": path}
    write_json(page_path, raw)
    with pytest.raises(ProductionError, match="路径"):
        PageState(project, "pudding")


@pytest.mark.parametrize(
    "metadata",
    [
        {"renders": [{"path": "../private.png"}]},
        {"candidate_sheet": "../private.png"},
        {"composed": {"path": "../private.png", "underlay": "pages/safe.png"}},
        {"lettered": {"path": "pages/safe.png", "font": "../private.ttf"}},
        {"overlays": {"hero": {"path": "../private.png"}}},
        {"split": {"path": "pages/safe.png", "mask": "../private.png"}},
        {"renders": [{"path": "pages/safe.png", "source_render": "../private.png"}]},
        {"selected": "../private.png"},
    ],
)
def test_all_production_record_paths_are_checked(project: Path, metadata: dict) -> None:
    page_path = project / "pages/pudding.json"
    raw = read_json(page_path)
    raw["panels"][0]["production"] = metadata
    write_json(page_path, raw)
    with pytest.raises(ProductionError, match="路径"):
        PageState(project, "pudding")


def test_production_paths_reject_symlink_escape(project: Path) -> None:
    outside = project.parent / "outside"
    outside.mkdir()
    Image.new("RGB", (2, 2)).save(outside / "image.png")
    link = project / "linked"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        if os.name != "nt":
            raise
        import _winapi  # noqa: PLC0415 -- Windows junctions do not need symlink privilege

        _winapi.CreateJunction(str(outside), str(link))
    page_path = project / "pages/pudding.json"
    raw = read_json(page_path)
    raw["production"] = {"selected_render": "linked/image.png"}
    write_json(page_path, raw)
    with pytest.raises(ProductionError, match="路径"):
        api.export(project, ["pudding"])
    assert not (project / "exports/pudding.png").exists()


def test_png_export_rejects_non_image_source(project: Path) -> None:
    source = project / "not-an-image.png"
    source.write_text("this is not a PNG", encoding="utf-8")
    path = project / "pages/pudding.json"
    raw = read_json(path)
    raw["production"] = {"selected_render": source.name}
    write_json(path, raw)
    with pytest.raises(ProductionError, match="图片"):
        api.export(project, ["pudding"])
    assert not (project / "exports/pudding.png").exists()


def test_http_rejects_overlay_image_path_escape(client: Client) -> None:
    page, headers = client.page()
    page["overlays"] = [
        {
            "id": "hero",
            "character_id": "older",
            "mode": "layer",
            "rect": {"x": 0, "y": 0, "w": 100, "h": 100},
            "image_path": "../private.png",
        }
    ]
    assert client.call("PUT", PAGE_URL, page, headers)[0] == 422


def test_lettering_keeps_imported_font_in_project(project: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    font = project.parent / "outside-font.ttf"
    font.write_bytes(b"font data consumed by the mocked lettering renderer")
    path = project / "pages/pudding.json"
    raw = read_json(path)
    raw["production"] = {"selected_render": "base.png"}
    Image.new("RGB", (16, 16), "white").save(project / "base.png")
    write_json(path, raw)
    monkeypatch.setattr(api, "letter_image", lambda image, _page, **_options: image)
    api.letter_with_options(project, "pudding", font=font)
    stored_font = read_json(path)["production"]["lettered"]["font"]
    assert not Path(stored_font).is_absolute()
    assert (project / stored_font).resolve().is_relative_to(project.resolve())
    assert (project / stored_font).read_bytes() == font.read_bytes()
    api.letter_with_options(project, "pudding", font=stored_font)


def test_generation_writeback_preserves_external_dialogue_edit(
    project: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = project / "pages/pudding.json"

    class EditingClient:
        @staticmethod
        def run(_graph: dict, output: Path, **_options: object) -> None:
            script = """
import sys
from pathlib import Path
from soda_storyboard.io import read_json, write_json
path = Path(sys.argv[1])
raw = read_json(path)
raw['texts'][0]['text'] = '生成期间编辑器已保存的新台词'
raw['panels'][0]['description'] = '生成期间的新描述'
write_json(path, raw)
"""
            subprocess.run([sys.executable, "-c", script, str(path)], check=True, timeout=10)  # noqa: S603
            output.parent.mkdir(parents=True, exist_ok=True)
            Image.new("RGB", (16, 16), "white").save(output)

    monkeypatch.setattr(PageState, "client", lambda _state: EditingClient())
    generated = api.generate_page(project, "pudding", seeds=1, seed=1)
    latest = read_json(path)
    assert latest["texts"][0]["text"] == "生成期间编辑器已保存的新台词"
    assert latest["panels"][0]["description"] == "生成期间的新描述"
    assert latest["production"]["renders"][0]["seed"] == 1
    assert Path(generated[0]["path"]).is_file()


def test_panel_production_writeback_preserves_latest_page_and_other_records(project: Path) -> None:
    path = project / "pages/pudding.json"
    state = PageState(project, "pudding")
    latest = read_json(path)
    latest["texts"][0]["text"] = "新的文字"
    latest["panels"][0]["production"] = {"split": {"path": "pages/other.png"}}
    latest["production"] = {"renders": [{"path": "pages/external.png"}]}
    write_json(path, latest)
    state.panel("p1").setdefault("production", {})["renders"] = [{"path": "pages/new.png"}]
    state.production["renders"] = [{"path": "pages/task.png"}]
    state.save()
    saved = read_json(path)
    assert saved["texts"] == latest["texts"]
    assert saved["production"]["renders"] == [
        {"path": "pages/external.png"},
        {"path": "pages/task.png"},
    ]
    assert saved["panels"][0]["production"] == {
        "split": {"path": "pages/other.png"},
        "renders": [{"path": "pages/new.png"}],
    }


def test_production_writeback_reports_overlapping_selection_conflict(project: Path) -> None:
    path = project / "pages/pudding.json"
    raw = read_json(path)
    raw["production"] = {"selected_render": "pages/original.png"}
    write_json(path, raw)
    state = PageState(project, "pudding")
    latest = copy.deepcopy(raw)
    latest["production"]["selected_render"] = "pages/external.png"
    write_json(path, latest)
    state.production["selected_render"] = "pages/task.png"
    with pytest.raises(ProductionError, match="冲突"):
        state.save()
    assert read_json(path) == latest


@pytest.mark.parametrize("stage", ["before", "after"])
def test_production_writeback_detects_disk_changes_during_commit(
    project: Path, monkeypatch: pytest.MonkeyPatch, stage: str
) -> None:
    page_path = project / "pages/pudding.json"
    state = PageState(project, "pudding")
    latest = read_json(page_path)
    latest["texts"][0]["text"] = "写入期间的外部编辑"
    state.production["selected_render"] = "pages/generated.png"
    if stage == "before":
        original_write = Path.write_text

        def writing(path: Path, *args: object, **kwargs: object) -> int:
            result = original_write(path, *args, **kwargs)
            if path.suffix == ".tmp":
                write_json(page_path, latest)
            return result

        monkeypatch.setattr(Path, "write_text", writing)
    else:
        original_replace = Path.replace

        def replacing(path: Path, target: Path) -> Path:
            result = original_replace(path, target)
            if target == page_path:
                write_json(page_path, latest)
            return result

        monkeypatch.setattr(Path, "replace", replacing)
    with pytest.raises(ProductionError, match="冲突"):
        state.save()
    assert read_json(page_path) == latest
