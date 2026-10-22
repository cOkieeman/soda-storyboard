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
POSES = (
    "stand",
    "walk",
    "run",
    "sit",
    "crouch",
    "wave",
    "point",
    "arms_up",
    "hands_clasped",
    "hand_on_chin",
    "lie",
    "back_view",
    "handshake",
    "hug",
)

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


def _boolean(value: Any, name: str) -> bool:
    if not isinstance(value, bool):
        raise TypeError(f"{name} must be a boolean")
    return value


def _caption_language(value: Any) -> str:
    if value not in ("en", "zh"):
        raise ValueError("caption_language must be en or zh")
    return value


def _glossary(value: Any) -> dict[str, str]:
    if not isinstance(value, Mapping):
        raise TypeError("glossary must be an object mapping Chinese to English")
    return {_text(key, "glossary key"): _text(item, "glossary value") for key, item in value.items()}


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
    age: str | None = None
    figure_hint: str | None = None
    role_en: str | None = None

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
            "age",
            "figure_hint",
            "role_en",
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
            age=None if value.get("age") is None else _text(value["age"], "character.age"),
            role_en=None if value.get("role_en") is None else _text(value["role_en"], "character.role_en"),
            figure_hint=None
            if value.get("figure_hint") is None
            else _text(value["figure_hint"], "character.figure_hint"),
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
        if self.age is not None:
            result["age"] = self.age
        if self.figure_hint is not None:
            result["figure_hint"] = self.figure_hint
        if self.role_en is not None:
            result["role_en"] = self.role_en
        result.update(self.extra)
        return result


@dataclass(slots=True)
class Text:
    """Independent lettering in top-left pixel coordinates; bbox is x/y/w/h."""

    id: str
    text: str
    kind: str = "dialogue"
    panel_id: str | None = None
    speaker_id: str | None = None
    direction: str | None = None
    bubble: str = "speech"
    bbox: RectShape | None = None
    style_hint: str | None = None
    extra: JsonObject = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        if isinstance(self.bbox, Mapping):
            self.bbox = RectShape.from_dict(self.bbox)

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> Text:
        known = {"id", "text", "kind", "panel_id", "speaker_id", "direction", "bubble", "bbox", "style_hint"}
        optional = {
            key: None if value.get(key) is None else _text(value[key], f"text.{key}")
            for key in ("panel_id", "speaker_id", "direction", "style_hint")
        }
        return cls(
            id=_text(value.get("id", ""), "text.id"),
            text=_text(value.get("text", ""), "text.text"),
            kind=_text(value.get("kind", "dialogue"), "text.kind"),
            bubble=_text(value.get("bubble", "speech"), "text.bubble"),
            bbox=None if value.get("bbox") is None else RectShape.from_dict(value["bbox"]),
            extra=_copy_extra(value, known),
            **optional,
        )

    def to_dict(self) -> JsonObject:
        return {
            **self.extra,
            "id": self.id,
            "text": self.text,
            "kind": self.kind,
            "panel_id": self.panel_id,
            "speaker_id": self.speaker_id,
            "direction": self.direction,
            "bubble": self.bubble,
            "bbox": None if self.bbox is None else self.bbox.to_dict(),
            "style_hint": self.style_hint,
        }


@dataclass(slots=True)
class Figure:
    character_id: str
    pose: str = "stand"
    position: float | str = "center"
    facing: str = "front"
    framing: str | None = None
    extra: JsonObject = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> Figure:
        position = value.get("position", "center")
        return cls(
            character_id=_text(value.get("character_id", ""), "figure.character_id"),
            pose=_text(value.get("pose", "stand"), "figure.pose"),
            position=position if isinstance(position, str) else _number(position, "figure.position"),
            facing=_text(value.get("facing", "front"), "figure.facing"),
            framing=None if value.get("framing") is None else _text(value["framing"], "figure.framing"),
            extra=_copy_extra(value, {"character_id", "pose", "position", "facing", "framing"}),
        )

    def to_dict(self) -> JsonObject:
        return {
            **self.extra,
            "character_id": self.character_id,
            "pose": self.pose,
            "position": self.position,
            "facing": self.facing,
            "framing": self.framing,
        }


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

    caption_en: str | None = None
    figures: list[Figure] = field(default_factory=list)
    use_custom_caption: bool = False
    caption_auto_en: JsonObject | None = None

    def __post_init__(self) -> None:
        self.shape = shape_to_dict(self.shape)
        self.character_ids = list(self.character_ids)
        self.dialogue = [
            item if isinstance(item, Dialogue) else Dialogue.from_dict(item) for item in self.dialogue
        ]
        self.sfx = list(self.sfx)
        self.figures = [item if isinstance(item, Figure) else Figure.from_dict(item) for item in self.figures]

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
            "caption_en",
            "use_custom_caption",
            "caption_auto_en",
            "figures",
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
            caption_en=None
            if value.get("caption_en") is None
            else _text(value["caption_en"], "panel.caption_en"),
            figures=[Figure.from_dict(item) for item in value.get("figures", [])],
            use_custom_caption=_boolean(value.get("use_custom_caption", False), "panel.use_custom_caption"),
            caption_auto_en=dict(value["caption_auto_en"])
            if isinstance(value.get("caption_auto_en"), Mapping)
            else None,
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
        if self.caption_en is not None:
            result["caption_en"] = self.caption_en
        if self.use_custom_caption:
            result["use_custom_caption"] = True
        if self.caption_auto_en is not None:
            result["caption_auto_en"] = dict(self.caption_auto_en)
        if self.figures:
            result["figures"] = [item.to_dict() for item in self.figures]
        return result


