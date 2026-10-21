"""Bounded SSE fanout and polling of files changed by CLI/editor tools."""

from __future__ import annotations

import os
import queue
import threading
from pathlib import Path
from typing import Any

from .common import APIError, inside, snapshot

# Event payloads share the public JSON boundary.
# ruff: noqa: ANN401, RUF001

IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}


class Events:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.stopped = threading.Event()
        self.lock = threading.Lock()
        self.clients: set[queue.Queue] = set()
        self.files = self.scan()
        self.thread = threading.Thread(target=self.watch, daemon=True, name="storyboard-watch")
        self.thread.start()

    def subscribe(self) -> queue.Queue:
        client: queue.Queue = queue.Queue(maxsize=256)
        with self.lock:
            self.clients.add(client)
        return client

    def unsubscribe(self, client: queue.Queue) -> None:
        with self.lock:
            self.clients.discard(client)

    def publish(self, event: str, data: Any) -> None:
        with self.lock:
            for client in self.clients:
                try:
                    client.put_nowait((event, data))
                except queue.Full:
                    # A slow/reconnecting client must explicitly refetch state.
                    while True:
                        try:
                            client.get_nowait()
                        except queue.Empty:
                            break
                    client.put_nowait(("resync", {"message": "事件积压，请重新读取项目"}))

    def scan(self) -> dict[str, tuple[int, int]]:
        result = {}
        for directory, children, names in os.walk(self.root, followlinks=False):
            children[:] = [name for name in children if not name.startswith(".")]
            for name in names:
                path = Path(directory) / name
                if path.suffix.lower() not in IMAGE_TYPES | {".json"} or name.startswith("."):
                    continue
                try:
                    path = inside(self.root, path.relative_to(self.root).as_posix())
                    stat = path.stat()
                    result[path.relative_to(self.root).as_posix()] = (stat.st_mtime_ns, stat.st_size)
                except (OSError, ValueError, APIError):
                    continue
        return result

    def watch(self) -> None:
        while not self.stopped.wait(1):
            current = self.scan()
            for relative in sorted(self.files.keys() | current.keys()):
                if self.files.get(relative) == current.get(relative):
                    continue
                change = (
                    "deleted"
                    if relative not in current
                    else "modified"
                    if relative in self.files
                    else "added"
                )
                page_id = None
                version = None
                path = Path(relative)
                if path.parent == Path("pages") and path.suffix == ".json":
                    page_id = path.stem
                    if change != "deleted":
                        try:
                            _, version = snapshot(inside(self.root, relative))
                        except (OSError, ValueError, APIError):
                            # Retry a temporarily incomplete CLI write on the next scan.
                            current.pop(relative, None)
                            continue
                self.publish(
                    "file_changed",
                    {
                        "path": relative,
                        "change": change,
                        "page_id": page_id,
                        "version": version,
                        "source": "unknown",
                        "message": "页面已在外部修改" if page_id else "项目文件已修改",
                    },
                )
            self.files = current

    def close(self) -> None:
        self.stopped.set()
        self.thread.join(timeout=2)
