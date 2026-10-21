"""Build the offline editor and copy its output into the Python package."""

# ruff: noqa: INP001 -- executable build script, not a Python package

from __future__ import annotations

import json
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from soda_storyboard.web_build import source_hash


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    editor = root / "editor"
    npm = shutil.which("npm")
    if npm is None:
        message = "Building the editor requires Node.js/npm (end users do not need it)."
        raise SystemExit(message)
    subprocess.run([npm, "run", "build"], cwd=editor, check=True)  # noqa: S603 -- resolved local npm
    target = root / "src/soda_storyboard/web"
    # Only ever remove this verified, fixed package directory.
    if target.resolve() != root.resolve() / "src/soda_storyboard/web":
        message = "Refusing to replace an editor output directory outside this repository."
        raise SystemExit(message)
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(editor / "dist", target)
    info = {
        "built_at": datetime.now(UTC).isoformat(),
        "version": json.loads((editor / "package.json").read_text(encoding="utf-8"))["version"],
        "source_hash": source_hash(editor),
    }
    (target / "build-info.json").write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