@dataclass(slots=True)
class Overlay:
    """A MOSS character or planned transparent layer crossing panel borders."""

    id: str
    character_id: str
    rect: RectShape
    panel_id: str | None = None
    z_index: int = 1
    description: str = ""
    status: str = "planned"
    image_path: str | None = None
    extra: JsonObject = field(default_factory=dict, repr=False)
    mode: str = "moss"

    def __post_init__(self) -> None:
        if isinstance(self.rect, Mapping):
            self.rect = RectShape.from_dict(self.rect)

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> Overlay:
        known = {
            "id",
            "character_id",
            "rect",
            "panel_id",
            "z_index",
            "description",
            "status",
            "image_path",
            "mode",
        }
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
            mode=_text(value.get("mode", "layer"), "overlay.mode"),
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
            "mode": self.mode,
        }


@dataclass(slots=True)
class ObjectBox:
    """An independently editable object or imported character without a rig."""

    id: str
    rect: RectShape
    caption: str = ""
    panel_id: str | None = None
    label: str = "object"
    extra: JsonObject = field(default_factory=dict, repr=False)

    def __post_init__(self) -> None:
        if not isinstance(self.rect, RectShape):
            self.rect = RectShape.from_dict(self.rect)

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> ObjectBox:
        return cls(
            id=_text(value.get("id", ""), "object.id"),
            rect=RectShape.from_dict(value.get("rect", value.get("bbox", {}))),
            caption=_text(value.get("caption", value.get("description", "")), "object.caption"),
            panel_id=value.get("panel_id"),
            label=_text(value.get("label", "object"), "object.label"),
            extra=_copy_extra(value, {"id", "rect", "bbox", "caption", "description", "panel_id", "label"}),
        )

    def to_dict(self) -> JsonObject:
        return {
            **self.extra,
            "id": self.id,
            "rect": self.rect.to_dict(),
            "caption": self.caption,
            "panel_id": self.panel_id,
            "label": self.label,
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
    texts: list[Text] = field(default_factory=list)
    style_prompt: str | None = None
    tags: list[str] = field(default_factory=list)
    text_font_size: float = 42
    text_max_chars: int = 10
    legacy_caption_en: bool = False
    caption_language: str | None = None
    objects: list[ObjectBox] = field(default_factory=list)

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
        self.texts = [item if isinstance(item, Text) else Text.from_dict(item) for item in self.texts]
        self.objects = [
            item if isinstance(item, ObjectBox) else ObjectBox.from_dict(item) for item in self.objects
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
            "texts",
            "style_prompt",
            "tags",
            "text_font_size",
            "text_max_chars",
            "legacy_caption_en",
            "caption_language",
            "objects",
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
            texts=[Text.from_dict(item) for item in value.get("texts", [])],
            style_prompt=None
            if value.get("style_prompt") is None
            else _text(value["style_prompt"], "page.style_prompt"),
            tags=_strings(value.get("tags", []), "page.tags"),
            text_font_size=_number(value.get("text_font_size", 42), "page.text_font_size"),
            text_max_chars=int(value.get("text_max_chars", 10)),
            legacy_caption_en=_boolean(value.get("legacy_caption_en", False), "page.legacy_caption_en"),
            caption_language=None
            if value.get("caption_language") is None
            else _caption_language(value["caption_language"]),
            objects=[ObjectBox.from_dict(item) for item in value.get("objects", [])],
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
            "texts": [item.to_dict() for item in self.texts],
            "style_prompt": self.style_prompt,
            "tags": list(self.tags),
            "text_font_size": self.text_font_size,
            "text_max_chars": self.text_max_chars,
        }
        result.update(self.extra)
        if self.legacy_caption_en:
            result["legacy_caption_en"] = True
        if self.caption_language is not None:
            result["caption_language"] = self.caption_language
        if self.objects:
            result["objects"] = [item.to_dict() for item in self.objects]
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
    style_prompt: str | None = None
    tags: list[str] = field(default_factory=list)
    caption_language: str = "en"
    glossary: dict[str, str] = field(default_factory=dict)

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
            "style_prompt",
            "tags",
            "caption_language",
            "glossary",
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
            style_prompt=None
            if value.get("style_prompt") is None
            else _text(value["style_prompt"], "project.style_prompt"),
            tags=_strings(value.get("tags", []), "project.tags"),
            caption_language=_caption_language(value.get("caption_language", "en")),
            glossary=_glossary(value.get("glossary", {})),
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
            "style_prompt": self.style_prompt,
            "tags": list(self.tags),
            "caption_language": self.caption_language,
            "glossary": dict(self.glossary),
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
    "POSES",
    "PROJECT_FORMAT",
    "READING_DIRECTIONS",
    "SHOT_SIZES",
    "Character",
    "CharacterLoRA",
    "Dialogue",
    "Figure",
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
    "Text",
    "shape_to_dict",
]

# Names used by a few clients before the v1 terminology was settled.
LoraConfig = Lora
CharacterLoRA = Lora
