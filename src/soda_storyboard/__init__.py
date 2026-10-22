"""Core library for the soda-storyboard v1 format."""

from .bundle import compile_bundle, export_bundle, load_bundle
from .canvas_sizes import CANVAS_PRESETS, infer_dimensions
from .compiler import compile_geometry_map, compile_page
from .importers import import_moss, import_storyboard
from .models import (
    Character,
    Dialogue,
    Figure,
    Lora,
    Overlay,
    Page,
    Panel,
    Project,
    QuadShape,
    RectShape,
    Text,
)
from .validation import ValidationIssue, ValidationReport, validate_page

__all__ = [
    "CANVAS_PRESETS",
    "Character",
    "Dialogue",
    "Figure",
    "Lora",
    "Overlay",
    "Page",
    "Panel",
    "Project",
    "QuadShape",
    "RectShape",
    "Text",
    "ValidationIssue",
    "ValidationReport",
    "compile_bundle",
    "compile_geometry_map",
    "compile_page",
    "export_bundle",
    "import_moss",
    "import_storyboard",
    "infer_dimensions",
    "load_bundle",
    "validate_page",
]
