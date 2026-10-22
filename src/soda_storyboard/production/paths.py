"""Validate persisted production file references before resolving local files."""

from __future__ import annotations

from pathlib import Path, PureWindowsPath
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Iterator

# Forward-compatible production dictionaries contain heterogeneous JSON.
# ruff: noqa: ANN401, RUF001

PATH_FIELDS = frozenset(
    {"path", "selected_render", "selected", "source_render", "mask", "candidate_sheet", "underlay", "font"}
)


def production_path(root: Path | None, value: Any, *, allow_absolute: bool = False) -> Path:
    """Require a project-relative path, then resolve symlinks inside its root."""
    if not isinstance(value, (str, Path)) or not str(value):
        message = "production 路径必须是非空的项目内相对路径"
        raise ValueError(message)
    text = str(value).replace("\\", "/")
    path = Path(value)
    windows = PureWindowsPath(text)
    absolute = path.is_absolute()
    if (
        "\x00" in text
        or any(part in {"..", "."} for part in text.split("/"))
        or (not allow_absolute and (absolute or windows.drive or windows.root))
        or (allow_absolute and not absolute and (windows.drive or windows.root))
        or any(":" in part for part in text.split("/") if not (absolute and part == windows.drive))
    ):
        message = "production 路径必须是项目内相对路径，不能包含绝对路径、盘符或上级目录"
        raise ValueError(message)
    if root is None:
        return Path(text)
    root = root.resolve()
    target = (root / Path(text)).resolve()
    if not target.is_relative_to(root):
        message = "production 路径不能越出项目目录（包括符号链接）"
        raise ValueError(message)
    return target


def _references(item: Any, location: str = "page", *, production: bool = False) -> Iterator[tuple[str, Any]]:
    if isinstance(item, dict):
        for key, child in item.items():
            target = f"{location}.{key}"
            if (
                key in {"image_path", "selected_render", "candidate_sheet"}
                or (production and key in PATH_FIELDS)
            ) and child is not None:
                yield target, child
            # Model identifiers belong to the generation backend, rather
            # than the project's local-file namespace.
            elif not production or key not in {"meta", "lora"}:
                yield from _references(
                    child, target, production=production or key in {"production", "renders"}
                )
    elif isinstance(item, list):
        for index, child in enumerate(item):
            yield from _references(child, f"{location}[{index}]", production=production)


def validate_production_paths(value: Any, root: Path | None = None) -> list[str]:
    """Check page, panel and future production records without reading files."""
    errors = []
    for location, path in _references(value):
        try:
            production_path(root, path)
        except (ValueError, OSError) as exc:
            errors.append(f"{location}：{exc}")
    return errors
