"""Real loopback HTTP tests; production is always fake, never ComfyUI."""

from __future__ import annotations

import importlib
import io
import json
import shutil
import sys
import threading
import time
import types
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest
from PIL import Image, ImageDraw

from soda_storyboard.captions import source_hash
from soda_storyboard.compiler import compile_page
from soda_storyboard.io import read_json, write_json
from soda_storyboard.models import Page
from soda_storyboard.server.app import Server, main
from soda_storyboard.server.common import APIError

# Tests intentionally send heterogeneous JSON over a fixed loopback HTTP URL.
# ruff: noqa: ANN401, S310

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "pudding"
PAGE_URL = "/api/pages/pudding"


class Client:
    def __init__(self, server: Server) -> None:
        self.server = server
        self.root = server.store.root
        self.url = f"http://127.0.0.1:{server.server_port}"

    def call(
        self, method: str, path: str, value: Any = None, headers: dict | None = None
    ) -> tuple[int, dict, Any]:
        data = json.dumps(value, ensure_ascii=False).encode() if value is not None else None
        request = Request(
            self.url + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as exc:
            response = exc
        with response:
            payload = response.read()
            if response.headers.get_content_type() == "application/json" and payload:
                payload = json.loads(payload)
            return response.status, dict(response.headers), payload

    def page(self) -> tuple[dict, dict]:
        status, headers, body = self.call("GET", PAGE_URL)
        assert status == 200
        assert headers["ETag"] == body["version"]
        return body["page"], {"If-Match": body["version"]}

    def wait_job(self, job_id: str, states: set[str] | None = None) -> dict:
        states = states or {"completed", "failed", "cancelled"}
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            status, _, job = self.call("GET", f"/api/jobs/{job_id}")
            assert status == 200
            if job["status"] in states:
                return job
            time.sleep(0.01)
        pytest.fail(f"任务未到达状态 {states}: {job}")

    def upload(self, payload: bytes, *, field: str = "image", direction: str = "rtl") -> tuple[int, dict]:
        boundary = "soda-extraction-test"
        data = (
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; '
                'filename="reference.png"\r\nContent-Type: image/png\r\n\r\n'
            ).encode()
            + payload
            + (
                f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="direction"\r\n\r\n'
                f"{direction}\r\n--{boundary}--\r\n"
            ).encode()
        )
        request = Request(
            self.url + "/api/layout-extract",
            data=data,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as exc:
            response = exc
        with response:
            return response.status, json.loads(response.read())


@pytest.fixture
def client(tmp_path: Path) -> Iterator[Client]:
    project = tmp_path / "project"
    shutil.copytree(EXAMPLE, project)
    server = Server(project, port=0, static=tmp_path / "static")
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
    thread.start()
    try:
        yield Client(server)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
        assert not server.events.thread.is_alive()
        assert not server.jobs.worker.is_alive()


def test_layout_extraction_upload_and_save(client: Client) -> None:
    image = Image.new("RGB", (600, 800), "white")
    draw = ImageDraw.Draw(image)
    for box in [(30, 30, 290, 370), (310, 30, 570, 370), (30, 400, 570, 750)]:
        draw.rectangle(box, outline="black", width=4)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    status, result = client.upload(buffer.getvalue())
    assert status == 200
    assert result["panel_count"] == 3
    assert result["panels"][0]["shape"]["x"] == 310
    preview_status, _, preview = client.call("GET", result["preview_url"])
    assert preview_status == 200
    assert Image.open(io.BytesIO(preview)).size == (600, 800)
    status, _, saved = client.call(
        "POST", "/api/templates", {"extraction_id": result["extraction_id"], "name": "Reference"}
    )
    assert status == 201
    assert read_json(client.root / saved["path"])["source"] == "reference"
    assert not (client.root / "reference.png").exists()
    assert list((client.root / "templates").glob("*.png")) == []
    assert client.call("POST", "/api/templates", {"extraction_id": "../outside"})[0] == 400
    assert client.call("POST", "/api/templates", {"extraction_id": "missing"})[0] == 404
    assert (
        client.call("POST", "/api/templates", {"extraction_id": result["extraction_id"], "name": 5})[0] == 400
    )
    assert client.upload(b"not an image")[0] == 400
    assert client.upload(buffer.getvalue(), field="file")[0] == 400
    assert client.upload(buffer.getvalue(), direction="up")[0] == 400
    assert client.call("POST", "/api/layout-extract", {})[0] == 400


def test_project_pages_and_characters(client: Client) -> None:
    status, _, body = client.call("GET", "/api/project")
    assert status == 200
    assert body["project"]["name"] == "布丁争夺战"
    assert body["pages"][0]["id"] == "pudding"
    assert {c["id"] for c in body["characters"]} == {"older", "younger"}
    original = read_json(client.root / "project.json")
    status, _, body = client.call(
        "PATCH", "/api/project", {"name": "布丁续集", "editor_note": "保留未知字段"}
    )
    assert status == 200
    assert body["project"] == {**original, "name": "布丁续集", "editor_note": "保留未知字段"}
    assert client.call("GET", "/api/pages")[2]["pages"][0]["panel_count"] == 5
    status, _, body = client.call("GET", "/api/characters")
    assert status == 200
    assert len(body["characters"]) == 2
    character = client.call("GET", "/api/characters/older")[2]["character"]
    character["display_name"] = "大姐姐"
    assert client.call("PUT", "/api/characters/older", character)[0] == 200
    assert read_json(client.root / "characters/older.json")["age"] == "20-year-old"
    assert client.call("POST", "/api/characters", {"id": "guest", "display_name": "访客"})[0] == 201
    assert client.call("POST", "/api/characters", {"id": "guest"})[0] == 409


def test_caption_preview_compiles_unsaved_changes_without_writing(client: Client) -> None:
    raw, _ = client.page()
    original = (client.root / "pages/pudding.json").read_bytes()
    original_moss = (client.root / "pudding.moss.json").read_bytes()
    raw["panels"][0]["description"] = "妹妹把布丁藏在身后"
    endpoint = PAGE_URL + "/caption-preview"
    status, _, preview = client.call("POST", endpoint, {"page": raw})
    assert status == 200
    first = preview["panels"][0]
    compiled = compile_page(
        client.server.store.render_page("pudding", raw=raw),
        client.server.store.character_map(),
        with_ids=True,
    )
    assert first["caption"] == compiled["items"][0]["caption"]
    assert "妹妹把布丁藏在身后" in first["caption"]
    assert first["caption"].count("14-year-old") == 1
    assert first["custom_override"] is False
    raw["panels"][0]["use_custom_caption"] = True
    overridden = client.call("POST", endpoint, {"page": raw})[2]["panels"][0]
    assert overridden["custom_override"] is True
    assert overridden["caption"] == raw["panels"][0]["caption_en"]
    assert (client.root / "pages/pudding.json").read_bytes() == original
    assert (client.root / "pudding.moss.json").read_bytes() == original_moss
    assert client.call("POST", endpoint, {"page": []})[0] == 400


def test_character_color_conditional_save_rejects_stale_versions(client: Client) -> None:
    endpoint = "/api/characters/older"
    path = client.root / "characters/older.json"
    source = read_json(path)
    source["lora"] = {"path": "role.safetensors", "strength": 0.75, "future": {"keep": True}}
    source["appearance"]["future"] = {"keep": [1, 2]}
    write_json(path, source)
    status, headers, body = client.call("GET", endpoint)
    assert status == 200
    assert headers["ETag"] == body["version"]
    original = body["character"]
    updated = {**original, "sketch_color": "#B44A3A", "future_metadata": {"keep": [1, 2]}}
    status, saved_headers, saved = client.call("PUT", endpoint, updated, {"If-Match": headers["ETag"]})
    assert status == 200
    assert saved_headers["ETag"] == saved["version"]
    assert saved["character"]["lora"] == original["lora"]
    assert saved["character"]["future_metadata"] == {"keep": [1, 2]}
    assert saved["character"]["appearance"] == original["appearance"]
    status, _, rejected = client.call(
        "PUT", endpoint, {**updated, "sketch_color": "#123456"}, {"If-Match": headers["ETag"]}
    )
    assert status == 409
    assert rejected["current"]["sketch_color"] == "#B44A3A"
    assert read_json(client.root / "characters/older.json")["sketch_color"] == "#B44A3A"
    summaries = client.call("GET", "/api/project")[2]["characters"]
    summary = next(character for character in summaries if character["id"] == "older")
    assert summary["sketch_color"] == "#B44A3A"
    # Older callers that omit If-Match retain their existing API contract.
    assert client.call("PUT", endpoint, updated)[0] == 200


def test_page_write_validation_warning_and_conflict(client: Client) -> None:
    page, match = client.page()
    original = (client.root / "pages/pudding.json").read_bytes()
    page["panels"][0]["shape"]["w"] = -1
    status, _, error = client.call("PUT", PAGE_URL, page, match)
    assert status == 422
    assert error["errors"]
    assert (client.root / "pages/pudding.json").read_bytes() == original
    page, match = client.page()
    page["texts"][2]["text"] = "姐姐的这句台词很长" * 6
    page["editor_data"] = {"selected": "p3"}
    status, headers, body = client.call("PUT", PAGE_URL, page, match)
    assert status == 200
    assert any(w["code"] == "dialogue_too_long" for w in body["warnings"])
    assert body["page"]["editor_data"] == {"selected": "p3"}
    assert headers["ETag"] != match["If-Match"]
    status, headers, body = client.call("PUT", PAGE_URL, page, match)
    assert status == 409
    assert headers["ETag"] == body["version"]
    assert body["current"]["editor_data"] == {"selected": "p3"}
    assert client.call("PUT", PAGE_URL, page)[0] == 409


def test_external_change_updates_etag_even_with_same_mtime(client: Client) -> None:
    import os  # noqa: PLC0415

    page, match = client.page()
    path = client.root / "pages/pudding.json"
    stat = path.stat()
    external = {**page, "description": "AI 改了这里"}
    write_json(path, external)
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    status, _, body = client.call("PUT", PAGE_URL, page, match)
    assert status == 409
    assert body["current"]["description"] == "AI 改了这里"


def test_two_editors_cannot_overwrite_same_version(client: Client) -> None:
    page, match = client.page()
    barrier = threading.Barrier(2)

    def save(description: str) -> int:
        barrier.wait(timeout=3)
        return client.call("PUT", PAGE_URL, {**page, "description": description}, match)[0]

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(save, ["编辑器一", "编辑器二"]))
    assert sorted(results) == [200, 409]


