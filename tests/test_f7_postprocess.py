"""Production quality regressions use an in-memory Comfy client, never a GPU."""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image, ImageChops

from soda_storyboard.io import read_json, write_json
from soda_storyboard.models import Overlay
from soda_storyboard.production import api
from soda_storyboard.production.errors import ProductionError
from soda_storyboard.production.imaging import working_size
from soda_storyboard.production.state import PageState


class CapturingComfy:
    def __init__(self) -> None:
        self.uploads: dict[str, Image.Image] = {}
        self.graphs: list[dict] = []

    def upload(self, path: Path) -> str:
        name = f"upload-{len(self.uploads)}.png"
        with Image.open(path) as image:
            self.uploads[name] = image.copy()
        return name

    def object_info(self, name: str) -> dict:
        if name != "RMBG":
            return {}
        return {name: {"input": {"required": {"image": ["IMAGE"]}}, "output": ["IMAGE"]}}

    def run(self, graph: dict, destination: Path, **_kwargs: object) -> None:
        self.graphs.append(graph)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if "11" in graph:
            size = self.uploads[graph["11"]["inputs"]["image"]].size
        else:
            inputs = graph["7"]["inputs"]
            size = inputs["width"], inputs["height"]
        image = Image.new("RGB", size, (210, 90, 40))
        if "cutout" in graph:
            image = image.convert("RGBA")
            image.putalpha(100)
        image.save(destination)


@pytest.fixture
def capture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, CapturingComfy]:
    root = tmp_path / "project"
    for folder in ("pages", "characters"):
        (root / folder).mkdir(parents=True)
    write_json(root / "project.json", {"name": "quality", "default_dialogue_mode": "lettering"})
    for name in ("whale", "sylvia"):
        write_json(
            root / "characters" / f"{name}.json",
            {
                "id": name,
                "display_name": name,
                "appearance_en": "long hair, a detailed dress",
                "trigger_words": [f"{name}_trigger"],
                "lora": {"path": f"{name}.safetensors", "strength": 0.8},
            },
        )
    write_json(
        root / "pages" / "quality.json",
        {
            "id": "quality",
            "canvas_width": 640,
            "canvas_height": 800,
            "style_prefix": "clean cel shading",
            "panels": [
                {
                    "id": "p2",
                    "order": 1,
                    "shape": {"type": "rect", "x": 0, "y": 0, "w": 288, "h": 400},
                    "character_ids": ["whale"],
                    "description": (
                        "The whale girl misses the flying drawing sheet, reaching both hands left."
                    ),
                    "caption_en": "The whale girl misses the flying drawing sheet, reaching both hands left.",
                    "use_custom_caption": True,
                    "figures": [{"character_id": "whale", "position": "center"}],
                },
                {
                    "id": "p6",
                    "order": 2,
                    "shape": {"type": "rect", "x": 0, "y": 400, "w": 448, "h": 400},
                    "character_ids": ["sylvia", "whale"],
                    "description": "The two girls exchange an awkward stare.",
                    "figures": [
                        {"character_id": "sylvia", "position": "left"},
                        {"character_id": "whale", "position": "right"},
                    ],
                },
            ],
            "overlays": [
                {
                    "id": "hand",
                    "mode": "layer",
                    "character_id": "sylvia",
                    "description": "Only the hand, wrist and paper.",
                    "rect": {"x": 200, "y": 300, "w": 280, "h": 260},
                }
            ],
            "production": {"selected_render": "base.png", "renders": [{"path": "base.png"}]},
        },
    )
    Image.new("RGB", (640, 800), (22, 37, 64)).save(root / "base.png")
    fake = CapturingComfy()
    monkeypatch.setattr(PageState, "client", lambda _self: fake)
    return root, fake


@pytest.mark.parametrize(
    ("source", "expected"),
    [((288, 400), (736, 1024)), ((448, 400), (1024, 912)), ((280, 260), (1024, 944))],
)
def test_working_resolution_is_aligned_and_proportional(source: tuple, expected: tuple) -> None:
    assert working_size(*source) == expected
    assert abs(expected[0] / expected[1] - source[0] / source[1]) < 0.01


def test_redraw_upscales_then_returns_and_pastes_exact_panel(capture: tuple) -> None:
    root, fake = capture
    result = api.redraw_panel(root, "quality", "p2", mode="swap", character_id="whale", seed=11)
    graph = fake.graphs[-1]
    assert fake.uploads[graph["11"]["inputs"]["image"]].size == (736, 1024)
    assert graph["8"]["inputs"]["seed"] == 11
    assert result["seed"] == 11
    assert result["working_size"] == [736, 1024]
    assert Image.open(result["path"]).size == (288, 400)
    prompt = graph["5"]["inputs"]["text"]
    assert "misses the flying drawing sheet, reaching both hands left" in prompt
    assert "Replace only the target character's appearance" in prompt
    assert "whale_trigger" in prompt
    api.pick_panel(root, "quality", "p2", result["path"])
    composed = Image.open(api.compose_page(root, "quality"))
    assert composed.getpixel((100, 100)) == (210, 90, 40)
    assert composed.getpixel((500, 100)) == (22, 37, 64)


