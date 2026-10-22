"""Cooperating CLI/server writers share one reentrant cross-process file lock."""

from __future__ import annotations

import contextlib
import hashlib
import os
import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

_guard = threading.Lock()
_locks: dict[str, threading.RLock] = {}
_held = threading.local()


def file_snapshot(path: Path) -> tuple[bytes, str]:
    """Read content and a version from one stable filesystem observation."""
    for _ in range(4):
        before = path.stat()
        content = path.read_bytes()
        after = path.stat()
        if (before.st_mtime_ns, before.st_size, before.st_ino) == (
            after.st_mtime_ns,
            after.st_size,
            after.st_ino,
        ):
            return content, f"{after.st_mtime_ns}-{hashlib.sha256(content).hexdigest()}"
    message = "File changed while being read"
    raise OSError(message)


@contextlib.contextmanager
def page_lock(path: Path) -> Iterator[None]:
    """Lock the stable sidecar inode, including across atomic page replacements."""
    key = os.path.normcase(str(path.resolve()))
    with _guard:
        lock = _locks.setdefault(key, threading.RLock())
    with lock:
        held = getattr(_held, "paths", None)
        if held is None:
            held = _held.paths = set()
        if key in held:
            yield
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        # Keep the sidecar in place: unlinking an unlocked file could split
        # waiting processes across different inodes.
        with path.with_name(path.name + ".lock").open("a+b") as stream:
            if os.name == "nt":
                import msvcrt  # noqa: PLC0415 -- platform-specific stdlib

                stream.seek(0, os.SEEK_END)
                if not stream.tell():
                    stream.write(b"\0")
                    stream.flush()
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl  # noqa: PLC0415 -- platform-specific stdlib

                fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
            held.add(key)
            try:
                yield
            finally:
                held.remove(key)
                if os.name == "nt":
                    stream.seek(0)
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
