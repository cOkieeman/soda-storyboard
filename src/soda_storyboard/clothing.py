"""Bilingual, deliberately conservative clothing checks shared by captions and validation."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping

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


def contains_chinese(text: str) -> bool:
    return re.search(r"[\u3400-\u9fff\U00020000-\U0002fa1f]", text) is not None


def caption_clothing(character: Character, language: str) -> list[str]:
    """The legacy clothing list is unlocalized; never inject Chinese into English."""
    return [text for text in character.clothing if language != "en" or not contains_chinese(text)]


def clothing_phrases(character: Character, language: str) -> list[str]:
    """Keep clothing clauses, excluding unrelated hair, skin and ornament colors."""
    appearance = character.appearance_en if language == "en" else character.appearance_zh
    # Chinese and English punctuation both delimit appearance clauses.
    phrases = [phrase.strip() for phrase in re.split(r"[,，;；。]|\.(?:\s|$)", appearance)]
    selected = [phrase for phrase in phrases if phrase and _matches(phrase, "categories")]
    return list(
        dict.fromkeys(
            [*selected, *(text.strip() for text in caption_clothing(character, language) if text.strip())]
        )
    )


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


def clothing_warnings(characters: Mapping[str, Character], appearing: Iterable[str]) -> list[dict]:
    """Use the same clothing checks for page validation and unsaved character forms."""
    # Chinese wording is shared with the existing validator.
    # ruff: noqa: RUF001
    profiles = {
        identifier: clothing_profile(characters[identifier])
        for identifier in sorted(set(appearing))
        if identifier in characters
    }
    result = []
    for identifier, (phrases, _, colors) in profiles.items():
        name = characters[identifier].display_name or identifier
        if not phrases:
            result.append(
                {
                    "severity": "warning",
                    "code": "character_clothing_missing",
                    "message": f"角色 {name} 缺少服装描述（clothing 为空且外观中没有服装词），"
                    "请补充服装款式和颜色",
                    "field": "appearance",
                    "details": {"character_id": identifier},
                }
            )
        elif not colors:
            result.append(
                {
                    "severity": "warning",
                    "code": "character_clothing_color_missing",
                    "message": f"角色 {name} 的服装描述缺少颜色词，请写明服装款式和颜色"
                    f"（当前：{'；'.join(phrases)}）",
                    "field": "clothing",
                    "details": {"character_id": identifier},
                }
            )
    identifiers = list(profiles)
    for index, first in enumerate(identifiers):
        for second in identifiers[index + 1 :]:
            _, first_categories, first_colors = profiles[first]
            _, second_categories, second_colors = profiles[second]
            if (
                first_categories & second_categories
                or not first_colors
                or not second_colors
                or first_colors & second_colors
            ):
                first_name = characters[first].display_name or first
                second_name = characters[second].display_name or second
                result.append(
                    {
                        "severity": "warning",
                        "code": "character_clothing_similar",
                        "message": f"同页角色 {first_name} 和 {second_name} 的服装类别或颜色容易混淆，"
                        "请写明不同的服装和颜色",
                        "field": "clothing",
                        "details": {"character_ids": [first, second]},
                    }
                )
    return result
