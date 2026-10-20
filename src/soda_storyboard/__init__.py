"""Core library for the soda-storyboard v1 format."""

from .compiler import compile_geometry_map, compile_page
from .models import Character, Dialogue, Lora, Overlay, Page, Panel, Project, QuadShape, RectShape
from .validation import ValidationIssue, ValidationReport, validate_page

__all__ = [
    "Character",
    "Dialogue",
    "Lora",
    "Overlay",
    "Page",
    "Panel",
    "Project",
    "QuadShape",
    "RectShape",
    "ValidationIssue",
    "ValidationReport",
    "compile_geometry_map",
    "compile_page",
    "validate_page",
]
