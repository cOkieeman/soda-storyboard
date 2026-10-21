"""Local ComfyUI production pipeline; importing this package never submits jobs."""

from .errors import ProductionError

__all__ = ["ProductionError"]
