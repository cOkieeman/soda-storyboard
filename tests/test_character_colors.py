from __future__ import annotations

import pytest
from PIL import Image, ImageFont

from soda_storyboard.figures import character_sketch_color, draw_primitives, figure_geometry
from soda_storyboard.models import Character, Figure


@pytest.mark.parametrize("color", ["#b44a3a", "#B44A3A", "#abc"])
@pytest.mark.parametrize("editable", [False, True])
def test_character_color_reaches_both_geometry_paths_and_rgba_drawing(color: str, *, editable: bool) -> None:
    character = Character("girl", "Girl", extra={"sketch_color": color, "future": {"keep": True}})
    figure = Figure("girl", framing="full")
    if editable:
        figure.extra["editor"] = {"version": 1, "x": 160, "y": 270, "size": 200}
    geometry = figure_geometry((400, 600), figure, character, shot="full", color="red")
    expected = "#AABBCC" if color == "#abc" else "#B44A3A"
    assert geometry["color"] == expected
    image = Image.new("RGBA", (400, 600))
    draw_primitives(image, geometry, font=ImageFont.load_default(), show_name=False)
    pixels = {pixel for _, pixel in image.getcolors(image.width * image.height) if pixel[3]}
    assert pixels == {(*bytes.fromhex(expected[1:]), 255)}
    assert character.to_dict()["future"] == {"keep": True}


@pytest.mark.parametrize("value", [None, False, 3, [], "red", "#12", "#12345678", "rgba(1,2,3,1)"])
def test_missing_or_invalid_character_color_keeps_existing_renderer_default(value: object) -> None:
    character = Character("girl", "Girl", extra={"sketch_color": value})
    assert character_sketch_color(character, "red") == "red"
    assert character_sketch_color(None, "#00a8c4") == "#00a8c4"


def test_color_extension_and_unknown_character_fields_survive_model_roundtrip() -> None:
    source = {"id": "girl", "display_name": "Girl", "sketch_color": "#B44A3A", "future": {"keep": [1, 2]}}
    assert Character.from_dict(source).to_dict()["future"] == source["future"]
    assert Character.from_dict(source).to_dict()["sketch_color"] == source["sketch_color"]
