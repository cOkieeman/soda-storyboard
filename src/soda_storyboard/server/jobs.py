"""One worker per service: cancellation never overlaps GPU operations."""

from __future__ import annotations

import json
import queue
import threading
import uuid
from functools import partial
from typing import TYPE_CHECKING, Any

from .common import APIError, json_default

if TYPE_CHECKING:
    from collections.abc import Callable

    from .events import Events

# Production callbacks/results are JSON values supplied by an optional module.
# ruff: noqa: ANN401, RUF001


class CancelledError(Exception):
    pass


class Jobs:
    def __init__(self, events: Events) -> None:
        self.events = events
        self.lock = threading.RLock()
        self.records: dict[str, dict] = {}
        self.tasks: queue.Queue = queue.Queue()
        self.stopped = threading.Event()
        self.worker = threading.Thread(target=self.run, name="storyboard-jobs", daemon=True)
        self.worker.start()

    def get(self, job_id: str) -> dict:
        with self.lock:
            if job_id not in self.records:
                raise APIError(404, "任务不存在")
            return self.records[job_id].copy()

    def update(self, job_id: str, **fields: Any) -> None:
        with self.lock:
            self.records[job_id].update(fields)
            self.events.publish("job", self.get(job_id))

    def submit(self, operation: str, task: Callable, page_id: str | None = None) -> dict:
        job_id = uuid.uuid4().hex
        with self.lock:
            self.records[job_id] = {
                "id": job_id,
                "operation": operation,
                "page_id": page_id,
                "status": "queued",
                "message": "排队中",
                "progress": None,
                "cancel_requested": False,
                "result": None,
                "error": None,
            }
            self.events.publish("job", self.get(job_id))
            self.tasks.put((job_id, task))
            return self.get(job_id)

    def cancel(self, job_id: str) -> dict:
        with self.lock:
            job = self.get(job_id)
            if job["status"] == "queued":
                self.update(job_id, status="cancelled", cancel_requested=True, message="已取消")
            elif job["status"] == "running":
                self.update(job_id, cancel_requested=True, message="已请求取消，等待当前步骤结束")
            return self.get(job_id)

    def progress(self, job_id: str, *args: Any, **kwargs: Any) -> None:
        cancelling = self.get(job_id)["cancel_requested"] or self.stopped.is_set()
        event = args[0] if args and isinstance(args[0], dict) else kwargs
        # P3's submitted/waiting callbacks run while ComfyUI owns a live prompt.
        # Keep polling it until completion rather than releasing the GPU slot.
        if cancelling and event.get("stage") in {"candidate", "completed"}:
            raise CancelledError
        value = {"args": list(args), **kwargs}
        value = json.loads(json.dumps(value, default=json_default, ensure_ascii=False, allow_nan=False))
        self.update(
            job_id, progress=value, message="已请求取消，等待当前步骤结束" if cancelling else "处理中"
        )

    def run(self) -> None:
        while not self.stopped.is_set():
            try:
                job_id, task = self.tasks.get(timeout=0.2)
            except queue.Empty:
                continue
            try:
                with self.lock:
                    if self.get(job_id)["status"] == "cancelled":
                        continue
                    self.update(job_id, status="running", message="运行中")
                result = task(partial(self.progress, job_id))
                result = json.loads(
                    json.dumps(result, default=json_default, ensure_ascii=False, allow_nan=False)
                )
                with self.lock:
                    if self.get(job_id)["cancel_requested"]:
                        self.update(
                            job_id,
                            status="cancelled",
                            message="已取消，当前步骤可能已写入结果",
                            result=result,
                        )
                    else:
                        self.update(job_id, status="completed", message="已完成", result=result)
            except CancelledError:
                self.update(job_id, status="cancelled", message="已取消")
            except Exception as exc:  # noqa: BLE001 -- isolate optional production failures from the worker
                self.update(job_id, status="failed", message="任务失败", error=f"任务执行失败：{exc}")
            finally:
                self.tasks.task_done()

    def close(self) -> None:
        self.stopped.set()
        with self.lock:
            for job_id in self.records:
                self.cancel(job_id)
        self.worker.join(timeout=2)
