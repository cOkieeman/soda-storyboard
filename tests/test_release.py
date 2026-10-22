from __future__ import annotations

import json
import os
import runpy
import shutil
import subprocess
import sys
import tarfile
import tomllib
import zipfile
from pathlib import Path

import pytest

# Only local build tools and generated, trusted archives are used in these tests.
# ruff: noqa: S603

ROOT = Path(__file__).resolve().parents[1]
RELEASE_SCRIPT = ROOT / "scripts/check_release_version.py"
RELEASE_CHECK = runpy.run_path(str(RELEASE_SCRIPT))["check_release_version"]
MANIFESTS = (
    "skill/plugin.json",
    "skill/.codex-plugin/plugin.json",
    "skill/.claude-plugin/plugin.json",
)


@pytest.fixture
def metadata_root(tmp_path: Path) -> Path:
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname = "soda-storyboard"\nversion = "0.4.0"\n', encoding="utf-8"
    )
    (tmp_path / "uv.lock").write_text(
        'version = 1\n[[package]]\nname = "soda-storyboard"\nversion = "0.4.0"\n', encoding="utf-8"
    )
    for filename in MANIFESTS:
        path = tmp_path / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"version": "0.4.0"}), encoding="utf-8")
    return tmp_path


def test_repository_release_versions_match() -> None:
    assert RELEASE_CHECK(ROOT, "v0.4.1") == "0.4.1"


def test_version_check_without_tag(metadata_root: Path) -> None:
    assert RELEASE_CHECK(metadata_root) == "0.4.0"


@pytest.mark.parametrize("tag", ["0.4.0", "v0.3.1", "v0.4.0-rc1", "v0.4.0 ", "refs/tags/v0.4.0"])
def test_release_tag_must_match_exactly(metadata_root: Path, tag: str) -> None:
    with pytest.raises(ValueError, match="Release tag"):
        RELEASE_CHECK(metadata_root, tag)


@pytest.mark.parametrize("filename", MANIFESTS)
@pytest.mark.parametrize("version", ["0.3.1", None])
def test_plugin_manifest_mismatch_is_rejected(
    metadata_root: Path, filename: str, version: str | None
) -> None:
    (metadata_root / filename).write_text(json.dumps({"version": version}), encoding="utf-8")
    with pytest.raises(ValueError, match=filename.replace(".", r"\.")):
        RELEASE_CHECK(metadata_root, "v0.4.0")


@pytest.mark.parametrize(
    "packages",
    [
        [],
        [{"name": "soda-storyboard", "version": "0.3.1"}],
        [
            {"name": "soda-storyboard", "version": "0.4.0"},
            {"name": "soda-storyboard", "version": "0.4.0"},
        ],
    ],
)
def test_lockfile_mismatch_is_rejected(metadata_root: Path, packages: list[dict[str, str]]) -> None:
    lines = ["version = 1"]
    for package in packages:
        lines.extend(["[[package]]", f'name = "{package["name"]}"', f'version = "{package["version"]}"'])
    (metadata_root / "uv.lock").write_text("\n".join(lines) + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match=r"uv\.lock"):
        RELEASE_CHECK(metadata_root, "v0.4.0")


def test_release_check_cli_rejects_mismatched_tag() -> None:
    result = subprocess.run(
        [sys.executable, str(RELEASE_SCRIPT), "v0.0.0"], capture_output=True, text=True, check=False
    )
    assert result.returncode == 1
    assert "Release version check failed" in result.stderr
    assert "does not match" in result.stderr
    assert not result.stdout


@pytest.fixture(scope="module")
def distributions(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path, Path]:
    uv = shutil.which("uv")
    assert uv is not None, "The distribution audit requires uv (also used by CI and the release workflow)."
    output = tmp_path_factory.mktemp("release-dist")
    commands = [
        [uv, "build", "--offline", "--no-python-downloads", "--out-dir", str(output), str(ROOT)],
    ]
    for command in commands:
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=120, check=False)
        assert result.returncode == 0, result.stdout + result.stderr
    version = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]["version"]
    wheel = output / f"soda_storyboard-{version}-py3-none-any.whl"
    sdist = output / f"soda_storyboard-{version}.tar.gz"
    assert wheel.is_file()
    assert sdist.is_file()
    rebuilt = output / "from-sdist"
    result = subprocess.run(
        [uv, "build", "--offline", "--no-python-downloads", "--wheel", str(sdist), "--out-dir", str(rebuilt)],
        cwd=output,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return wheel, sdist, rebuilt / wheel.name


def test_wheel_contains_all_runtime_modules_and_data(
    distributions: tuple[Path, Path, Path], tmp_path: Path
) -> None:
    wheel, _, _ = distributions
    package = ROOT / "src/soda_storyboard"
    with zipfile.ZipFile(wheel) as archive:
        archive.extractall(tmp_path)  # noqa: S202 -- trusted archive built from this repository
    installed = tmp_path / "soda_storyboard"
    runtime_files = [
        *package.rglob("*.py"),
        package / "recipes.json",
        *(package / "data").glob("*.json"),
        *[path for path in (package / "web").rglob("*") if path.is_file()],
    ]
    for source in runtime_files:
        target = installed / source.relative_to(package)
        assert target.is_file(), f"Wheel is missing {source.relative_to(package)}"
        assert target.read_bytes() == source.read_bytes()
    assert (installed / "web/index.html").is_file()
    assert (installed / "web/build-info.json").is_file()
    assert list((installed / "web/assets").glob("*.js"))
    assert list((installed / "web/assets").glob("*.css"))
    assert not (tmp_path / "tests").exists()
    assert not (tmp_path / "editor/node_modules").exists()
    environment = {**os.environ, "PYTHONPATH": str(tmp_path)}
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from importlib.resources import files; "
                "from soda_storyboard.bundle import compile_bundle, load_bundle; "
                "from soda_storyboard.templates import builtin_templates; "
                "assert builtin_templates(); "
                "assert (files('soda_storyboard') / 'web/index.html').is_file()"
            ),
        ],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_sdist_preserves_runtime_data_and_rebuilds_the_same_wheel(
    distributions: tuple[Path, Path, Path],
) -> None:
    wheel, sdist, rebuilt = distributions
    with tarfile.open(sdist) as archive:
        names = archive.getnames()
    prefix = sdist.name.removesuffix(".tar.gz")
    for filename in [
        "pyproject.toml",
        "NOTICE",
        "src/soda_storyboard/recipes.json",
        "src/soda_storyboard/data/templates.json",
        "src/soda_storyboard/web/index.html",
        "src/soda_storyboard/web/build-info.json",
    ]:
        assert f"{prefix}/{filename}" in names
    with zipfile.ZipFile(wheel) as original, zipfile.ZipFile(rebuilt) as derived:
        assert original.namelist() == derived.namelist()
        for filename in original.namelist():
            assert original.read(filename) == derived.read(filename), filename
