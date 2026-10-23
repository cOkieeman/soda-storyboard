from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest
from PIL import Image

from soda_storyboard.compiler import compile_geometry_map, compile_page
from soda_storyboard.io import write_json
from soda_storyboard.models import Page, Panel, RectShape
from soda_storyboard.production.api import compose_with_options
from soda_storyboard.production.errors import ProductionError
from soda_storyboard.production.imaging import inset_quad
from soda_storyboard.validation import validate_page


@pytest.mark.parametrize("mode", ["cut", "rect"])
@pytest.mark.parametrize(
    ("shape", "bbox"),
    [
        (RectShape(100, 0, 1, 101), [-50, 50, 51, 51]),
        (RectShape(0, 100, 101, 1), [50, -50, 51, 51]),
        (RectShape(0, 0, 1, 101), [-50, -50, 51, -49]),
        (RectShape(0, 0, 101, 1), [-50, -50, -49, 51]),
        (RectShape(0, 0, 101, 101), [-50, -50, 51, 51]),
    ],
)
def test_odd_canvas_preserves_border_pixels(mode: str, shape: RectShape, bbox: list[int]) -> None:
    page = Page(canvas_width=101, canvas_height=101, panels=[Panel("p", 1, shape)])
    assert not validate_page(page).errors
    assert compile_page(page, slant_mode=mode)["items"][0]["bbox"] == bbox
    assert compile_geometry_map(page, slant_mode=mode)["panels"][0]["bbox"] == bbox


@pytest.mark.parametrize("mode", ["cut", "hint", "rect"])
@pytest.mark.parametrize("compiler", [compile_page, compile_geometry_map])
def test_all_modes_reject_quantized_zero_area(mode: str, compiler: Callable[..., dict]) -> None:
    page = Page(panels=[Panel("p", 1, RectShape(10, 10, 0.1, 100))])
    assert not validate_page(page).errors
    with pytest.raises(ValueError, match="positive-area integer MOSS bbox"):
        compiler(page, slant_mode=mode)


def test_hint_on_odd_canvas_keeps_inward_quantization() -> None:
    page = Page(canvas_width=101, canvas_height=101, panels=[Panel("p", 1, RectShape(99, 0, 2, 101))])
    assert compile_page(page, slant_mode="hint")["items"][0]["bbox"] == [-50, 49, 50, 50]
    page.panels[0] = Panel("p", 1, RectShape(100, 0, 1, 101))
    with pytest.raises(ValueError, match="positive-area integer MOSS bbox"):
        compile_page(page, slant_mode="hint")


@pytest.mark.parametrize("clockwise", [False, True])
@pytest.mark.parametrize(
    ("points", "inset"),
    [
        ([[0, 0], [100, 0], [100, 100], [0, 100]], 50),
        ([[0, 0], [200, 0], [200, 100], [0, 100]], 50),
        ([[0, 0], [140, 0], [80, 80], [60, 80]], 20),
    ],
)
def test_inset_rejects_collapsed_area_or_edge(
    points: list[list[int]], inset: int, *, clockwise: bool
) -> None:
    oriented_points = list(reversed(points)) if clockwise else points
    with pytest.raises(ProductionError, match="太大"):
        inset_quad(oriented_points, inset)


def test_inset_near_collapse_preserves_positive_region() -> None:
    points = [[0, 0], [100, 0], [100, 100], [0, 100]]
    result = inset_quad(points, 49)
    assert result == [(49, 49), (51, 49), (51, 51), (49, 51)]


def test_compose_rejects_exactly_collapsed_quad_without_writing(tmp_path: Path) -> None:
    write_json(tmp_path / "project.json", {})
    page = Page(
        page_id="p",
        canvas_width=100,
        canvas_height=100,
        panels=[Panel("a", 1, {"type": "quad", "points": [[0, 0], [100, 0], [100, 100], [0, 100]]})],
    )
    directory = tmp_path / "pages" / "p"
    directory.mkdir(parents=True)
    Image.new("RGB", (100, 100), "red").save(directory / "base.png")
    payload = page.to_dict()
    payload["production"] = {"selected_render": "pages/p/base.png"}
    path = write_json(tmp_path / "pages" / "p.json", payload)
    before = path.read_bytes()
    with pytest.raises(ProductionError, match="太大"):
        compose_with_options(tmp_path, "p", cut_inset=50)
    assert path.read_bytes() == before
    assert not (directory / "composed.png").exists()
    assert not (directory / "composed-underlay.png").exists()
