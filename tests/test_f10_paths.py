from __future__ import annotations

import os
from pathlib import Path

import pytest

from soda_storyboard.io import write_json
from soda_storyboard.models import Page
from soda_storyboard.production import state as state_module
from soda_storyboard.production.paths import production_path
from soda_storyboard.production.state import PageState, configure

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows resolved path namespaces")


def extended(path: Path) -> Path:
    text = str(path)
    return Path("\\\\?\\UNC\\" + text[2:] if text.startswith("\\\\") else "\\\\?\\" + text)


@pytest.mark.parametrize("root", [Path("C:/project"), Path("//server/share/project")])
@pytest.mark.parametrize("root_prefix", [False, True])
@pytest.mark.parametrize("target_prefix", [False, True])
def test_resolved_namespaces_compare_as_one_project(
    monkeypatch: pytest.MonkeyPatch, root: Path, *, root_prefix: bool, target_prefix: bool
) -> None:
    target = root / "pages" / "render.png"

    def resolve(path: Path) -> Path:
        if path in (root, extended(root)):
            return extended(root) if root_prefix else root
        if path in (target, extended(target)):
            return extended(target) if target_prefix else target
        msg = f"Unexpected resolution (no network or filesystem access allowed): {path}"
        raise AssertionError(msg)

    monkeypatch.setattr(Path, "resolve", resolve)
    assert production_path(root, "pages/render.png") == target


@pytest.mark.parametrize("outside", [Path("C:/other/render.png"), Path("D:/project/render.png")])
def test_resolved_prefix_does_not_allow_a_real_escape(monkeypatch: pytest.MonkeyPatch, outside: Path) -> None:
    root = Path("C:/project")

    def resolve(path: Path) -> Path:
        return root if path == root else extended(outside)

    monkeypatch.setattr(Path, "resolve", resolve)
    with pytest.raises(ValueError, match="路径"):
        production_path(root, "linked/render.png")


@pytest.mark.parametrize(
    "value", [r"\\?\C:\project\image.png", r"\\?\UNC\server\share\image.png", "C:/image.png", "../image.png"]
)
def test_persisted_path_syntax_is_rejected_before_resolution(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    def forbidden_resolve(_path: Path) -> Path:
        pytest.fail("Invalid persisted paths must be rejected before resolve")

    monkeypatch.setattr(Path, "resolve", forbidden_resolve)
    with pytest.raises(ValueError, match="路径"):
        production_path(Path("C:/project"), value)


def test_page_state_normalizes_its_project_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    write_json(tmp_path / "project.json", {})
    write_json(tmp_path / "pages" / "p.json", Page(page_id="p").to_dict())
    expected = tmp_path.resolve()
    resolve = Path.resolve

    def prefixed_root(path: Path) -> Path:
        return extended(expected) if path == tmp_path else resolve(path)

    monkeypatch.setattr(Path, "resolve", prefixed_root)
    assert PageState(tmp_path, "p").root == expected


def test_page_state_relative_normalizes_resolved_namespace(monkeypatch: pytest.MonkeyPatch) -> None:
    state = object.__new__(PageState)
    state.root = Path("C:/project")
    target = state.root / "pages" / "render.png"
    monkeypatch.setattr(Path, "resolve", lambda _path: extended(target))
    assert state.relative(target) == "pages/render.png"


def test_configure_normalizes_its_project_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    expected = tmp_path.resolve()
    observed = []

    def read_config(path: Path) -> dict:
        observed.append(path)
        return {}

    monkeypatch.setattr(Path, "resolve", lambda _path: extended(expected))
    monkeypatch.setattr(state_module, "read_json", read_config)
    configure(tmp_path)
    assert observed == [expected / "project.json"]
