"""Shared, newline-independent fingerprint for shipped editor assets."""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path


def source_hash(editor: Path) -> str:
    digest = hashlib.sha256()
    sources = [p for p in (editor / "src").rglob("*") if p.is_file()]
    sources.extend(
        p for p in editor.iterdir() if p.is_file() and p.suffix in {".json", ".html", ".ts", ".cjs"}
    )
    for path in sorted(sources, key=lambda p: p.relative_to(editor).as_posix()):
        digest.update(path.relative_to(editor).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes().replace(b"\r\n", b"\n"))
        digest.update(b"\0")
    return digest.hexdigest()
