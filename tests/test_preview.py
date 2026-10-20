from __future__ import annotations

from pathlib import Path

from soda_storyboard.io import load_page
from soda_storyboard.preview import render_preview


def test_preview_writes_png(tmp_path: Path) -> None:
    page = load_page("examples/station/pages/station-turn.json")
    output = render_preview(page, tmp_path / "preview.png")
    assert output.exists()
    assert output.stat().st_size > 100
