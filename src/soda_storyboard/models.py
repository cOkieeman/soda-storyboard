"""Data models for the ``soda-storyboard-v1`` file format.

The project deliberately keeps the model layer small and dependency free.  The
classes below are ordinary dataclasses with explicit ``from_dict`` and
``to_dict`` methods, so callers can use them from both the CLI and an editor
without pulling in a validation framework.  ``from_dict`` accepts a handful of
legacy aliases (for example ``canvas`` and ``width``/``height``) while
``to_dict`` always emits the canonical v1 representation.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from math import isfinite
from typing import Any

PROJECT_FORMAT = "soda-storyboard-project-v1"
PAGE_FORMAT = "soda-storyboard-page-v1"
CHARACTER_FORMAT = "soda-storyboard-character-v1"

READING_DIRECTIONS = ("rtl", "ltr")
DIALOGUE_MODES = ("moss_text", "lettering")
SHOT_SIZES = (
    "extreme_long",
    "long",
    "full",
    "medium",
    "close_up",
    "extreme_close_up",
)
CAMERA_ANGLES = ("eye", "high", "low", "bird", "worm", "dutch")
BUBBLE_TYPES = ("speech", "shout", "thought", "narration")
PANEL_STATUSES = ("draft", "approved", "needs_redraw")

type JsonObject = dict[str, Any]
type Point = tuple[float, float]


def _number(value: Any, name: str) -> float:
    """Return a finite numeric value, preserving integer values where useful."""

    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be a number")
    result = float(value)
    if not isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result


def _text(value: Any, name: str, *, default: str = "") -> str:
    if value is None:
        return default
    if not isinstance(value, str):
        raise TypeError(f"{name} must be a string")
    return value


def _strings(value: Any, name: str) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if not isinstance(value, Sequence) or isinstance(value, (bytes, bytearray)):
        raise TypeError(f"{name} must be a list of strings")
    return [_text(item, f"{name}[]") for item in value]


def _copy_extra(data: Mapping[str, Any], known: set[str]) -> JsonObject:
    """Copy unknown keys so a read/write round-trip does not lose metadata."""

    return {key: value for key, value in data.items() if key not in known}


@dataclass(slots=True)
class RectShape:
    """A rectangular panel shape in top-left-origin pixel coordinates."""

    x: float
    y: float
    w: float
    h: float

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> RectShape:
        return cls(
            _number(value.get("x", 0), "shape.x"),
            _number(value.get("y", 0), "shape.y"),
            _number(value.get("w", value.get("width", 0)), "shape.w"),
            _number(value.get("h", value.get("height", 0)), "shape.h"),
        )

    def to_dict(self) -> JsonObject:
        return {"type": "rect", "x": self.x, "y": self.y, "w": self.w, "h": self.h}


@dataclass(slots=True)
class QuadShape:
    """A four-corner panel shape in top-left-origin pixel coordinates."""

    points: tuple[Point, Point, Point, Point]

    def __post_init__(self) -> None:
        if len(self.points) != 4:
            raise ValueError("quad shape must contain four points")
        self.points = tuple(
            (_number(point[0], "quad.x"), _number(point[1], "quad.y")) for point in self.points
        )  # type: ignore[assignment]

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> QuadShape:
        raw = value.get("points", value.get("corners"))
        if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes, bytearray)):
            raise TypeError("shape.points must be a list of four [x, y] points")
        points: list[Point] = []
        for index, point in enumerate(raw):
            if not isinstance(point, Sequence) or len(point) != 2:
                raise TypeError(f"shape.points[{index}] must contain two numbers")
            points.append((_number(point[0], "quad.x"), _number(point[1], "quad.y")))
        if len(points) != 4:
            raise ValueError("quad shape must contain four points")
        return cls(tuple(points))  # type: ignore[arg-type]

    def to_dict(self) -> JsonObject:
        return {"type": "quad", "points": [[x, y] for x, y in self.points]}


type Shape = RectShape | QuadShape | JsonObject


def shape_to_dict(value: Shape) -> JsonObject:
    """Normalize a shape object or mapping into canonical JSON."""

    if isinstance(value, RectShape):
        return value.to_dict()
    if isinstance(value, QuadShape):
        return value.to_dict()
    if not isinstance(value, Mapping):
        raise TypeError("shape must be a rect/quad mapping or Shape object")
    shape_type = value.get("type", value.get("kind"))
    if shape_type is None and all(key in value for key in ("x", "y")):
        shape_type = "rect"
    if shape_type == "rect":
        return RectShape.from_dict(value).to_dict()
    if shape_type == "quad":
        return QuadShape.from_dict(value).to_dict()
    raise ValueError("shape.type must be 'rect' or 'quad'")


@dataclass(slots=True)
class Lora:
    """A LoRA reference attached to a character."""

    path: str
    strength: float = 1.0

    @classmethod
    def from_dict(cls, value: Mapping[str, Any] | str) -> Lora:
        if isinstance(value, str):
            return cls(path=value)
        if not isinstance(value, Mapping):
            raise TypeError("lora must be an object or path string")
        path = value.get("path", value.get("model", value.get("file", "")))
        return cls(_text(path, "lora.path"), _number(value.get("strength", 1.0), "lora.strength"))

    def to_dict(self) -> JsonObject:
        return {"path": self.path, "strength": self.strength}


@dataclass(slots=True)
class Dialogue:
    """One line of panel dialogue or narration."""

    speaker_id: str = ""
    text: str = ""
    bubble: str = "speech"
    position: str | None = None
    extra: JsonObject = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, value: Mapping[str, Any] | str) -> Dialogue:
        if isinstance(value, str):
            return cls(text=value)
        if not isinstance(value, Mapping):
            raise TypeError("dialogue entries must be objects or strings")
        known = {"speaker_id", "speaker", "text", "content", "bubble", "type", "position"}
        speaker = value.get("speaker_id", value.get("speaker", ""))
        text = value.get("text", value.get("content", ""))
        bubble = value.get("bubble", value.get("type", "speech"))
        return cls(
            speaker_id=_text(speaker, "dialogue.speaker_id"),
            text=_text(text, "dialogue.text"),
            bubble=_text(bubble, "dialogue.bubble", default="speech"),
            position=None if value.get("position") is None else _text(value["position"], "dialogue.position"),
            extra=_copy_extra(value, known),
        )

    def to_dict(self) -> JsonObject:
        result: JsonObject = {
            "speaker_id": self.speaker_id,
            "text": self.text,
            "bubble": self.bubble,
        }
        if self.position:
            result["position"] = self.position
        result.update(self.extra)
        return result


@dataclass(slots=True)
class Character:
    """Character metadata stored in ``characters/<id>.json``."""

    id: str
    display_name: str
    trigger_words: list[str] = field(default_factory=list)
    lora: Lora | None = None
    appearance_zh: str = ""
    appearance_en: str = ""
    clothing: list[str] = field(default_factory=list)
    reference_images: list[str] = field(default_factory=list)
    approved_images: list[str] = field(default_factory=list)
    extra: JsonObject = field(default_factory=dict, repr=False)
    format: str = CHARACTER_FORMAT

    @property
    def name(self) -> str:
        """Alias used by a few early drafts of the format."""

        return self.display_name

    @property
    def lora_path(self) -> str | None:
        return None if self.lora is None else self.lora.path

    @property
    def lora_strength(self) -> float | None:
        return None if self.lora is None else self.lora.strength

    @property
    def has_lora(self) -> bool:
        return self.lora is not None

    @property
    def appearance(self) -> dict[str, str]:
        result: dict[str, str] = {}
        if self.appearance_zh:
            result["zh"] = self.appearance_zh
        if self.appearance_en:
            result["en"] = self.appearance_en
        return result

    def appearance_text(self) -> str:
        return self.appearance_zh or self.appearance_en

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> Character:
        if not isinstance(value, Mapping):
            raise TypeError("character must be a JSON object")
        known = {
            "format",
            "id",
            "display_name",
            "name",
            "trigger_words",
            "triggers",
            "lora",
            "lora_path",
            "lora_strength",
            "appearance",
            "appearance_zh",
            "appearance_en",
            "clothing",
            "reference_images",
            "references",
            "approved_images",
            "approved_reference_images",
        }
        appearance = value.get("appearance", {})
        appearance_zh = value.get("appearance_zh", "")
        appearance_en = value.get("appearance_en", "")
        if isinstance(appearance, Mapping):
            appearance_zh = appearance_zh or appearance.get("zh", appearance.get("cn", ""))
            appearance_en = appearance_en or appearance.get("en", "")
        elif appearance:
            appearance_zh = appearance_zh or appearance
        lora_value = value.get("lora")
        if lora_value is None and value.get("lora_path"):
            lora_value = {"path": value.get("lora_path"), "strength": value.get("lora_strength", 1.0)}
        return cls(
            id=_text(value.get("id", ""), "character.id"),
            display_name=_text(value.get("display_name", value.get("name", "")), "character.display_name"),
            trigger_words=_strings(
                value.get("trigger_words", value.get("triggers", [])), "character.trigger_words"
            ),
            lora=None if lora_value in (None, "") else Lora.from_dict(lora_value),
            appearance_zh=_text(appearance_zh, "character.appearance_zh"),
            appearance_en=_text(appearance_en, "character.appearance_en"),
            clothing=_strings(value.get("clothing", []), "character.clothing"),
            reference_images=_strings(
                value.get("reference_images", value.get("references", [])), "character.reference_images"
            ),
            approved_images=_strings(
                value.get("approved_images", value.get("approved_reference_images", [])),
                "character.approved_images",
            ),
            extra=_copy_extra(value, known),
            format=_text(value.get("format", CHARACTER_FORMAT), "character.format"),
        )

    def to_dict(self) -> JsonObject:
        result: JsonObject = {
            "format": self.format,
            "id": self.id,
            "display_name": self.display_name,
            "trigger_words": list(self.trigger_words),
            "clothing": list(self.clothing),
            "reference_images": list(self.reference_images),
            "approved_images": list(self.approved_images),
        }
        if self.lora is not None:
            result["lora"] = self.lora.to_dict()
        if self.appearance:
            result["appearance"] = self.appearance
        result.update(self.extra)
        return result


@dataclass(slots=True)
class Panel:
    """One panel in a storyboard page."""

    id: str
    order: int
    shape: Shape
    shot: str = "medium"
    angle: str = "eye"
    character_ids: list[str] = field(default_factory=list)
    description: str = ""
    dialogue: list[Dialogue] = field(default_factory=list)
    sfx: list[str] = field(default_factory=list)
    importance: int = 1
    status: str = "draft"
    extra: JsonObject = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        self.shape = shape_to_dict(self.shape)
        self.character_ids = list(self.character_ids)
        self.dialogue = [
            item if isinstance(item, Dialogue) else Dialogue.from_dict(item) for item in self.dialogue
        ]
        self.sfx = list(self.sfx)

    @property
    def shape_type(self) -> str:
        return str(self.shape.get("type", "rect"))

    @property
    def dialogues(self) -> list[Dialogue]:
        """Plural alias for integrations that call the field ``dialogues``."""

        return self.dialogue

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        """Return ``(x, y, width, height)`` in page coordinates."""

        from .geometry import bbox_xywh  # noqa: PLC0415

        return bbox_xywh(self.shape)

    @property
    def bounding_box(self) -> tuple[float, float, float, float]:
        return self.bbox

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> Panel:
        if not isinstance(value, Mapping):
            raise TypeError("panel must be a JSON object")
        known = {
            "id",
            "order",
            "shape",
            "shot",
            "shot_size",
            "angle",
            "character_ids",
            "characters",
            "description",
            "dialogue",
            "sfx",
            "importance",
            "status",
        }
        shape = value.get("shape")
        if shape is None:
            shape = {key: value[key] for key in ("type", "x", "y", "w", "h") if key in value}
        return cls(
            id=_text(value.get("id", ""), "panel.id"),
            order=int(value.get("order", 1)),
            shape=shape_to_dict(shape),
            shot=_text(value.get("shot", value.get("shot_size", "medium")), "panel.shot"),
            angle=_text(value.get("angle", "eye"), "panel.angle"),
            character_ids=_strings(
                value.get("character_ids", value.get("characters", [])), "panel.character_ids"
            ),
            description=_text(value.get("description", ""), "panel.description"),
            dialogue=[Dialogue.from_dict(item) for item in value.get("dialogue", [])],
            sfx=_strings(value.get("sfx", []), "panel.sfx"),
            importance=int(value.get("importance", 1)),
            status=_text(value.get("status", "draft"), "panel.status"),
            extra=_copy_extra(value, known),
        )

    def to_dict(self) -> JsonObject:
        result: JsonObject = {
            "id": self.id,
            "order": self.order,
            "shape": shape_to_dict(self.shape),
            "shot": self.shot,
            "angle": self.angle,
            "character_ids": list(self.character_ids),
            "description": self.description,
            "dialogue": [item.to_dict() for item in self.dialogue],
            "sfx": list(self.sfx),
            "importance": self.importance,
            "status": self.status,
        }
        result.update(self.extra)
        return result


@dataclass(slots=True)
class Overlay:
    """A separately generated transparent character layer above panel borders."""

    id: str
    character_id: str
    rect: RectShape
    panel_id: str | None = None
    z_index: int = 1
    description: str = ""
    status: str = "planned"
    image_path: str | None = None
    extra: JsonObject = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        if isinstance(self.rect, Mapping):
            self.rect = RectShape.from_dict(self.rect)

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> Overlay:
        known = {"id", "character_id", "rect", "panel_id", "z_index", "description", "status", "image_path"}
        return cls(
            id=_text(value.get("id", ""), "overlay.id"),
            character_id=_text(value.get("character_id", ""), "overlay.character_id"),
            rect=RectShape.from_dict(value.get("rect", {})),
            panel_id=None if value.get("panel_id") is None else _text(value["panel_id"], "overlay.panel_id"),
            z_index=int(value.get("z_index", 1)),
            description=_text(value.get("description", ""), "overlay.description"),
            status=_text(value.get("status", "planned"), "overlay.status"),
            image_path=None
            if value.get("image_path") is None
            else _text(value["image_path"], "overlay.image_path"),
            extra=_copy_extra(value, known),
        )

    def to_dict(self) -> JsonObject:
        return {
            **self.extra,
            "id": self.id,
            "character_id": self.character_id,
            "rect": self.rect.to_dict(),
            "panel_id": self.panel_id,
            "z_index": self.z_index,
            "description": self.description,
            "status": self.status,
            "image_path": self.image_path,
        }


@dataclass(slots=True)
class Page:
    """A complete storyboard page."""

    page_id: str = ""
    canvas_width: int = 1024
    canvas_height: int = 1536
    reading_direction: str = "rtl"
    style_prefix: str = ""
    description: str = ""
    panel_gap: int = 24
    panels: list[Panel] = field(default_factory=list)
    dialogue_mode: str = "moss_text"
    text_direction: str = "vertical"
    color_mode: str = "monochrome"
    extra: JsonObject = field(default_factory=dict, repr=False)
    format: str = PAGE_FORMAT
    overlays: list[Overlay] = field(default_factory=list)

    @property
    def id(self) -> str:
        return self.page_id

    @property
    def width(self) -> int:
        return self.canvas_width

    @property
    def height(self) -> int:
        return self.canvas_height

    @property
    def canvas_size(self) -> tuple[int, int]:
        return self.canvas_width, self.canvas_height

    @property
    def panel_spacing(self) -> int:
        return self.panel_gap

    def __post_init__(self) -> None:
        self.panels = [item if isinstance(item, Panel) else Panel.from_dict(item) for item in self.panels]
        self.overlays = [
            item if isinstance(item, Overlay) else Overlay.from_dict(item) for item in self.overlays
        ]

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> Page:
        if not isinstance(value, Mapping):
            raise TypeError("page must be a JSON object")
        known = {
            "format",
            "id",
            "page_id",
            "canvas",
            "canvas_size",
            "canvas_width",
            "canvas_height",
            "width",
            "height",
            "reading_direction",
            "direction",
            "style_prefix",
            "style",
            "description",
            "caption",
            "panel_gap",
            "gutter",
            "panels",
            "dialogue_mode",
            "lettering_mode",
            "text_direction",
            "color_mode",
            "overlays",
        }
        canvas = value.get("canvas", value.get("canvas_size", {}))
        if not isinstance(canvas, Mapping):
            canvas = {}
        width = value.get("canvas_width", value.get("width", canvas.get("width", 1024)))
        height = value.get("canvas_height", value.get("height", canvas.get("height", 1536)))
        return cls(
            page_id=_text(value.get("page_id", value.get("id", "")), "page.page_id"),
            canvas_width=int(width),
            canvas_height=int(height),
            reading_direction=_text(
                value.get("reading_direction", value.get("direction", "rtl")), "page.reading_direction"
            ),
            style_prefix=_text(value.get("style_prefix", value.get("style", "")), "page.style_prefix"),
            description=_text(value.get("description", value.get("caption", "")), "page.description"),
            panel_gap=int(value.get("panel_gap", value.get("gutter", 24))),
            panels=[Panel.from_dict(item) for item in value.get("panels", [])],
            dialogue_mode=_text(
                value.get("dialogue_mode", value.get("lettering_mode", "moss_text")), "page.dialogue_mode"
            ),
            text_direction=_text(value.get("text_direction", "vertical"), "page.text_direction"),
            color_mode=_text(value.get("color_mode", "monochrome"), "page.color_mode"),
            overlays=[Overlay.from_dict(item) for item in value.get("overlays", [])],
            extra=_copy_extra(value, known),
            format=_text(value.get("format", PAGE_FORMAT), "page.format"),
        )

    def to_dict(self) -> JsonObject:
        result: JsonObject = {
            "format": self.format,
            "id": self.page_id,
            "canvas_width": self.canvas_width,
            "canvas_height": self.canvas_height,
            "reading_direction": self.reading_direction,
            "style_prefix": self.style_prefix,
            "description": self.description,
            "panel_gap": self.panel_gap,
            "dialogue_mode": self.dialogue_mode,
            "text_direction": self.text_direction,
            "color_mode": self.color_mode,
            "panels": [item.to_dict() for item in self.panels],
        }
        result.update(self.extra)
        if self.overlays:
            result["overlays"] = [overlay.to_dict() for overlay in self.overlays]
        return result


@dataclass(slots=True)
class Project:
    """Project defaults stored in ``project.json``."""

    name: str = ""
    default_style_prefix: str = ""
    default_canvas_width: int = 1024
    default_canvas_height: int = 1536
    reading_direction: str = "rtl"
    default_dialogue_mode: str = "moss_text"
    text_direction: str = "vertical"
    color_mode: str = "monochrome"
    extra: JsonObject = field(default_factory=dict, repr=False)
    format: str = PROJECT_FORMAT

    @property
    def title(self) -> str:
        return self.name

    @property
    def style_prefix(self) -> str:
        return self.default_style_prefix

    @property
    def dialogue_mode(self) -> str:
        return self.default_dialogue_mode

    @property
    def canvas_size(self) -> tuple[int, int]:
        return self.default_canvas_width, self.default_canvas_height

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> Project:
        if not isinstance(value, Mapping):
            raise TypeError("project must be a JSON object")
        known = {
            "format",
            "name",
            "title",
            "default_style_prefix",
            "style_prefix",
            "default_canvas",
            "canvas",
            "default_canvas_width",
            "default_canvas_height",
            "canvas_width",
            "canvas_height",
            "reading_direction",
            "direction",
            "default_dialogue_mode",
            "dialogue_mode",
            "text_direction",
            "color_mode",
        }
        canvas = value.get("default_canvas", value.get("canvas", {}))
        if not isinstance(canvas, Mapping):
            canvas = {}
        width = value.get(
            "default_canvas_width",
            value.get("canvas_width", canvas.get("width", 1024)),
        )
        height = value.get(
            "default_canvas_height",
            value.get("canvas_height", canvas.get("height", 1536)),
        )
        return cls(
            name=_text(value.get("name", value.get("title", "")), "project.name"),
            default_style_prefix=_text(
                value.get("default_style_prefix", value.get("style_prefix", "")),
                "project.default_style_prefix",
            ),
            default_canvas_width=int(width),
            default_canvas_height=int(height),
            reading_direction=_text(
                value.get("reading_direction", value.get("direction", "rtl")),
                "project.reading_direction",
            ),
            default_dialogue_mode=_text(
                value.get("default_dialogue_mode", value.get("dialogue_mode", "moss_text")),
                "project.default_dialogue_mode",
            ),
            text_direction=_text(value.get("text_direction", "vertical"), "project.text_direction"),
            color_mode=_text(value.get("color_mode", "monochrome"), "project.color_mode"),
            extra=_copy_extra(value, known),
            format=_text(value.get("format", PROJECT_FORMAT), "project.format"),
        )

    def to_dict(self) -> JsonObject:
        result: JsonObject = {
            "format": self.format,
            "name": self.name,
            "default_style_prefix": self.default_style_prefix,
            "default_canvas_width": self.default_canvas_width,
            "default_canvas_height": self.default_canvas_height,
            "reading_direction": self.reading_direction,
            "default_dialogue_mode": self.default_dialogue_mode,
            "text_direction": self.text_direction,
            "color_mode": self.color_mode,
        }
        result.update(self.extra)
        return result


__all__ = [
    "BUBBLE_TYPES",
    "CAMERA_ANGLES",
    "CHARACTER_FORMAT",
    "DIALOGUE_MODES",
    "PAGE_FORMAT",
    "PANEL_STATUSES",
    "PROJECT_FORMAT",
    "READING_DIRECTIONS",
    "SHOT_SIZES",
    "Character",
    "CharacterLoRA",
    "Dialogue",
    "Lora",
    "LoraConfig",
    "Overlay",
    "Page",
    "Panel",
    "Point",
    "Project",
    "QuadShape",
    "RectShape",
    "Shape",
    "shape_to_dict",
]

# Names used by a few clients before the v1 terminology was settled.
LoraConfig = Lora
CharacterLoRA = Lora