def test_external_edit_while_preparing_save_is_preserved(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    from soda_storyboard.server import store as store_module  # noqa: PLC0415

    page, match = client.page()
    actual_save = store_module.save_page

    def interleaved_save(value: Any, path: Path) -> Path:
        result = actual_save(value, path)
        write_json(client.root / "pages/pudding.json", {**page, "description": "CLI 在临时文件写好后修改"})
        return result

    monkeypatch.setattr(store_module, "save_page", interleaved_save)
    status, _, body = client.call("PUT", PAGE_URL, {**page, "description": "过时编辑"}, match)
    assert status == 409
    assert body["current"]["description"] == "CLI 在临时文件写好后修改"
    assert not list((client.root / "pages").glob("*.tmp"))


def test_new_delete_and_structural_validation(client: Client) -> None:
    status, _, body = client.call("POST", "/api/pages", {"id": "next", "description": "下一页"})
    assert status == 201
    assert body["page"]["color_mode"] == "color"
    assert client.call("POST", "/api/pages", {"id": "next"})[0] == 409
    assert client.call("DELETE", "/api/pages/next")[0] == 409
    status, _, deleted = client.call("DELETE", "/api/pages/next", headers={"If-Match": body["version"]})
    assert status == 200
    assert not (client.root / "pages/next.json").exists()
    assert read_json(client.root / deleted["trash_path"])["id"] == "next"
    assert client.call("GET", "/api/pages/next")[0] == 404
    page, match = client.page()
    page["panels"] = [None]
    assert client.call("PUT", PAGE_URL, page, match)[0] == 422


@pytest.mark.parametrize("style", ["sketch", "boxes"])
def test_preview_and_compile(client: Client, style: str) -> None:
    status, headers, data = client.call("GET", PAGE_URL + f"/preview.png?style={style}&scale=0.25")
    assert status == 200
    assert headers["Content-Type"] == "image/png"
    assert Image.open(io.BytesIO(data)).size == (256, 384)
    status, _, result = client.call("POST", PAGE_URL + "/compile", {"with_ids": True})
    assert status == 200
    assert result["moss"]["items"]
    assert read_json(client.root / result["path"]) == result["moss"]
    assert (client.root / result["paths"]["map"]).exists()
    assert client.call("POST", PAGE_URL + "/validate", {})[2]["valid"]


def test_layout_apply_skew_and_compile_cut(client: Client) -> None:
    page, match = client.page()
    status, _, body = client.call("GET", "/api/templates?panels=5")
    assert status == 200
    assert body["templates"]
    status, _, suggestions = client.call("POST", PAGE_URL + "/layout-suggest", {"candidates": 3, "skew": 0})
    assert status == 200
    assert len(suggestions["candidates"]) == 3
    candidate = suggestions["candidates"][0]
    assert client.call("GET", candidate["preview_url"])[2].startswith(b"\x89PNG")
    assert client.page()[1] == match  # Suggestion must not mutate the page.
    status, _, result = client.call(
        "POST", PAGE_URL + "/layout-apply", {"candidate_id": candidate["candidate_id"]}, match
    )
    assert status == 200
    assert result["page"]["panels"][0]["description"] == page["panels"][0]["description"]
    assert result["page"]["texts"] == page["texts"]
    assert result["page"]["overlays"] == page["overlays"]
    assert (
        client.call("POST", PAGE_URL + "/layout-apply", {"candidate_id": candidate["candidate_id"]}, match)[0]
        == 409
    )
    # Pudding has two unobstructed adjacent panels in its top row.
    status, _, result = client.call("PUT", PAGE_URL, page, {"If-Match": result["version"]})
    assert status == 200
    status, _, result = client.call(
        "POST", PAGE_URL + "/skew", {"panels": ["p1", "p2"], "angle": 8}, {"If-Match": result["version"]}
    )
    assert status == 200
    assert result["page"]["panels"][0]["shape"]["type"] == "quad"
    status, _, compiled = client.call("POST", PAGE_URL + "/compile", {})
    assert status == 200
    assert read_json(client.root / compiled["paths"]["cut"])["panels"]


def test_compile_inherits_cli_project_defaults(client: Client) -> None:
    page = read_json(client.root / "pages/pudding.json")
    for key in ("color_mode", "tags", "text_direction", "style_prompt"):
        page.pop(key)
    write_json(client.root / "pages/pudding.json", page)
    defaults = read_json(client.root / "project.json")
    inherited = {
        **page,
        **{key: defaults[key] for key in ("color_mode", "tags", "text_direction", "style_prompt")},
    }
    expected = compile_page(Page.from_dict(inherited), client.server.store.character_map())
    status, _, result = client.call("POST", PAGE_URL + "/compile", {})
    assert status == 200
    assert result["moss"] == expected


@pytest.mark.parametrize(
    "path",
    [
        "/api/files/../project.json",
        "/api/files/%2e%2e/project.json",
        "/api/files/..%5cproject.json",
        "/api/files/C:%5cWindows%5cwin.ini",
        "/api/files/project.json:stream",
        "/api/files/.git/config",
        "/api/files/project.txt",
        "/api/pages/..%5cproject",
        "/api/files/%00.json",
    ],
)
def test_path_attacks_rejected(client: Client, path: str) -> None:
    assert client.call("GET", path)[0] == 400


def test_symlink_escape_rejected(client: Client, tmp_path: Path) -> None:
    outside = tmp_path / "outside.json"
    write_json(outside, {"private": "outside"})
    link = client.root / "escape.json"
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("此 Windows 账户没有创建符号链接的权限")
    assert client.call("GET", "/api/files/escape.json")[0] == 400


def test_cors_host_and_static(client: Client) -> None:
    for origin in ("http://localhost:5173", "http://127.0.0.1:5173", client.url):
        status, headers, _ = client.call("GET", PAGE_URL, headers={"Origin": origin})
        assert status == 200
        assert headers["Access-Control-Allow-Origin"] == origin
        assert headers["Access-Control-Expose-Headers"] == "ETag"
        status, headers, _ = client.call(
            "OPTIONS", PAGE_URL, headers={"Origin": origin, "Access-Control-Request-Method": "PUT"}
        )
        assert status == 204
        assert "If-Match" in headers["Access-Control-Allow-Headers"]
    status, headers, _ = client.call("GET", PAGE_URL, headers={"Origin": "https://evil.example"})
    assert status == 403
    assert "Access-Control-Allow-Origin" not in headers
    assert client.call("GET", PAGE_URL, headers={"Host": "evil.example"})[0] == 403
    assert "前端尚未构建" in client.call("GET", "/")[2].decode()
    client.server.static.mkdir()
    (client.server.static / "index.html").write_text("<h1>Soda</h1>", encoding="utf-8")
    assert client.call("GET", "/")[2] == b"<h1>Soda</h1>"
    assert client.call("GET", "/%2e%2e/project.json")[0] == 400
    assert client.call("GET", "/api/files/project.json")[0] == 200


@pytest.mark.parametrize("query", ["scale=0", "scale=nan", "scale=100", "style=invalid"])
def test_preview_parameters_rejected(client: Client, query: str) -> None:
    assert client.call("GET", PAGE_URL + "/preview.png?" + query)[0] == 400


def read_event(response: Any, event_name: str) -> dict:
    deadline = time.monotonic() + 6
    event = ""
    while time.monotonic() < deadline:
        line = response.readline().decode("utf-8").strip()
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: ") and event == event_name:
            return json.loads(line[6:])
    pytest.fail(f"没有收到 SSE 事件 {event_name}")


def test_sse_external_edit_add_delete(client: Client) -> None:
    with urlopen(client.url + "/api/events", timeout=8) as response:
        assert read_event(response, "ready")["refresh"]
        page, match = client.page()
        page["panels"][2]["description"] = "AI 刚改过的第三格"
        write_json(client.root / "pages/pudding.json", page)
        event = read_event(response, "file_changed")
        assert event["change"] == "modified"
        assert event["page_id"] == "pudding"
        assert event["version"] != match["If-Match"]
        assert event["message"] == "页面已在外部修改"
        assert event["version"] == client.page()[1]["If-Match"]
        write_json(client.root / "pages/extra.json", {**page, "id": "extra"})
        assert read_event(response, "file_changed")["change"] == "added"
        (client.root / "pages/extra.json").unlink()
        deleted = read_event(response, "file_changed")
        assert deleted["change"] == "deleted"
        assert deleted["version"] is None


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", PAGE_URL + "/generate"),
        ("GET", PAGE_URL + "/renders"),
        ("POST", PAGE_URL + "/pick"),
        ("GET", PAGE_URL + "/plan"),
        ("POST", PAGE_URL + "/panels/p1/redraw"),
        ("POST", PAGE_URL + "/compose"),
        ("POST", PAGE_URL + "/letter"),
        ("POST", "/api/export"),
    ],
)
def test_production_missing(client: Client, monkeypatch: pytest.MonkeyPatch, method: str, path: str) -> None:
    # Force the absent-module case even if P3 arrives in the shared checkout.
    real_import = importlib.import_module

    def unavailable(name: str, package: str | None = None) -> Any:
        if name == "soda_storyboard.production.api":
            raise ModuleNotFoundError(name)
        return real_import(name, package)

    monkeypatch.setattr(importlib, "import_module", unavailable)
    status, _, error = client.call(method, path, {} if method == "POST" else None)
    assert status == 501
    assert error["error"] == "出图功能尚未安装"


