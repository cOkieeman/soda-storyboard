"""Standard-library REST/SSE server, restricted to loopback interfaces."""

from __future__ import annotations

import argparse
import importlib
import ipaddress
import json
import mimetypes
import os
import queue
import socket
import sys
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version
from importlib.resources import files
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, unquote, urlsplit

from soda_storyboard.io import load_page
from soda_storyboard.validation import validate_page

from .common import APIError, identifier, inside, json_default, snapshot
from .events import IMAGE_TYPES, Events
from .jobs import Jobs
from .store import Store

if TYPE_CHECKING:
    from collections.abc import Callable

# HTTP routing is intentionally a JSON boundary with explicit method dispatch.
# BaseHTTPRequestHandler fixes mixed-case method names; route lengths are protocol constants.
# ruff: noqa: ANN401, N815, RUF001, PLR2004

DEV_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}
MAX_BODY = 4 * 1024 * 1024


def loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def production() -> Any:
    try:
        return importlib.import_module("soda_storyboard.production.api")
    except ImportError as exc:
        raise APIError(501, "出图功能尚未安装") from exc


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(
        self,
        project_dir: str | Path,
        port: int = 8780,
        host: str = "127.0.0.1",
        static: str | Path | None = None,
    ) -> None:
        if not loopback(host):
            raise APIError(400, "只允许监听回环地址，例如 127.0.0.1 或 ::1")
        if ":" in host:
            self.address_family = socket.AF_INET6
        self.store = Store(Path(project_dir))
        self.instance_id = uuid.uuid4().hex
        self.static = (
            Path(static).resolve() if static else Path(str(files("soda_storyboard").joinpath("web")))
        )
        # Bind before starting background threads, so a failed bind leaks no workers.
        super().__init__((host, port), Handler)
        self.events = Events(self.store.root)
        self.jobs = Jobs(self.events)

    def server_close(self) -> None:
        if hasattr(self, "jobs"):
            self.jobs.close()
            self.events.close()
        super().server_close()


