"""Generate original synthetic reference pages and extraction overlays offline.

Run from the repository: uv run python examples/layout-extract/generate_samples.py
These geometric test pages contain no commercial comic artwork.
"""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw

from soda_storyboard.extract import draw_extraction_preview, extract_layout
from soda_storyboard.io import write_json

# This is a standalone example generator, not an importable package.
# ruff: noqa: INP001


def rectangles(count: int) -> list[list[tuple[int, int]]]:
    counts = [2] * (count // 2) + ([1] if count % 2 else [])
    row_height = 720 // len(counts)
    panels = []
    for row, cells in enumerate(counts):
        for column in range(cells):
            x, y = 30 + column * 280, 30 + row * row_height + column * 8
            right = x + (540 if cells == 1 else 260)
            bottom = 30 + (row + 1) * row_height - 18
            panels.append([(x, y), (right, y), (right, bottom), (x, bottom)])
    return panels


def generate(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    layouts = {f"rect-{count}": rectangles(count) for count in range(3, 8)}
    layouts["diagonal"] = [
        [(30, 30), (240, 30), (330, 360), (30, 360)],
        [(260, 30), (570, 30), (570, 360), (350, 360)],
        [(30, 400), (500, 400), (570, 470), (570, 750), (30, 750)],
    ]
    layouts["spanning"] = [
        [(320, 30), (570, 30), (570, 750), (320, 750)],
        [(30, 40), (295, 40), (295, 250), (30, 250)],
        [(30, 275), (295, 275), (295, 490), (30, 490)],
        [(30, 515), (295, 515), (295, 750), (30, 750)],
    ]
    layouts["rotated"] = rectangles(5)
    for name, panels in layouts.items():
        image = Image.new("RGB", (600, 800), "#eeeeee")
        draw = ImageDraw.Draw(image)
        for polygon in panels:
            draw.line([*polygon, polygon[0]], fill="black", width=4)
            x, y = polygon[0]
            draw.ellipse((x + 20, y + 20, x + 110, y + 100), outline="black", width=3)
        rng = random.Random(42)  # noqa: S311 -- deterministic image noise
        for _ in range(120):
            draw.point((rng.randrange(600), rng.randrange(800)), fill="black")
        if name == "rotated":
            image = image.rotate(0.8, resample=Image.Resampling.BICUBIC, fillcolor="#eeeeee")
        source = directory / f"{name}.png"
        image.save(source)
        result = extract_layout(source)
        write_json(directory / f"{name}.json", result)
        draw_extraction_preview(image, result, directory / f"{name}-overlay.png")


if __name__ == "__main__":
    generate(Path(__file__).resolve().parent)