@pytest.fixture
def fake_production(monkeypatch: pytest.MonkeyPatch) -> types.ModuleType:
    api = types.ModuleType("soda_storyboard.production.api")
    monkeypatch.setitem(sys.modules, api.__name__, api)
    return api


def test_jobs_serial_queue_progress_cancel_and_failure(
    client: Client, fake_production: types.ModuleType
) -> None:
    entered = threading.Event()
    release = threading.Event()
    calls = []

    def generate(root: Path, page_id: str, *, progress: Any, seeds: int = 4) -> list:
        calls.append((root, page_id, seeds))
        entered.set()
        assert release.wait(5)
        progress(1, seeds, message="候选完成")
        if seeds == 3:
            message = "测试模型文件不存在"
            raise RuntimeError(message)
        return [{"path": "pages/pudding/renders/fake.png", "seed": 42, "meta": {}}]

    fake_production.generate_page = generate
    try:
        status, _, first = client.call("POST", PAGE_URL + "/generate", {"seeds": 1})
        assert status == 202
        assert entered.wait(2)
        _, _, queued = client.call("POST", PAGE_URL + "/generate", {"seeds": 2})
        assert queued["status"] == "queued"
        assert client.call("POST", f"/api/jobs/{queued['id']}/cancel", {})[2]["status"] == "cancelled"
        release.set()
        completed = client.wait_job(first["id"])
        assert completed["status"] == "completed"
        assert completed["progress"]["args"] == [1, 1]
        assert completed["result"][0]["seed"] == 42
        assert len(calls) == 1
        _, _, third = client.call("POST", PAGE_URL + "/generate", {"seeds": 3})
        failed = client.wait_job(third["id"])
        assert failed["status"] == "failed"
        assert "测试模型文件不存在" in failed["error"]
    finally:
        release.set()


