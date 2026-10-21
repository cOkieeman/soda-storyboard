from __future__ import annotations

import json
import random
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from soda_storyboard.cli import main
from soda_storyboard.extract import draw_extraction_preview, extract_layout, reading_order, save_template
from soda_storyboard.geometry import shape_bbox
from soda_storyboard.io import read_json
from soda_storyboard.templates import suggest_layouts


def synthetic_page(path: Path, count: int = 5, *, angle: float = 0, gray: int = 255) -> list[tuple[int, ...]]:
    image = Image.new("RGB", (600, 800), (gray, gray, gray))
    draw = ImageDraw.Draw(image)
    counts = [2] * (count // 2) + ([1] if count % 2 else [])
    row_h = 720 // len(counts)
    boxes = []
    for row, cells in enumerate(counts):
        for col in range(cells):
            left = 30 + col * 280
            top = 30 + row * row_h + (8 if col else 0)
            right = left + (540 if cells == 1 else 260)
            bottom = 30 + (row + 1) * row_h - 18
            boxes.append((left, top, right, bottom))
            draw.rectangle(boxes[-1], outline="black", width=4)
            # Detached balloons and content strokes must not create extra panels.
            draw.ellipse((left + 20, top + 20, left + 110, top + 100), outline="black", width=3)
            draw.line((left + 30, bottom - 30, right - 30, top + 120), fill="black", width=2)
    rng = random.Random(5)  # noqa: S311 -- reproducible image noise
    for _ in range(180):
        draw.point((rng.randrange(600), rng.randrange(800)), fill="black")
    if angle:
        image = image.rotate(angle, resample=Image.Resampling.BICUBIC, fillcolor=(gray, gray, gray))
    image.save(path)
    return boxes


@pytest.mark.parametrize("count", range(3, 8))
@pytest.mark.parametrize(("angle", "gray"), [(0, 255), (0.8, 230), (-0.7, 245)])
def test_rectangle_detection_and_order(tmp_path: Path, count: int, angle: float, gray: int) -> None:
    path = tmp_path / "synthetic.png"
    expected = synthetic_page(path, count, angle=angle, gray=gray)
    result = extract_layout(path)
    assert result["panel_count"] == count
    assert result["source_image"] == "synthetic.png"
    for box in expected:
        nearest = min(
            result["panels"],
            key=lambda p: sum(abs(a - b) for a, b in zip(shape_bbox(p["shape"]), box, strict=True)),
        )
        assert shape_bbox(nearest["shape"]) == pytest.approx(box, abs=9)
    for row in range(count // 2):
        a, b = result["panels"][row * 2 : row * 2 + 2]
        assert shape_bbox(a["shape"])[0] > shape_bbox(b["shape"])[0]
    ltr = extract_layout(path, direction="ltr")
    assert shape_bbox(ltr["panels"][0]["shape"])[0] < shape_bbox(ltr["panels"][1]["shape"])[0]


def test_spanning_panel_keeps_earliest_row(tmp_path: Path) -> None:
    path = tmp_path / "spanning.webp"
    image = Image.new("RGB", (600, 800), "white")
    draw = ImageDraw.Draw(image)
    boxes = [(320, 30, 570, 750), (30, 40, 295, 250), (30, 275, 295, 490), (30, 515, 295, 750)]
    for box in boxes:
        draw.rectangle(box, outline="black", width=4)
    image.save(path, lossless=True)
    assert [shape_bbox(p["shape"]) for p in extract_layout(path)["panels"]] == boxes
    panels = [{"shape": {"type": "rect", "x": x, "y": y, "w": r - x, "h": b - y}} for x, y, r, b in boxes]
    assert [shape_bbox(p["shape"]) for p in reading_order(panels, "ltr")] == [
        boxes[1],
        boxes[0],
        boxes[2],
        boxes[3],
    ]


def test_slanted_frames_balloons_and_low_confidence(tmp_path: Path) -> None:
    image = Image.new("RGB", (600, 800), "white")
    draw = ImageDraw.Draw(image)
    for points in [
        [(30, 30), (240, 30), (330, 360), (30, 360)],
        [(260, 30), (570, 30), (570, 360), (350, 360)],
    ]:
        draw.line([*points, points[0]], fill="black", width=4)
    # Five-sided frame with an uncertain corner should return a conservative bbox.
    points = [(30, 400), (500, 400), (570, 470), (570, 750), (30, 750)]
    draw.line([*points, points[0]], fill="black", width=4)
    draw.ellipse((360, 80, 530, 240), outline="black", width=4)
    image.save(tmp_path / "diagonal.jpg", quality=95)
    result = extract_layout(tmp_path / "diagonal.jpg")
    assert result["panel_count"] == 3
    assert all(p["shape"]["type"] == "quad" or p["confidence"] < 0.7 for p in result["panels"][:2])
    assert result["panels"][2]["shape"]["type"] == "rect"
    assert result["panels"][2]["confidence"] < 0.7
    output = draw_extraction_preview(image, result, tmp_path / "overlay.png")
    assert Image.open(output).size == image.size
    template = read_json(save_template(result, tmp_path / "templates"))
    chosen = suggest_layouts(
        3, width=600, height=800, user_templates=tmp_path / "templates", pick=template["id"]
    )
    assert chosen[0]["source"] == "reference"


def test_save_and_cli_suggestion(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    path = tmp_path / "synthetic.png"
    synthetic_page(path, 5)
    project = tmp_path / "story"
    assert (
        main(
            [
                "layout",
                "extract",
                str(path),
                "--save",
                "--project",
                str(project),
                "--name",
                "My page",
                "--json",
            ]
        )
        == 0
    )
    result = json.loads(capsys.readouterr().out)
    template = read_json(result["template"])
    assert Path(result["preview"]).is_file()
    assert list(project.rglob("*.png")) == []
    assert template["source_image"] == path.name
    assert template["source_label"]
    suggested = suggest_layouts(5, user_templates=project / "templates")
    assert any(s["source"] == "reference" for s in suggested if "source" in s)
    chosen = suggest_layouts(5, user_templates=project / "templates", pick=template["id"])
    assert chosen[0]["source"] == "reference"
    assert (
        main(
            [
                "layout",
                "suggest",
                "--panels",
                "5",
                "--templates",
                str(project / "templates"),
                "--pick",
                template["id"],
            ]
        )
        == 0
    )
    assert "[来自参考页]" in capsys.readouterr().out


def test_invalid_and_empty_inputs(tmp_path: Path) -> None:
    path = tmp_path / "blank.png"
    Image.new("RGB", (100, 100), "white").save(path)
    result = extract_layout(path)
    assert result["panels"] == []
    with pytest.raises(ValueError, match="requires"):
        save_template(result, tmp_path)
    with pytest.raises(ValueError, match="direction"):
        extract_layout(path, direction="up")
    path.write_text("invalid", encoding="utf-8")
    with pytest.raises(ValueError, match="Invalid"):
        extract_layout(path)


@pytest.mark.parametrize("angle", [0.8, -0.7])
def test_rotated_reference_template_can_be_suggested(tmp_path: Path, angle: float) -> None:
    path = tmp_path / "page.png"
    synthetic_page(path, 5, angle=angle)
    template = read_json(save_template(extract_layout(path), tmp_path / "templates"))
    layouts = suggest_layouts(
        5, user_templates=tmp_path / "templates", pick=template["id"], width=600, height=800
    )
    assert layouts[0]["source"] == "reference"
