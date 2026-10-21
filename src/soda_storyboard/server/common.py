"""Shared HTTP errors, safe paths and file versions."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

# JSON is deliberately heterogeneous at the HTTP boundary.
# ruff: noqa: ANN401, RUF001


class APIError(Exception):
    def __init__(self, status: int, message: str, **details: Any) -> None:
        super().__init__(message)
        self.status = status
        self.payload = {"error": message, **details}


def identifier(value: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or value != value.strip()
        or any(c in value for c in '/\\:.\x00?*<>|"')
    ):
        raise APIError(400, "id 不能为空，也不能包含路径字符或点号")
    return value


def inside(root: Path, relative: str) -> Path:
    parts = relative.replace("\\", "/").split("/")
    if any(part in {"..", "."} or ":" in part or "\x00" in part for part in parts):
        raise APIError(400, "路径不能越出项目目录")
    target = (root / relative).resolve()
    if not target.is_relative_to(root.resolve()):
        raise APIError(400, "路径不能越出项目目录")
    return target


def snapshot(path: Path) -> tuple[dict[str, Any], str]:
    """Read one stable version, tolerating a concurrent atomic replacement."""
    for _ in range(4):
        before = path.stat()
        content = path.read_bytes()
        after = path.stat()
        if (before.st_mtime_ns, before.st_size, before.st_ino) == (
            after.st_mtime_ns,
            after.st_size,
            after.st_ino,
        ):
            value = json.loads(content)
            if not isinstance(value, dict):
                raise APIError(400, "JSON 文件必须包含对象")
            digest = hashlib.sha256(content).hexdigest()
            return value, f'"{after.st_mtime_ns}-{digest}"'
    raise APIError(409, "文件正在被修改，请重新读取后重试")


def json_default(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if hasattr(value, "to_dict"):
        return value.to_dict()
    message = f"无法序列化 {type(value).__name__}"
    raise TypeError(message)
