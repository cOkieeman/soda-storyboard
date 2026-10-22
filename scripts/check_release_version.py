"""Check the core, plugin, lockfile, and optional release tag versions."""

# ruff: noqa: INP001 -- standalone repository maintenance script

from __future__ import annotations

import argparse
import json
import sys
import tomllib
from pathlib import Path

PLUGIN_MANIFESTS = (
    "skill/plugin.json",
    "skill/.codex-plugin/plugin.json",
    "skill/.claude-plugin/plugin.json",
)


def check_release_version(root: Path, tag: str | None = None) -> str:
    """Return the project version, rejecting inconsistent release metadata."""
    project = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    version = project["version"]
    if not isinstance(version, str) or not version:
        message = "pyproject.toml must declare a nonempty project.version"
        raise ValueError(message)
    if tag is not None and tag != f"v{version}":
        message = f"Release tag {tag!r} does not match pyproject.toml version v{version}"
        raise ValueError(message)
    for filename in PLUGIN_MANIFESTS:
        manifest = json.loads((root / filename).read_text(encoding="utf-8"))
        if manifest.get("version") != version:
            message = f"{filename} version {manifest.get('version')!r} does not match {version}"
            raise ValueError(message)
    lock = tomllib.loads((root / "uv.lock").read_text(encoding="utf-8"))
    packages = [package for package in lock.get("package", []) if package.get("name") == project["name"]]
    if len(packages) != 1 or packages[0].get("version") != version:
        message = f"uv.lock must contain exactly one {project['name']} package at version {version}"
        raise ValueError(message)
    return version


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tag", nargs="?", help="Exact release tag, such as v0.4.0")
    args = parser.parse_args()
    try:
        version = check_release_version(Path(__file__).resolve().parents[1], args.tag)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Release version check failed: {error}", file=sys.stderr)  # noqa: T201
        return 1
    print(version)  # noqa: T201 -- output is used by the release workflow
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
