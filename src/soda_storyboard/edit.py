"""Start, reuse and stop the local editor without requiring a remembered command."""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import time
import uuid
import webbrowser
from http import HTTPStatus
from http.client import HTTPConnection, HTTPException
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import quote

from .io import read_json, write_json
from .server.store import Store

if TYPE_CHECKING:
    import argparse

# All network requests target a constructed loopback URL; argv uses this interpreter.
# ruff: noqa: S603, T201, RUF001

MAX_PORT = 65535


def health(port: int) -> dict:
    if type(port) is not int or not 1 <= port <= MAX_PORT:
        return {}
    try:
        # Direct loopback connection: no proxies or redirects to another host.
        connection = HTTPConnection("127.0.0.1", port, timeout=0.3)
        try:
            connection.request("GET", "/api/health")
            response = connection.getresponse()
            if response.status != HTTPStatus.OK:
                return {}
            value = json.loads(response.read(16384))
        finally:
            connection.close()
        if (
            isinstance(value, dict)
            and value.get("service") == "soda-storyboard"
            and type(value.get("pid")) is int
            and value["pid"] > 0
            and isinstance(value.get("project_dir"), str)
            and isinstance(value.get("instance_id"), str)
            and value["instance_id"]
        ):
            return value
    except (OSError, ValueError, HTTPException):
        pass
    return {}


def same_project(info: dict, root: Path) -> bool:
    return bool(info) and Path(info["project_dir"]).resolve() == root


def read_state(path: Path) -> dict:
    try:
        return read_json(path)
    except (OSError, ValueError):
        return {}


def write_state(path: Path, port: int, info: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ignore = path.parent / ".gitignore"
    if not ignore.exists():
        ignore.write_text("*\n!.gitignore\n", encoding="utf-8")
    temporary = path.with_suffix(f".{os.getpid()}.tmp")
    write_json(temporary, {**info, "port": port})
    temporary.replace(path)


def matches(info: dict, state: dict, root: Path) -> bool:
    return same_project(info, root) and all(info.get(key) == state.get(key) for key in ("pid", "instance_id"))


def stop(root: Path, state_path: Path) -> dict:
    state = read_state(state_path)
    port = state.get("port", 0)
    info = health(port)
    if not matches(info, state, root):
        return {"stopped": False, "message": "未找到可核对的本项目服务，未结束任何进程。"}
    os.kill(info["pid"], signal.SIGTERM)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if not matches(health(port), state, root):
            if read_state(state_path) == state:
                state_path.unlink(missing_ok=True)
            return {"stopped": True, "port": port, "pid": info["pid"], "message": "编辑器服务已停止。"}
        time.sleep(0.05)
    message = "服务尚未停止，请稍后重试 --stop。"
    raise ValueError(message)


def available_port(preferred: int) -> int:
    with socket.socket() as sock:
        try:
            sock.bind(("127.0.0.1", preferred))
        except OSError:
            sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def launch(root: Path, port: int, *, detach: bool) -> tuple[subprocess.Popen, int, dict]:
    options = {}
    if detach:
        if os.name == "nt":
            options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        else:
            options["start_new_session"] = True
    # Retry a bind race: another process can take the port after the probe closes.
    for _ in range(5):
        selected = available_port(port)
        instance_id = uuid.uuid4().hex
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "soda_storyboard.server.app",
                str(root),
                "--port",
                str(selected),
                "--instance-id",
                instance_id,
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            **options,
        )
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and process.poll() is None:
            info = health(selected)
            if same_project(info, root) and info["instance_id"] == instance_id:
                return process, selected, info
            time.sleep(0.05)
        if process.poll() is None:
            process.terminate()
        process.wait(timeout=5)
    message = "编辑器启动失败：服务未能在本地端口就绪。"
    raise ValueError(message)


def command_edit(args: argparse.Namespace) -> int:  # noqa: C901, PLR0912 -- CLI lifecycle branches
    store = Store(Path(args.directory))
    root = store.root
    state_path = store.path(".soda/server.json")
    if args.stop:
        result = stop(root, state_path)
        print(json.dumps(result, ensure_ascii=False) if args.json else result["message"])
        return 0
    if not 0 <= args.port <= MAX_PORT:
        message = "port 必须在 0 到 65535 之间（0 表示自动分配）。"
        raise ValueError(message)
    if args.page:
        store.page(args.page)
    state = read_state(state_path)
    process = None
    reused = False
    for port in (state.get("port", 0), args.port):
        info = health(port)
        if same_project(info, root):
            reused = True
            break
    else:
        process, port, info = launch(root, args.port, detach=args.detach)
    try:
        write_state(state_path, port, info)
        url = f"http://127.0.0.1:{port}/"
        if args.page:
            url += f"#page={quote(args.page, safe='')}"
        result = {"url": url, "port": port, "pid": info["pid"], "reused": reused}
        print(json.dumps(result, ensure_ascii=False) if args.json else url, flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        if process is not None and not args.detach:
            try:
                process.wait()
            except KeyboardInterrupt:
                stop(root, state_path)
                process.wait(timeout=5)
    except BaseException:
        if process is not None and process.poll() is None:
            # Windows venv launchers have a different PID from their interpreter.
            if matches(health(port), info, root):
                os.kill(info["pid"], signal.SIGTERM)
            else:
                process.terminate()
            process.wait(timeout=5)
        raise
    finally:
        if process is not None and process.poll() is not None and matches(read_state(state_path), info, root):
            state_path.unlink(missing_ok=True)
    return 0


def register_command(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser("edit", help="打开网页分镜编辑器")
    parser.add_argument("directory", nargs="?", default=".")
    parser.add_argument("--page")
    parser.add_argument("--port", type=int, default=8780)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--detach", action="store_true")
    parser.add_argument("--stop", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.set_defaults(func=command_edit)
