# ruff: noqa: RUF001
# Chinese user-facing diagnostics intentionally use Chinese punctuation.
"""Small synchronous ComfyUI HTTP client with bounded polling."""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen

from .errors import ProductionError

if TYPE_CHECKING:
    from collections.abc import Callable

type Progress = Callable[[dict[str, Any]], None] | None
type JSON = dict[str, Any]


class ComfyClient:
    def __init__(
        self, url: str = "http://127.0.0.1:8190", *, timeout: float = 600, poll_interval: float = 1
    ) -> None:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            msg = "ComfyUI 地址必须是完整的 http 或 https 地址"
            raise ProductionError(msg)
        if timeout <= 0 or poll_interval < 0:
            msg = "超时必须大于 0，轮询间隔不能小于 0"
            raise ProductionError(msg)
        self.url = url.rstrip("/")
        self.timeout = timeout
        self.poll_interval = poll_interval

    def _request(
        self,
        path: str,
        data: bytes | None = None,
        *,
        content_type: str = "application/json",
        timeout: float | None = None,
    ) -> bytes:
        request = Request(  # noqa: S310 -- http(s) scheme validated at construction
            self.url + path, data=data, headers={"Content-Type": content_type}
        )
        try:
            response = urlopen(request, timeout=min(timeout or self.timeout, 30))  # noqa: S310 -- validated http(s) URL
            with response:
                return response.read()
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            msg = f"ComfyUI 请求失败（HTTP {exc.code}）：{detail}"
            raise ProductionError(msg) from exc
        except (URLError, OSError, TimeoutError) as exc:
            msg = f"无法连接 ComfyUI：{self.url}；请检查地址及服务是否启动。原始错误：{exc}"
            raise ProductionError(msg) from exc

    def _json(self, path: str, payload: JSON | None = None, *, timeout: float | None = None) -> JSON:
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        raw = self._request(path, body, timeout=timeout)
        try:
            result = json.loads(raw)
        except (ValueError, UnicodeError) as exc:
            msg = f"ComfyUI 返回了无效 JSON：{raw[:500]!r}"
            raise ProductionError(msg) from exc
        if not isinstance(result, dict):
            msg = "ComfyUI 返回格式错误：需要 JSON 对象"
            raise ProductionError(msg)
        return result

    def object_info(self, class_name: str) -> JSON:
        return self._json("/object_info/" + quote(class_name, safe=""))

    def has_node(self, class_name: str) -> bool:
        return class_name in self.object_info(class_name)

    def submit(self, graph: JSON) -> str:
        result = self._json("/prompt", {"prompt": graph, "client_id": uuid.uuid4().hex})
        if result.get("error") or result.get("node_errors") or not result.get("prompt_id"):
            raise ProductionError("ComfyUI 拒绝任务：" + json.dumps(result, ensure_ascii=False))
        return str(result["prompt_id"])

    def wait(self, prompt_id: str, *, progress: Progress = None, output_node: str = "10") -> list[JSON]:
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            history = self._json(
                "/history/" + quote(prompt_id, safe=""), timeout=max(0.001, deadline - time.monotonic())
            ).get(prompt_id)
            if history:
                status = history.get("status", {})
                if status.get("status_str") == "error" or any(
                    message[0] in {"execution_error", "execution_interrupted"}
                    for message in status.get("messages", [])
                    if message
                ):
                    raise ProductionError("ComfyUI 生成失败：" + json.dumps(history, ensure_ascii=False))
                outputs = history.get("outputs", {})
                images = outputs.get(output_node, {}).get("images", [])
                if images and status.get("completed", True):
                    if progress:
                        progress({"stage": "completed", "prompt_id": prompt_id})
                    return images
                if status.get("completed"):
                    msg = f"ComfyUI 任务已完成，但输出节点 {output_node} 没有图片：{history}"
                    raise ProductionError(msg)
            if progress:
                progress({"stage": "waiting", "prompt_id": prompt_id})
            time.sleep(min(self.poll_interval, max(0, deadline - time.monotonic())))
        msg = f"等待 ComfyUI 超时（{self.timeout:g} 秒），任务号 {prompt_id}；服务端任务可能仍在运行"
        raise ProductionError(msg)

    def download(self, image: JSON, destination: str | Path) -> Path:
        params = {
            key: image.get(key, "output" if key == "type" else "")
            for key in ("filename", "subfolder", "type")
        }
        data = self._request("/view?" + urlencode(params))
        path = Path(destination)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def upload(self, image_path: str | Path) -> str:
        path = Path(image_path)
        boundary = uuid.uuid4().hex
        filename = uuid.uuid4().hex + path.suffix
        body = (
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{filename}"\r\n'
                "Content-Type: image/png\r\n\r\n"
            ).encode()
            + path.read_bytes()
            + (
                f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue'
                f"\r\n--{boundary}--\r\n"
            ).encode()
        )
        raw = self._request("/upload/image", body, content_type=f"multipart/form-data; boundary={boundary}")
        try:
            result = json.loads(raw)
            name = result["name"]
            return "/".join(part for part in (result.get("subfolder", ""), name) if part)
        except (ValueError, KeyError, TypeError) as exc:
            msg = f"ComfyUI 上传图片失败：{raw[:500]!r}"
            raise ProductionError(msg) from exc

    def run(
        self, graph: JSON, destination: str | Path, *, progress: Progress = None, output_node: str = "10"
    ) -> Path:
        prompt_id = self.submit(graph)
        if progress:
            progress({"stage": "submitted", "prompt_id": prompt_id})
        images = self.wait(prompt_id, progress=progress, output_node=output_node)
        return self.download(images[0], destination)