def test_running_cancel_waits_for_safe_boundary(client: Client, fake_production: types.ModuleType) -> None:
    entered = threading.Event()
    release = threading.Event()

    def compose(_root: Path, _page_id: str) -> str:
        entered.set()
        assert release.wait(5)
        return "pages/pudding/composed.png"

    fake_production.compose_page = compose
    try:
        _, _, job = client.call("POST", PAGE_URL + "/compose", {})
        assert entered.wait(2)
        page, match = client.page()
        blocked = client.call("PUT", PAGE_URL, page, match)
        assert blocked[0] == 409
        assert blocked[2]["reason"] == "production_running"
        assert client.call("DELETE", PAGE_URL, headers=match)[0] == 409
        cancelled = client.call("POST", f"/api/jobs/{job['id']}/cancel", {})[2]
        assert cancelled["cancel_requested"]
        assert cancelled["status"] == "running"
        _, _, next_job = client.call("POST", PAGE_URL + "/compose", {})
        assert next_job["status"] == "queued"
        release.set()
        assert client.wait_job(job["id"])["status"] == "cancelled"
        assert client.wait_job(next_job["id"])["status"] == "completed"
        page, match = client.page()
        assert client.call("PUT", PAGE_URL, page, match)[0] == 200
    finally:
        release.set()