class Handler(BaseHTTPRequestHandler):
    server: Server
    protocol_version = "HTTP/1.1"

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(15)
        self.cors_origin: str | None = None

    def log_message(self, _format: str, *_args: Any) -> None:
        # Do not log request bodies, query parameters or project configuration.
        return

    def guards(self) -> None:
        host = self.headers.get("Host", "")
        try:
            parsed = urlsplit(f"http://{host}")
            valid = (
                parsed.hostname is not None
                and loopback(parsed.hostname)
                and parsed.port == self.server.server_port
                and not parsed.username
                and not parsed.path
                and not parsed.query
                and not parsed.fragment
            )
        except ValueError:
            valid = False
        if not valid:
            raise APIError(403, "Host 必须是本地服务地址")
        origin = self.headers.get("Origin")
        if origin is not None:
            if origin not in DEV_ORIGINS and origin != f"http://{host}":
                raise APIError(403, "不允许此来源访问本地服务")
            self.cors_origin = origin

    def send(
        self, status: int, value: Any, content_type: str = "application/json; charset=utf-8", **headers: str
    ) -> None:
        data = (
            value
            if isinstance(value, bytes)
            else json.dumps(value, ensure_ascii=False, default=json_default, allow_nan=False).encode("utf-8")
        )
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Vary", "Origin")
        if self.cors_origin:
            self.send_header("Access-Control-Allow-Origin", self.cors_origin)
            self.send_header("Access-Control-Expose-Headers", "ETag")
        for name, val in headers.items():
            self.send_header(name.replace("_", "-"), val)
        self.end_headers()
        self.wfile.write(data)

    def body(self) -> dict:
        if self.headers.get("Transfer-Encoding"):
            raise APIError(400, "不支持分块请求，请发送带 Content-Length 的 JSON")
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 <= length <= MAX_BODY:
            raise APIError(400, "JSON 请求体不能超过 4 MiB")
        if not length:
            return {}
        if self.headers.get_content_type() != "application/json":
            raise APIError(400, "请求体必须是 application/json")
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise APIError(400, "请求体不完整")
        value = json.loads(raw.decode("utf-8"), parse_constant=self.reject_constant)
        if not isinstance(value, dict):
            raise APIError(400, "请求 JSON 必须是对象")
        return value

    @staticmethod
    def reject_constant(value: str) -> None:
        raise APIError(400, f"JSON 不允许 {value}")

    def handle_request(self) -> None:  # noqa: C901 -- one error boundary for HTTP requests
        self.cors_origin = None
        try:
            self.guards()
            if self.command == "OPTIONS":
                self.send(
                    204,
                    b"",
                    Access_Control_Allow_Methods="GET, POST, PUT, PATCH, DELETE, OPTIONS",
                    Access_Control_Allow_Headers="Content-Type, If-Match, X-Client-Id",
                    Access_Control_Max_Age="600",
                )
                return
            parsed = urlsplit(self.path)
            path = unquote(parsed.path, errors="strict")
            options = parse_qs(parsed.query)
            if path == "/api/layout-extract" and self.command == "POST":
                from .extraction import upload  # noqa: PLC0415 -- optional upload endpoint

                upload(self)
                return
            body = self.body() if self.command in {"POST", "PUT", "PATCH", "DELETE"} else {}
            if path == "/api/events" and self.command == "GET":
                self.sse()
                return
            if not path.startswith("/api/"):
                if self.command != "GET":
                    self.unsupported_static_method()
                self.static_file(path)
                return
            self.route(path, options, body)
        except APIError as exc:
            self.close_connection = True
            headers = {"ETag": exc.payload["version"]} if "version" in exc.payload else {}
            self.send(exc.status, exc.payload, **headers)
        except FileNotFoundError:
            self.close_connection = True
            self.send(404, {"error": "文件或资源不存在"})
        except (ValueError, TypeError, KeyError, AttributeError, OverflowError) as exc:
            self.close_connection = True
            self.send(400, {"error": f"请求参数或项目数据有误：{exc}"})
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True
        except OSError as exc:
            self.close_connection = True
            self.send(500, {"error": f"文件操作失败：{exc}"})
        except Exception as exc:  # noqa: BLE001 -- optional production API failures must produce JSON
            self.close_connection = True
            self.send(500, {"error": f"服务操作失败：{exc}"})

    do_GET = handle_request
    do_POST = handle_request
    do_PUT = handle_request
    do_PATCH = handle_request
    do_DELETE = handle_request
    do_OPTIONS = handle_request

    @staticmethod
    def unsupported_static_method() -> None:
        raise APIError(405, "此路径只支持 GET")

    def json_response(self, result: dict, status: int = 200) -> None:
        headers = {"ETag": result["version"]} if "version" in result else {}
        self.send(status, result, **headers)

    def route(self, path: str, query: dict, body: dict) -> None:  # noqa: C901, PLR0912, PLR0915 -- explicit route table
        store = self.server.store
        method = self.command
        if path == "/api/health" and method == "GET":
            self.send(
                200,
                {
                    "service": "soda-storyboard",
                    "version": version("soda-storyboard"),
                    "project_dir": str(store.root),
                    "pid": os.getpid(),
                    "instance_id": self.server.instance_id,
                },
            )
        elif path == "/api/project" and method == "GET":
            self.send(200, store.project())
        elif path == "/api/project" and method == "PATCH":
            self.send(200, store.patch_project(body))
        elif path == "/api/pages" and method == "GET":
            self.send(200, {"pages": store.pages()})
        elif path == "/api/pages" and method == "POST":
            self.json_response(store.create_page(body), 201)
        elif path == "/api/characters" and method == "GET":
            self.send(200, {"characters": store.characters()})
        elif path == "/api/characters" and method == "POST":
            self.send(201, store.save_character(body))
        elif path.startswith("/api/characters/") and len(path.split("/")) == 4:
            character_id = identifier(path.split("/")[3])
            if method == "GET":
                character, file_version = snapshot(store.path(f"characters/{character_id}.json"))
                self.json_response({"character": character, "version": file_version})
            elif method == "PUT":
                client_id = self.editor_client_id()
                relative = f"characters/{character_id}.json"
                with self.server.events.lock:
                    result = store.save_character(body, character_id, self.headers.get("If-Match"))
                    _, file_version = snapshot(store.path(relative))
                    self.server.events.editor_changed(relative, file_version, client_id)
                self.json_response(result)
            else:
                raise APIError(405, "角色接口只支持 GET、PUT")
        elif path == "/api/templates" and method == "GET":
            from soda_storyboard.templates import builtin_templates  # noqa: PLC0415

            count = int(query["panels"][0]) if "panels" in query else None
            if count is not None and not 1 <= count <= 100:
                raise APIError(400, "panels 必须在 1 到 100 之间")
            self.send(200, {"templates": builtin_templates(count)})
        elif path == "/api/templates" and method == "POST":
            from .extraction import save  # noqa: PLC0415 -- additive template endpoint

            save(self, body)
        elif path.startswith("/api/files/") and method == "GET":
            self.project_file(path.removeprefix("/api/files/"))
        elif path.startswith("/api/jobs/"):
            parts = path.split("/")
            if len(parts) == 4 and method == "GET":
                self.send(200, self.server.jobs.get(parts[3]))
            elif len(parts) == 5 and parts[4] == "cancel" and method == "POST":
                self.send(200, self.server.jobs.cancel(parts[3]))
            else:
                raise APIError(404, "任务接口不存在")
        elif path == "/api/export" and method == "POST":
            self.production_route(None, "export", body)
        elif path.startswith("/api/pages/"):
            self.page_route(path, query, body)
        else:
            raise APIError(404, "接口不存在或请求方法不支持")

    def editor_client_id(self) -> str | None:
        client_id = self.headers.get("X-Client-Id")
        if client_id is not None and len(client_id) > 128:
            raise APIError(400, "X-Client-Id 最多 128 字符")
        return client_id

    def page_route(self, path: str, query: dict, body: dict) -> None:  # noqa: C901, PLR0912 -- page action dispatch
        store = self.server.store
        parts = path.split("/")
        page_id = identifier(parts[3])
        method = self.command
        version = self.headers.get("If-Match")
        if len(parts) == 4:
            if method == "GET":
                self.json_response(store.page(page_id))
            elif method == "PUT":
                client_id = self.editor_client_id()
                with self.server.events.lock:
                    result = store.save(page_id, body, version)
                    self.server.events.editor_changed(f"pages/{page_id}.json", result["version"], client_id)
                self.json_response(result)
            elif method == "DELETE":
                self.send(200, store.delete(page_id, version))
            else:
                raise APIError(405, "页面接口只支持 GET、PUT、DELETE")
            return
        action = parts[4]
        if len(parts) == 7 and action == "panels" and parts[6] == "redraw" and method == "POST":
            self.production_route(page_id, "redraw", body, identifier(parts[5]))
            return
        if len(parts) != 5:
            raise APIError(404, "页面接口不存在")
        if action == "sketch-geometry" and method == "GET":
            self.json_response(store.sketch_geometry(page_id))
        elif action == "validate" and method == "POST":
            page = load_page(store.page_path(page_id))
            self.send(
                200,
                validate_page(
                    page,
                    store.character_map(),
                    max_dialogue_chars=body.get("max_dialogue_chars", 20),
                    geometry_tolerance=body.get("geometry_tolerance"),
                ).to_dict(),
            )
        elif action == "preview.png" and method == "GET":
            self.send(
                200,
                store.preview(
                    page_id, query.get("style", ["sketch"])[0], float(query.get("scale", ["1"])[0])
                ),
                "image/png",
            )
        elif action == "compile" and method == "POST":
            self.send(200, store.compile(page_id, body))
        elif action == "caption-preview" and method == "POST":
            self.send(200, store.caption_preview(page_id, body))
        elif action == "layout-suggest" and method == "POST":
            self.json_response(
                store.suggest(
                    page_id, {**body, "style": query.get("style", [body.get("style", "sketch")])[0]}
                )
            )
        elif action == "layout-apply" and method == "POST":
            self.json_response(store.apply(page_id, body.get("candidate_id", ""), version))
        elif action == "skew" and method == "POST":
            self.json_response(store.skew(page_id, body, version))
        elif (action in {"renders", "plan"} and method == "GET") or (
            action in {"generate", "pick", "compose", "letter"} and method == "POST"
        ):
            self.production_route(page_id, action, body)
        else:
            raise APIError(404, "页面接口不存在或请求方法不支持")

    @staticmethod
    def fields(body: dict, allowed: set[str]) -> None:
        if body.keys() - allowed:
            raise APIError(400, "不支持的参数", fields=sorted(body.keys() - allowed))

    def production_route(  # noqa: C901, PLR0912, PLR0915 -- fixed P3 public signatures and task reservation
        self, page_id: str | None, action: str, body: dict, panel_id: str | None = None
    ) -> None:
        api = production()
        store = self.server.store
        if page_id is not None:
            store.page(page_id)
            store.path(f"pages/{page_id}/renders")
        if action == "renders":
            self.send(200, store.renders(page_id))
            return
        if action == "plan":
            self.send(200, api.production_plan(store.root, page_id))
            return
        if action == "generate":
            self.fields(body, {"seeds", "preset", "model", "lora"})
            seeds = body.get("seeds", 4)
            if (
                type(seeds) is not int
                or not 1 <= seeds <= 32
                or body.get("preset", "draft") not in {"draft", "final"}
            ):
                raise APIError(400, "seeds 必须是 1 到 32 的整数，preset 必须是 draft 或 final")

            def task(progress: Callable) -> Any:
                return api.generate_page(store.root, page_id, progress=progress, **body)
        elif action == "redraw":
            self.fields(body, {"mode", "character_id", "denoise"})
            page = store.page(page_id)["page"]
            if panel_id not in {p["id"] for p in page["panels"]}:
                raise APIError(404, "格子不存在")
            if body.get("mode", "detail") not in {"detail", "swap"}:
                raise APIError(400, "mode 必须是 detail 或 swap")
            if body.get("denoise") is not None and not 0 <= body["denoise"] <= 1:
                raise APIError(400, "denoise 必须在 0 到 1 之间")

            def task(progress: Callable) -> Any:
                return api.redraw_panel(store.root, page_id, panel_id, progress=progress, **body)
        elif action == "pick":
            self.fields(body, {"render_path"})
            render = store.path(body.get("render_path", ""))
            if not render.is_file() or render.suffix.lower() not in IMAGE_TYPES:
                raise APIError(400, "render_path 必须指向项目内已存在的图片")

            def task(_progress: Callable) -> Any:
                return api.pick_render(store.root, page_id, str(render))
        elif action in {"compose", "letter"}:
            self.fields(body, set())
            function = api.compose_page if action == "compose" else api.letter_page

            def task(_progress: Callable) -> Any:
                return function(store.root, page_id)
        else:
            self.fields(body, {"page_ids", "format"})
            fmt = body.get("format", "png")
            page_ids = body.get("page_ids")
            if fmt not in {"png", "pdf"} or (page_ids is not None and not isinstance(page_ids, list)):
                raise APIError(400, "format 必须是 png 或 pdf，page_ids 必须是数组或 null")
            if page_ids is not None:
                for value in page_ids:
                    store.page(identifier(value))

            def task(_progress: Callable) -> Any:
                return api.export(store.root, page_ids=page_ids, fmt=fmt)

        def run(progress: Callable) -> Any:
            # P3 reads a page once, then writes its production state later.
            # Reserve that page while running so editor saves cannot be lost.
            with store.lock:
                if page_id is not None:
                    store.page(page_id)
                    store.production_pages.add(page_id)
            try:
                return task(progress)
            finally:
                with store.lock:
                    if page_id is not None:
                        store.production_pages.discard(page_id)

        result = self.server.jobs.submit(action, run, page_id)
        self.send(202, result, Location=f"/api/jobs/{result['id']}")

    def project_file(self, relative: str) -> None:
        if any(part.startswith(".") and part != ".server" for part in relative.replace("\\", "/").split("/")):
            raise APIError(400, "不允许访问隐藏文件或目录")
        path = self.server.store.path(relative)
        if path.suffix.lower() not in IMAGE_TYPES | {".json"}:
            raise APIError(400, "文件接口只允许读取图片和 JSON")
        content_type = (
            "application/json; charset=utf-8"
            if path.suffix.lower() == ".json"
            else mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        )
        self.send(200, path.read_bytes(), content_type)

    def static_file(self, path: str) -> None:
        target = inside(self.server.static, path.lstrip("/") or "index.html")
        if not target.is_file():
            if path == "/" and not (self.server.static / "index.html").is_file():
                self.send(
                    200,
                    "前端尚未构建；请运行 uv run python scripts/build_editor.py 后重试。".encode(),
                    "text/plain; charset=utf-8",
                )
                return
            raise APIError(404, "前端文件不存在")
        self.send(
            200, target.read_bytes(), mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        )

    def sse(self) -> None:
        client = self.server.events.subscribe()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.send_header("Vary", "Origin")
            if self.cors_origin:
                self.send_header("Access-Control-Allow-Origin", self.cors_origin)
            self.end_headers()
            self.wfile.write(b'event: ready\ndata: {"refresh":true}\n\n')
            self.wfile.flush()
            while not self.server.events.stopped.is_set():
                try:
                    event, data = client.get(timeout=1)
                    payload = json.dumps(data, ensure_ascii=False, default=json_default)
                    self.wfile.write(f"event: {event}\ndata: {payload}\n\n".encode())
                except queue.Empty:
                    self.wfile.write(b": heartbeat\n\n")
                self.wfile.flush()
        except (OSError, ValueError):
            pass
        finally:
            self.server.events.unsubscribe(client)
            self.close_connection = True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Soda Storyboard 本地编辑器服务")
    parser.add_argument("project_dir")
    parser.add_argument("--port", type=int, default=8780)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--static")
    parser.add_argument("--instance-id", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    try:
        server = Server(args.project_dir, args.port, args.host, args.static)
        if args.instance_id:
            server.instance_id = args.instance_id
        host = f"[{args.host}]" if ":" in args.host else args.host
        print(f"编辑器服务：http://{host}:{server.server_port}", flush=True)  # noqa: T201
        try:
            server.serve_forever(poll_interval=0.2)
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
    except (APIError, OSError, ValueError, TypeError, OverflowError) as exc:
        print(f"启动失败：{exc}", file=sys.stderr)  # noqa: T201
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
