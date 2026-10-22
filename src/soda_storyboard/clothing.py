"""Bilingual, deliberately conservative clothing checks shared by captions and validation."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from .models import Character


@lru_cache(maxsize=1)
def _vocabulary() -> dict[str, dict[str, list[str]]]:
    return cast(
        "dict[str, dict[str, list[str]]]",
        json.loads((Path(__file__).parent / "data/clothing-vocabulary.json").read_text(encoding="utf-8")),
    )


def _contains(text: str, term: str) -> bool:
    pattern = r"(?<![a-z])" + re.escape(term) + r"(?![a-z])" if term.isascii() else re.escape(term)
    return re.search(pattern, text, re.IGNORECASE) is not None


def _matches(text: str, group: str) -> set[str]:
    return {
        name for name, terms in _vocabulary()[group].items() if any(_contains(text, term) for term in terms)
    }


def clothing_phrases(character: Character, language: str) -> list[str]:
    """Keep clothing clauses, excluding unrelated hair, skin and ornament colors."""
    appearance = character.appearance_en if language == "en" else character.appearance_zh
    # Chinese and English punctuation both delimit appearance clauses.
    phrases = [phrase.strip() for phrase in re.split(r"[,，;；。]|\.(?:\s|$)", appearance)]  # noqa: RUF001
    selected = [phrase for phrase in phrases if phrase and _matches(phrase, "categories")]
    return list(dict.fromkeys([*selected, *(text.strip() for text in character.clothing if text.strip())]))


def clothing_profile(character: Character) -> tuple[list[str], set[str], set[str]]:
    """Return phrases, clothing categories and clothing colors in either language."""
    phrases = list(dict.fromkeys([*clothing_phrases(character, "zh"), *clothing_phrases(character, "en")]))
    text = "; ".join(phrases)
    # A sentence can describe both hair and clothing without a comma. Retain
    # garment modifiers such as "dress with white trim", but drop feature color
    # clauses such as "blue hair wearing a dress" and "dress with blue eyes".
    segments = re.split(
        r"\b(?:wearing|wears?|dressed in|and|with|in|under|over)\b|穿着?|身着|搭配|外搭|以及|和|与",
        text,
        flags=re.IGNORECASE,
    )
    clothing_colors = "; ".join(segment for segment in segments if not _matches(segment, "features"))
    return phrases, _matches(text, "categories"), _matches(clothing_colors, "colors")