def test_running_cancel_at_progress_callback(client: Client, fake_production: types.ModuleType) -> None:
    entered = threading.Event()
    release = threading.Event()
    after_callback = threading.Event()

    def generate(_root: Path, _page_id: str, *, progress: Any) -> list:
        entered.set()
        assert release.wait(5)
        progress({"stage": "candidate", "index": 2, "total": 4})
        after_callback.set()
        return []

    fake_production.generate_page = generate
    try:
        _, _, job = client.call("POST", PAGE_URL + "/generate", {})
        assert entered.wait(2)
        client.call("POST", f"/api/jobs/{job['id']}/cancel", {})
        release.set()
        assert client.wait_job(job["id"])["status"] == "cancelled"
        assert not after_callback.is_set()
    finally:
        release.set()


def test_cancel_does_not_abandon_submitted_gpu_work(
    client: Client, fake_production: types.ModuleType
) -> None:
    entered = threading.Event()
    poll = threading.Event()
    after_poll = threading.Event()
    gpu_finished = threading.Event()

    def generate(_root: Path, _page_id: str, *, progress: Any) -> list:
        entered.set()
        assert poll.wait(5)
        progress({"stage": "waiting", "prompt_id": "already-submitted"})
        after_poll.set()
        assert gpu_finished.wait(5)
        progress({"stage": "completed", "prompt_id": "already-submitted"})
        return []

    fake_production.generate_page = generate
    try:
        _, _, job = client.call("POST", PAGE_URL + "/generate", {})
        assert entered.wait(2)
        client.call("POST", f"/api/jobs/{job['id']}/cancel", {})
        poll.set()
        assert after_poll.wait(1)
        assert client.call("GET", f"/api/jobs/{job['id']}")[2]["status"] == "running"
        _, _, queued = client.call("POST", PAGE_URL + "/generate", {})
        assert queued["status"] == "queued"
        client.call("POST", f"/api/jobs/{queued['id']}/cancel", {})
        gpu_finished.set()
        assert client.wait_job(job["id"])["status"] == "cancelled"
    finally:
        poll.set()
        gpu_finished.set()


