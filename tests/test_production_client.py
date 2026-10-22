"""A real loopback HTTP fake: never access the user's ComfyUI/GPU."""

from __future__ import annotations

import io
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import TracebackType
from typing import Self
from urllib.parse import unquote, urlsplit

import pytest
from PIL import Image

from soda_storyboard.production.client import ComfyClient
from soda_storyboard.production.errors import ProductionError
from soda_storyboard.production.graphs import DEFAULTS, minimal_graph


class FakeComfy:
    def __init__(self) -> None:  # noqa: C901 -- loopback fake HTTP routes are local to the owner
        self.prompts: list[dict] = []
        self.uploads: list[bytes] = []
        self.views: list[str] = []
        self.requests: list[str] = []
        self.polls: dict[str, int] = {}
        self.missing: set[str] = set()
        self.reject = False
        self.fail = False
        self.hang = False
        self.empty = False
        self.invalid_json = False
        self.definitions = {
            name: {"input": {"required": {}}}
            for name in {
                node["class_type"]
                for preset in ("draft", "final")
                for node in minimal_graph(
                    "test", preset=preset, image="input.png", mask="mask.png", inpaint=True
                ).values()
            }
        }
        self.definitions["EmptyFlux2LatentImage"] = {"input": {"required": {}}}
        for name, field, values in (
            ("UNETLoader", "unet_name", [DEFAULTS["sft"], DEFAULTS["base"], "custom.safetensors"]),
            ("CLIPLoader", "clip_name", [DEFAULTS["clip"]]),
            ("VAELoader", "vae_name", [DEFAULTS["vae"]]),
            ("LoraLoaderModelOnly", "lora_name", ["older.safetensors", "younger.safetensors"]),
        ):
            self.definitions[name] = {"input": {"required": {field: [values]}}}
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, _format: str, *args: object) -> None:
                pass

            def reply(self, value: object, status: int = 200, *, png: bool = False) -> None:
                data = value if png else json.dumps(value).encode()
                self.send_response(status)
                self.send_header("Content-Type", "image/png" if png else "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self) -> None:
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                owner.requests.append(self.path)
                if self.path == "/upload/image":
                    owner.uploads.append(body)
                    self.reply({"name": "test.png", "subfolder": "uploaded", "type": "input"})
                elif self.path == "/prompt":
                    graph = json.loads(body)["prompt"]
                    owner.prompts.append(graph)
                    if owner.reject:
                        self.reply(
                            {"error": "Value not in list", "node_errors": {"1": "missing-model.safetensors"}},
                            400,
                        )
                    else:
                        self.reply({"prompt_id": str(len(owner.prompts))})
                else:
                    self.reply({}, 404)

            def do_GET(self) -> None:
                path = urlsplit(self.path).path
                owner.requests.append(self.path)
                if path.startswith("/object_info/"):
                    name = unquote(path.rsplit("/", 1)[-1])
                    self.reply(
                        {name: owner.definitions[name]}
                        if name in owner.definitions and name not in owner.missing
                        else {}
                    )
                elif path.startswith("/history/"):
                    prompt_id = path.rsplit("/", 1)[-1]
                    owner.polls[prompt_id] = owner.polls.get(prompt_id, 0) + 1
                    if owner.invalid_json:
                        self.reply(b"not JSON", png=True)
                    elif owner.hang or owner.polls[prompt_id] == 1:
                        self.reply({})
                    elif owner.fail:
                        self.reply(
                            {
                                prompt_id: {
                                    "status": {
                                        "status_str": "error",
                                        "messages": [
                                            ["execution_error", {"exception_message": "CUDA test failure"}]
                                        ],
                                    }
                                }
                            }
                        )
                    else:
                        outputs = (
                            {}
                            if owner.empty
                            else {
                                "10": {
                                    "images": [
                                        {"filename": "result.png", "subfolder": "测试", "type": "output"}
                                    ]
                                },
                                "81": {
                                    "images": [
                                        {"filename": "result.png", "subfolder": "v2", "type": "output"}
                                    ]
                                },
                            }
                        )
                        self.reply(
                            {
                                prompt_id: {
                                    "outputs": outputs,
                                    "status": {"completed": True, "status_str": "success"},
                                }
                            }
                        )
                elif path == "/view":
                    owner.views.append(self.path)
                    buffer = io.BytesIO()
                    if "cutout" in owner.prompts[-1]:
                        image = Image.new("RGBA", (64, 96), (255, 0, 0, 0))
                        image.paste((255, 0, 0, 255), (16, 16, 48, 96))
                    else:
                        image = Image.new("RGB", (128, 192), (30 * len(owner.prompts) % 255, 90, 180))
                    image.save(buffer, "PNG")
                    self.reply(buffer.getvalue(), png=True)
                else:
                    self.reply({}, 404)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def __enter__(self) -> Self:
        self.thread.start()
        return self

    def __exit__(
        self, _type: type[BaseException] | None, _value: BaseException | None, _tb: TracebackType | None
    ) -> None:
        self.server.shutdown()
        self.thread.join(timeout=2)
        self.server.server_close()


def test_client_real_http_roundtrip(tmp_path: Path) -> None:
    with FakeComfy() as fake:
        client = ComfyClient(fake.url, timeout=2, poll_interval=0.001)
        assert client.has_node("KSampler")
        assert not client.has_node("missing node")
        image = tmp_path / "上传图片.png"
        Image.new("RGBA", (16, 16), (0, 0, 0, 0)).save(image)
        assert client.upload(image) == "uploaded/test.png"
        assert b'name="image"' in fake.uploads[0]
        assert b'name="overwrite"' in fake.uploads[0]
        assert b"true" in fake.uploads[0]
        events = []
        path = client.run(minimal_graph("one frame"), tmp_path / "result.png", progress=events.append)
        assert Image.open(path).size == (128, 192)
        assert [e["stage"] for e in events] == ["submitted", "waiting", "completed"]
        assert "subfolder=%E6%B5%8B%E8%AF%95" in fake.views[0]


@pytest.mark.parametrize(
    ("flag", "message"),
    [
        ("reject", "missing-model.safetensors"),
        ("fail", "CUDA test failure"),
        ("hang", "超时"),
        ("empty", "没有图片"),
        ("invalid_json", "无效 JSON"),
    ],
)
def test_upstream_errors_preserved(tmp_path: Path, flag: str, message: str) -> None:
    with FakeComfy() as fake:
        setattr(fake, flag, True)
        with pytest.raises(ProductionError, match=message):
            ComfyClient(fake.url, timeout=0.1, poll_interval=0.001).run(
                minimal_graph("test"), tmp_path / "bad.png"
            )
        assert not (tmp_path / "bad.png").exists()


def test_unreachable_has_chinese_error() -> None:
    with FakeComfy() as fake:
        url = fake.url
    with pytest.raises(ProductionError, match="无法连接 ComfyUI"):
        ComfyClient(url, timeout=0.1).object_info("KSampler")


@pytest.mark.parametrize("url", ["file:///etc/passwd", "localhost:8190", "ftp://example.org"])
def test_reject_invalid_url(url: str) -> None:
    with pytest.raises(ProductionError, match="地址"):
        ComfyClient(url)
