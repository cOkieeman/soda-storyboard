"""Finite, portable JSON numbers at file and HTTP boundaries."""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping
from math import isfinite
from typing import Any

# JSON metadata is intentionally heterogeneous, including forward-compatible fields.
# ruff: noqa: ANN401, RUF001


class InvalidJSONNumberError(ValueError):
    """A number cannot be safely read back by JSON consumers."""


def check_json_numbers(value: Any, path: str = "$") -> None:
    """Check unknown fields as well as modeled fields, preserving 64-bit seeds."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if (isinstance(value, float) and not isfinite(value)) or abs(value) > sys.float_info.max:
            message = f"{path} 的数值必须有限且不能超出双精度数值范围"
            raise InvalidJSONNumberError(message)
    elif isinstance(value, Mapping):
        for key, item in value.items():
            check_json_numbers(item, f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            check_json_numbers(item, f"{path}[{index}]")


def _integer(token: str) -> int:
    # Reject huge integer tokens before Python's configurable int-string limit.
    if len(token.lstrip("-")) > sys.float_info.max_10_exp + 1:
        message = "JSON 数值过大，不能超出双精度数值范围"
        raise InvalidJSONNumberError(message)
    return int(token)


def loads_json(content: str | bytes) -> Any:
    """Parse even nonstandard constants so one recursive check reports all overflow."""
    value = json.loads(content, parse_int=_integer)
    check_json_numbers(value)
    return value