def test_production_routes_and_sse_jobs(client: Client, fake_production: types.ModuleType) -> None:
    root = client.root
    render = root / "pages/pudding/renders/fake.png"
    render.parent.mkdir(parents=True)
    Image.new("RGB", (8, 8), "white").save(render)
    calls = []

    def pick(project: Path, page: str, path: str) -> dict:
        calls.append((project, page, path))
        return {"selected_render": path}

    def redraw(project: Path, page: str, panel: str, *, progress: Any, **kwargs: Any) -> dict:
        progress({"completed": 1})
        calls.append((project, page, panel, kwargs))
        return {"path": "pages/pudding/p1.png"}

    def plan(_project: Path, page: str) -> dict:
        return {"page_id": page, "steps": []}

    def letter(_project: Path, _page: str) -> str:
        return "pages/pudding/lettered.png"

    def export(project: Path, page_ids: list | None = None, fmt: str = "png") -> list:
        calls.append((project, page_ids, fmt))
        return ["export/pudding.png"]

    fake_production.pick_render = pick
    fake_production.redraw_panel = redraw
    fake_production.production_plan = plan
    fake_production.letter_page = letter
    fake_production.export = export
    status, _, renders = client.call("GET", PAGE_URL + "/renders")
    assert status == 200
    assert renders["renders"][0]["path"] == "pages/pudding/renders/fake.png"
    assert client.call("GET", renders["renders"][0]["url"])[0] == 200
    assert client.call("GET", PAGE_URL + "/plan")[2]["steps"] == []
    operations = [
        (PAGE_URL + "/pick", {"render_path": "pages/pudding/renders/fake.png"}),
        (PAGE_URL + "/panels/p1/redraw", {"mode": "swap", "character_id": "younger", "denoise": 0.85}),
        (PAGE_URL + "/letter", {}),
        ("/api/export", {"page_ids": ["pudding"], "format": "png"}),
    ]
    with urlopen(client.url + "/api/events", timeout=8) as response:
        read_event(response, "ready")
        for path, body in operations:
            status, _, job = client.call("POST", path, body)
            assert status == 202
            assert client.wait_job(job["id"])["status"] == "completed"
        event = read_event(response, "job")
        assert event["operation"] == "pick"
        while event["id"] != job["id"] or event["status"] != "completed":
            event = read_event(response, "job")
        assert event["result"] == ["export/pudding.png"]
    assert calls[0] == (root, "pudding", str(render))
    assert calls[1][2:] == ("p1", {"mode": "swap", "character_id": "younger", "denoise": 0.85})
    assert calls[2] == (root, ["pudding"], "png")
    assert client.call("POST", PAGE_URL + "/pick", {"render_path": "../fake.png"})[0] == 400
    assert client.call("POST", PAGE_URL + "/panels/missing/redraw", {})[0] == 404
    assert client.call("GET", "/api/jobs/missing")[0] == 404


