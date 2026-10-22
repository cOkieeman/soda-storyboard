"""Core library for the soda-storyboard v1 format."""

from .canvas_sizes import CANVAS_PRESETS, infer_dimensions
from .compiler import compile_geometry_map, compile_page
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
    "compile_geometry_map",
    "compile_page",
    "infer_dimensions",
    "validate_page",
]
