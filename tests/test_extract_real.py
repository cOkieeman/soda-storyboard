"""Local-only artwork stays in the ignored reference directory, never in fixtures.

Boxes were annotated by looking at the source pages, in page-relative coordinates.
Occluded sides are the intended frame extent, not the foreground silhouette.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from soda_storyboard.extract import extract_layout
from soda_storyboard.geometry import shape_bbox

REFERENCES = Path(__file__).resolve().parents[1] / "docs/tasks/refs/extract-samples"
# Annotation order is Japanese reading order, including the tall spanning panels.
ANNOTATIONS = {
    "s1_pudding_color.png": [
        (0.510, 0.018, 0.974, 0.323),
        (0.027, 0.018, 0.490, 0.323),
        (0.724, 0.355, 0.974, 0.702),
        (0.217, 0.323, 0.779, 0.774),
        (0.027, 0.355, 0.269, 0.702),
        (0.027, 0.791, 0.974, 0.984),
    ],
    "s2_bw_manga_6.png": [
        (0.428, 0.012, 0.983, 0.490),
        (0.018, 0.011, 0.419, 0.123),
        (0.018, 0.134, 0.419, 0.350),
        (0.018, 0.362, 0.419, 0.490),
        (0.507, 0.502, 0.983, 0.985),
        (0.018, 0.502, 0.494, 0.985),
    ],
    "s3_misaki_5.png": [
        (0.638, 0.022, 0.974, 0.480),
        (0.030, 0.022, 0.620, 0.161),
        (0.030, 0.173, 0.620, 0.480),
        (0.000, 0.493, 1.000, 1.000),
        (0.023, 0.532, 0.226, 0.952),
    ],
    "s4_maid_light_frames_6.png": [
        (0.510, 0.029, 0.975, 0.341),
        (0.023, 0.029, 0.490, 0.341),
        (0.510, 0.358, 0.975, 0.657),
        (0.023, 0.358, 0.490, 0.657),
        (0.510, 0.674, 0.975, 0.971),
        (0.023, 0.674, 0.490, 0.971),
    ],
    "s5_bw_4panel.png": [
        (0.018, 0.014, 0.983, 0.324),
        (0.510, 0.336, 0.983, 0.655),
        (0.018, 0.336, 0.494, 0.655),
        (0.018, 0.667, 0.983, 0.985),
    ],
}


def intersection_over_union(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    intersection = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
    areas = [(box[2] - box[0]) * (box[3] - box[1]) for box in (a, b)]
    return intersection / (sum(areas) - intersection)


@pytest.mark.parametrize("name", ANNOTATIONS)
def test_real_page_geometry(name: str) -> None:
    path = REFERENCES / name
    if not path.is_file():
        pytest.skip("Optional local reference artwork is not distributed")
    result = extract_layout(path)
    expected = ANNOTATIONS[name]
    actual = [shape_bbox(panel["normalized"]) for panel in result["panels"]]
    if name.startswith("s3_"):
        assert len(actual) in {4, 5}
        expected = expected[: len(actual)]
    else:
        assert len(actual) == len(expected)
    # Match one-to-one; a large merged region cannot satisfy two annotations.
    matched = []
    for box in expected:
        index = max(range(len(actual)), key=lambda i: intersection_over_union(box, actual[i]))
        assert intersection_over_union(box, actual[index]) >= 0.8, (name, box, actual)
        matched.append(result["panels"][index]["order"])
        actual[index] = (0, 0, 0, 0)
    assert matched == sorted(matched)
    assert all(0 <= panel["confidence"] <= 1 for panel in result["panels"])
    if any(panel["confidence"] < 0.7 for panel in result["panels"]):
        assert not result["reliable"]
        assert result["warnings"]