def test_real_p3_local_pick_plan_and_finishing_without_network(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    pytest.importorskip("soda_storyboard.production.api")
    production_client = pytest.importorskip("soda_storyboard.production.client")

    def forbidden_request(*_args: Any, **_kwargs: Any) -> bytes:
        pytest.fail("本测试不允许访问任何 ComfyUI 服务")

    monkeypatch.setattr(production_client.ComfyClient, "_request", forbidden_request)
    relative = "pages/pudding/renders/20261021_42.png"
    sheet = "pages/pudding/renders/20261021_candidates.png"
    target = client.root / relative
    target.parent.mkdir(parents=True)
    Image.new("RGB", (1024, 1536), "white").save(target)
    shutil.copyfile(target, client.root / sheet)
    shutil.copyfile(target, target.parent / "unregistered.png")
    value = read_json(client.root / "pages/pudding.json")
    record = {"path": relative, "seed": 42, "meta": {"preset": "draft", "lora": None}}
    value["production"] = {"renders": [record], "candidate_sheet": sheet}
    write_json(client.root / "pages/pudding.json", value)
    renders = client.call("GET", PAGE_URL + "/renders")[2]
    assert len(renders["renders"]) == 1
    assert renders["renders"][0]["seed"] == 42
    assert renders["metadata"] == [record]
    assert renders["candidate_sheet"]["path"] == sheet
    for action, body in (("pick", {"render_path": relative}), ("compose", {}), ("letter", {})):
        status, _, job = client.call("POST", PAGE_URL + "/" + action, body)
        assert status == 202
        done = client.wait_job(job["id"])
        assert done["status"] == "completed", done
    renders = client.call("GET", PAGE_URL + "/renders")[2]
    assert renders["selected_render"] == relative
    plan = client.call("GET", PAGE_URL + "/plan")[2]
    assert plan["needs_pick"] is False
    assert plan["needs_compose"] is False
    _, _, job = client.call("POST", "/api/export", {"page_ids": ["pudding"], "format": "png"})
    done = client.wait_job(job["id"])
    assert done["status"] == "completed", done
    assert (client.root / "exports/pudding.png").is_file()


def test_cli_rejects_public_host(client: Client, capsys: pytest.CaptureFixture) -> None:
    assert main([str(client.root), "--host", "0.0.0.0"]) == 2  # noqa: S104 -- verify refusal to bind
    assert "回环地址" in capsys.readouterr().err
    with pytest.raises(APIError, match="回环地址"):
        Server(client.root, port=0, host="192.168.1.2")


def test_candidate_previews_default_to_sketch(client: Client) -> None:
    def candidate_image(query: str) -> bytes:
        status, _, result = client.call("POST", PAGE_URL + "/layout-suggest" + query, {"candidates": 1})
        assert status == 200
        return client.call("GET", result["candidates"][0]["preview_url"])[2]

    assert candidate_image("") == candidate_image("?style=sketch")
    assert candidate_image("?style=sketch") != candidate_image("?style=boxes")
    assert client.call("POST", PAGE_URL + "/layout-suggest?style=invalid", {"candidates": 1})[0] == 400


@pytest.mark.parametrize("panels", [True, False])
def test_shared_external_import_save_and_compile_are_lossless(client: Client, *, panels: bool) -> None:
    source = {
        "summary": {"caption": "External", "future": True},
        "bbox_format": "yxyx",
        "bbox_coord_space": "abs_centralized",
        "vendor": {"retain": 7},
        "items": [
            {
                "label": "object",
                "caption": "Upper panel" if panels else "Cup",
                "bbox": [-700, -480, -20, 480],
            },
            {
                "label": "text",
                "text": "你好",
                "caption": "Vertical narration",
                "bbox": [-600, -400, -400, -300],
            },
            {"label": "character", "caption": "Girl", "bbox": [100, -100, 600, 100]},
            {"label": "future", "bbox": [0, 0, 20, 20], "unknown": True},
        ],
    }
    status, _, imported = client.call("POST", "/api/import", {"source": source, "page_id": "external"})
    assert status == 200
    assert imported["report"]["panel_count"] == (1 if panels else 0)
    assert not (client.root / "pages/external.json").exists()
    status, _, saved = client.call("POST", "/api/pages", imported["page"])
    assert status == 201
    assert saved["page"]["moss_import"]
    status, _, result = client.call("POST", "/api/pages/external/compile", {})
    assert status == 200
    assert result["moss"]["items"] == source["items"]
    assert result["moss"]["vendor"] == source["vendor"]
    assert result["moss"]["summary"]["future"] is True
    if panels:
        info = client.call("POST", "/api/pages/external/caption-preview", {})[2]["panels"][0]
        assert info["caption"] == "Upper panel"
        assert info["translation_status"] == "preserved"
        assert not info["warnings"]


def test_caption_preview_reports_fresh_stale_missing_and_pose_conflict(client: Client) -> None:
    raw, _ = client.page()
    page = client.server.store.render_page("pudding", raw=raw)
    characters = client.server.store.character_map()
    first = raw["panels"][0]
    first["caption_auto_en"] = {
        "format": "scene-v1",
        "text": "A girl reads a book.",
        "source_hash": source_hash(page.panels[0], page, characters),
        "translated_at": "test",
    }
    endpoint = PAGE_URL + "/caption-preview"
    info = client.call("POST", endpoint, {"page": raw})[2]["panels"][0]
    assert (info["language"], info["translation_status"]) == ("en", "fresh")
    first["description"] = "女孩坐在椅子上"
    first["figures"] = [{"character_id": "younger", "pose": "lie", "position": "center"}]
    info = client.call("POST", endpoint, {"page": raw})[2]["panels"][0]
    assert (info["language"], info["translation_status"]) == ("zh", "stale")
    assert {notice["code"] for notice in info["warnings"]} >= {
        "pose_description_conflict",
        "caption_translation_stale",
    }
    first.pop("caption_auto_en")
    info = client.call("POST", endpoint, {"page": raw})[2]["panels"][0]
    assert info["translation_status"] == "missing"


def test_project_listing_ignores_sidecar_and_invalid_id_files(client: Client) -> None:
    for name in ("pudding.cut.json", "pudding.map.json", "invalid.id.json"):
        (client.root / "pages" / name).write_text("not a page or even valid JSON", encoding="utf-8")
    status, _, body = client.call("GET", "/api/project")
    assert status == 200
    assert [page["id"] for page in body["pages"]] == ["pudding"]
    assert client.call("GET", PAGE_URL)[0] == 200


def test_external_import_inherits_project_color_and_infers_horizontal_text(client: Client) -> None:
    source = {
        "canvas_width": 1024,
        "canvas_height": 1536,
        "items": [
            {"label": "text", "caption": "nickname", "text": "清月如故", "bbox": [-737, -430, -697, -272]}
        ],
    }
    status, _, body = client.call("POST", "/api/import", {"source": source, "page_id": "live"})
    assert status == 200
    assert body["page"]["color_mode"] == "color"
    assert body["page"]["texts"][0]["direction"] == "horizontal"
    assert client.call("POST", "/api/pages", body["page"])[0] == 201
    assert client.call("POST", "/api/pages/live/compile", {})[2]["moss"]["items"] == source["items"]
