"""User-facing production errors also handled by the existing CLI boundary."""

from __future__ import annotations

from functools import wraps
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable


class ProductionError(ValueError):
    """An actionable Chinese diagnostic, with upstream errors preserved."""


def production_operation[**P, R](operation: Callable[P, R]) -> Callable[P, R]:
    """Keep file/JSON failures actionable at the public API boundary."""

    @wraps(operation)
    def wrapped(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return operation(*args, **kwargs)
        except ProductionError:
            raise
        except (OSError, ValueError, TypeError) as exc:
            message = f"生产操作失败: 请检查项目文件和输入参数: {exc}"
            raise ProductionError(message) from exc

    return wrapped