def test_inpaint_encodes_original_rgb_with_separate_feathered_noise_mask(capture: tuple) -> None:
    root, fake = capture
    preview = api.inpaint_panel(root, "quality", "p6", character_id="whale", mask_only=True)
    assert not fake.graphs
    mask_preview = Image.open(preview["mask"])
    result = api.inpaint_panel(root, "quality", "p6", character_id="whale", seed=12)
    graph = fake.graphs[-1]
    rgb = fake.uploads[graph["11"]["inputs"]["image"]]
    noise_mask = fake.uploads[graph["12"]["inputs"]["image"]]
    assert rgb.mode == "RGB"
    assert rgb.size == (1024, 912)
    assert rgb.getpixel((800, 450)) == (22, 37, 64)
    assert noise_mask.size == rgb.size
    assert graph["12"]["class_type"] == "LoadImageMask"
    assert graph["12"]["inputs"]["channel"] == "red"
    assert graph["13"]["inputs"]["pixels"] == ["11", 0]
    assert graph["14"]["inputs"]["mask"] == ["12", 0]
    # Blend once at native resolution; a second server blend would square alpha
    # and make mask-only differ from the actual blend.
    assert graph["10"]["inputs"]["images"] == ["9", 0]
    assert graph["8"]["inputs"]["seed"] == result["seed"] == 12
    actual = Image.open(result["path"])
    mask = Image.open(result["mask"])
    assert not ImageChops.difference(mask, mask_preview).getbbox()
    assert any(0 < value < 255 for value in mask.tobytes())
    expected = Image.composite(
        Image.new("RGB", mask.size, (210, 90, 40)), Image.new("RGB", mask.size, (22, 37, 64)), mask
    )
    assert not ImageChops.difference(actual, expected).getbbox()
    preview_image = Image.open(preview["preview"])
    assert len(set(preview_image.get_flattened_data())) > 2
    prompt = graph["5"]["inputs"]["text"]
    assert "editor figure bounds" in prompt
    assert "same shot distance and matching body scale" in prompt


@pytest.mark.parametrize(
    ("description", "explicit", "expected"),
    [
        ("Only the hand, wrist and paper.", "auto", "partial"),
        ("A full body character standing.", "auto", "whole"),
        ("A full body character, hands holding a paper and a wristwatch.", "auto", "whole"),
        ("A floating sheet of paper.", "auto", "object"),
        ("Anything ambiguous", "auto", "object"),
        ("A complete character", "partial", "partial"),
        ("A hand-shaped clay sculpture", "object", "object"),
    ],
)
def test_cutout_templates_follow_framing(
    capture: tuple, description: str, explicit: str, expected: str
) -> None:
    root, fake = capture
    path = root / "pages/quality.json"
    page = read_json(path)
    page["style_prompt"] = "2D Japanese anime, flat cel shading"
    page["overlays"][0].update(description=description, cutout_type=explicit)
    write_json(path, page)
    result = api.cutout(root, "quality", "hand", seed=13)
    graph = fake.graphs[-1]
    prompt = graph["5"]["inputs"]["text"]
    assert ("full body" in prompt) == (expected == "whole")
    assert "plain solid white background" in prompt
    assert "2D Japanese anime, flat cel shading" in prompt
    assert "clean cel shading" in prompt
    assert result["cutout_type"] == expected
    assert result["seed"] == graph["8"]["inputs"]["seed"] == 13
    assert result["working_size"] == [1024, 944]
    assert read_json(path)["production"]["overlays"]["hand"]["seed"] == 13
    if expected == "partial":
        assert "long hair, a detailed dress" not in prompt
        assert "sylvia_trigger" in prompt
    if expected == "object":
        assert "lora" not in graph
        assert "sylvia_trigger" not in prompt


def test_explicit_generation_seed_list_overrides_candidate_count_and_records(capture: tuple) -> None:
    root, fake = capture
    result = api.generate_page(root, "quality", seeds=4, seed=[0, 2**64 - 1, 0])
    assert [item["seed"] for item in result] == [0, 2**64 - 1, 0]
    assert [graph["8"]["inputs"]["seed"] for graph in fake.graphs] == [0, 2**64 - 1, 0]
    assert len({item["path"] for item in result}) == 3
    assert [item["seed"] for item in read_json(root / "pages/quality.json")["production"]["renders"][1:]] == [
        0,
        2**64 - 1,
        0,
    ]


@pytest.mark.parametrize("seed", [-1, True, 2**64, "7", []])
def test_invalid_seeds_do_not_submit(capture: tuple, seed: object) -> None:
    root, fake = capture
    with pytest.raises(ProductionError, match="seed"):
        api.generate_page(root, "quality", seed=seed)
    assert not fake.graphs


def test_cutout_type_roundtrips_and_is_in_both_schema_copies() -> None:
    root = Path(__file__).resolve().parents[1]
    raw = {"id": "detail", "character_id": "a", "rect": {}, "cutout_type": "partial"}
    assert Overlay.from_dict(raw).to_dict()["cutout_type"] == "partial"
    canonical = root / "schema/storyboard-v1.schema.json"
    assert (
        canonical.read_bytes()
        == (root / "skill/skills/soda-storyboard/assets/storyboard-v1.schema.json").read_bytes()
    )
    assert read_json(canonical)["$defs"]["overlay"]["properties"]["cutout_type"]["enum"] == [
        "auto",
        "whole",
        "partial",
        "object",
    ]
