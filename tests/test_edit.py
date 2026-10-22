from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from importlib.resources import files
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.request import urlopen

import pytest

from soda_storyboard.cli import main
from soda_storyboard.edit import health
from soda_storyboard.io import read_json, write_json
from soda_storyboard.web_build import source_hash

if TYPE_CHECKING:
    from collections.abc import Iterator

# Fixed Python argv and loopback-only URLs exercise actual process lifetimes.
# ruff: noqa: S603, S310

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def project(tmp_path: Path) -> Iterator[Path]:
    root = tmp_path / "有空格的 story"
    # Example projects may contain ignored runtime files from a manual editor session.
    shutil.copytree(ROOT / "examples/pudding", root, ignore=shutil.ignore_patterns(".soda"))
    try:
        yield root
    finally:
        main(["edit", str(root), "--stop", "--json"])


def run(root: Path, *options: str) -> dict:
    result = subprocess.run(
        [sys.executable, "-m", "soda_storyboard", "edit", *options, "--json"],
        cwd=root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=20,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout
    return json.loads(result.stdout)


def test_detach_reuse_page_health_and_stop(project: Path) -> None:
    started = run(project, "--port", "0", "--detach", "--no-browser", "--page", "pudding")
    assert started["reused"] is False
    assert started["pid"] != os.getpid()
    assert started["url"] == f"http://127.0.0.1:{started['port']}/#page=pudding"
    info = health(started["port"])
    assert info["service"] == "soda-storyboard"
    assert info["version"]
    assert Path(info["project_dir"]) == project.resolve()
    assert info["pid"] == started["pid"]
    record = read_json(project / ".soda/server.json")
    assert record == {**info, "port": started["port"]}
    assert (project / ".soda/.gitignore").read_text().startswith("*\n")
    with urlopen(started["url"], timeout=3) as response:
        assert response.status == 200
        assert "Soda Storyboard 分镜编辑器" in response.read().decode()
    again = run(project, "--port", "0", "--detach", "--no-browser", "--page", "pudding")
    assert again == {**started, "reused": True}
    assert run(project, "--stop")["stopped"] is True
    assert not health(started["port"])
    with socket.socket() as sock:
        if os.name != "nt":
            # Linux keeps closed connections in TIME_WAIT; on Windows this flag could steal a live port.
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", started["port"]))
    assert not (project / ".soda/server.json").exists()


def test_occupied_non_http_port_selects_free_port(project: Path) -> None:
    with socket.socket() as occupied:
        occupied.bind(("127.0.0.1", 0))
        occupied.listen()
        port = occupied.getsockname()[1]
        result = run(project, "--port", str(port), "--detach", "--no-browser")
        assert result["port"] != port
        assert result["reused"] is False
        assert health(result["port"])["pid"] == result["pid"]


def test_other_project_service_is_preserved(project: Path, tmp_path: Path) -> None:
    other = tmp_path / "other"
    shutil.copytree(ROOT / "examples/pudding", other, ignore=shutil.ignore_patterns(".soda"))
    first = run(project, "--port", "0", "--detach", "--no-browser")
    try:
        second = run(other, "--port", str(first["port"]), "--detach", "--no-browser")
        assert second["port"] != first["port"]
        assert second["pid"] != first["pid"]
        assert run(other, "--stop")["stopped"]
        assert health(first["port"])["pid"] == first["pid"]
        # A copied state file cannot authorize killing another project's process.
        write_json(other / ".soda/server.json", read_json(project / ".soda/server.json"))
        assert not run(other, "--stop")["stopped"]
        assert health(first["port"])["pid"] == first["pid"]
    finally:
        run(other, "--stop")


@pytest.mark.parametrize("key", ["pid", "instance_id"])
def test_stop_rejects_stale_identity(project: Path, key: str) -> None:
    first = run(project, "--port", "0", "--detach", "--no-browser")
    path = project / ".soda/server.json"
    state = read_json(path)
    write_json(path, {**state, key: 1 if key == "pid" else "old-instance"})
    try:
        assert not run(project, "--stop")["stopped"]
        assert health(first["port"])["pid"] == first["pid"]
    finally:
        write_json(path, state)


def test_browser_open_only_when_requested(project: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    first = run(project, "--port", "0", "--detach", "--no-browser")
    opened = []
    monkeypatch.setattr("soda_storyboard.edit.webbrowser.open", opened.append)
    assert main(["edit", str(project), "--page", "pudding", "--json"]) == 0
    assert opened == [first["url"] + "#page=pudding"]
    assert main(["edit", str(project), "--no-browser", "--json"]) == 0
    assert len(opened) == 1


@pytest.mark.parametrize("copied_state", [False, True], ids=["clean-project", "copied-runtime-state"])
def test_foreground_waits_until_stopped(project: Path, *, copied_state: bool) -> None:
    state_path = project / ".soda/server.json"
    if copied_state:
        write_json(
            state_path,
            {
                "project_dir": str(ROOT / "examples/pudding"),
                "port": 0,
                "pid": os.getpid(),
                "instance_id": "copied-runtime-state",
            },
        )
    with (
        subprocess.Popen(
            [
                sys.executable,
                "-m",
                "soda_storyboard",
                "edit",
                str(project),
                "--port",
                "0",
                "--no-browser",
                "--json",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        ) as process,
        ThreadPoolExecutor(max_workers=1) as output,
    ):
        try:
            # The CLI prints readiness only after a successful health identity check
            # and publishing its state. A copied server.json is not a ready signal.
            assert process.stdout is not None
            ready = json.loads(output.submit(process.stdout.readline).result(timeout=10))
            info = health(ready["port"])
            assert ready["reused"] is False
            assert Path(info["project_dir"]) == project.resolve()
            assert ready["pid"] == info["pid"] != process.pid
            assert read_json(state_path) == {**info, "port": ready["port"]}
            assert process.poll() is None
            assert run(project, "--stop")["stopped"]
            _, stderr = process.communicate(timeout=5)
            assert process.returncode == 0, stderr
        finally:
            if process.poll() is None:
                run(project, "--stop")
                process.terminate()
                process.wait(timeout=5)


def test_init_ignores_runtime_state(tmp_path: Path) -> None:
    assert main(["init", str(tmp_path / "new"), "--json"]) == 0
    assert (tmp_path / "new/.soda/.gitignore").read_text() == "*\n!.gitignore\n"


def test_malformed_state_and_invalid_page(project: Path, capsys: pytest.CaptureFixture) -> None:
    write_json(project / ".soda/server.json", {"port": {"bad": "data"}})
    started = run(project, "--port", "0", "--detach", "--no-browser")
    assert started["reused"] is False
    assert main(["edit", str(project), "--page", "../bad", "--json"]) == 2
    assert "error" in json.loads(capsys.readouterr().out)


def test_failed_open_cleans_up_started_service(project: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def broken_browser(_url: str) -> None:
        message = "browser failed"
        raise OSError(message)

    monkeypatch.setattr("soda_storyboard.edit.webbrowser.open", broken_browser)
    assert main(["edit", str(project), "--port", "0", "--detach", "--json"]) == 2
    assert not (project / ".soda/server.json").exists()


def test_packaged_editor_resources_and_fingerprint() -> None:
    web = files("soda_storyboard").joinpath("web")
    assert "Soda Storyboard 分镜编辑器" in web.joinpath("index.html").read_text(encoding="utf-8")
    info = json.loads(web.joinpath("build-info.json").read_text(encoding="utf-8"))
    assert info["version"] == "0.3.0"
    editor = ROOT / "editor"
    if not (editor / "src").is_dir():
        pytest.skip("Installed package has no frontend source tree")
    assert info["source_hash"] == source_hash(editor), (
        "前端源码已改变, 请运行 uv run python scripts/build_editor.py"
    )


def test_fingerprint_detects_changes_and_ignores_line_endings(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    code = tmp_path / "src/App.tsx"
    code.write_bytes(b"hello\nworld\n")
    initial = source_hash(tmp_path)
    code.write_bytes(b"hello\r\nworld\r\n")
    assert source_hash(tmp_path) == initial
    code.write_text("changed", encoding="utf-8")
    assert source_hash(tmp_path) != initial
