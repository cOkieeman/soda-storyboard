"""Canonical captions, conservative pose checks and offline translation freshness."""

from __future__ import annotations

import hashlib
import re
from typing import TYPE_CHECKING

from .figure_semantics import figure_description
from .figures import panel_figures
from .moss_roundtrip import entity_hash
from .panel_positions import panel_positions

if TYPE_CHECKING:
    from collections.abc import Mapping

    from .models import Character, Figure, Page, Panel

# ruff: noqa: RUF001 -- bilingual prompt punctuation and user-facing diagnostics.

SHOTS = {
    "extreme_long": ("大远景", "extreme long shot"),
    "long": ("远景", "long shot"),
    "full": ("全景", "full shot"),
    "medium": ("中景", "medium shot"),
    "close_up": ("特写", "close-up"),
    "extreme_close_up": ("大特写", "extreme close-up"),
}
ANGLES = {
    "eye": ("平视", "eye-level"),
    "high": ("俯视", "high-angle view"),
    "low": ("仰视", "low-angle view"),
    "bird": ("鸟瞰", "bird's-eye view"),
    "worm": ("贴地仰视", "worm's-eye view"),
    "dutch": ("倾斜视角", "Dutch angle"),
}
POSE_WORDS = {
    "sit": ("坐着", r"坐着|坐在|坐下|\b(?:sit(?:ting|s)?|seated)\b"),
    "stand": ("站着", r"站着|站在|站立|站起|\bstand(?:ing|s)?\b"),
    "lie": ("躺着", r"躺着|躺在|侧躺|躺下|\b(?:lying|lies?|reclining)\b"),
    "prone": ("趴着", r"趴着|趴在|\bprone\b"),
    "run": ("跑着", r"奔跑|跑着|跑向|跑开|\brun(?:ning|s)?\b"),
    "kneel": ("跪着", r"跪着|跪在|跪地|\bkneel(?:ing|s)?\b"),
    "crouch": ("蹲着", r"蹲着|蹲在|蹲下|\b(?:crouch(?:ing|es)?|squatting)\b"),
    "walk": ("走着", r"走着|走向|行走|\bwalk(?:ing|s)?\b"),
}


def clean_caption(parts: list[str], language: str = "zh") -> str:
    """Join semantic phrases without panel-number labels or doubled punctuation."""
    pieces = []
    for raw in parts:
        value = re.sub(r"^\s*(?:第\s*\d+\s*格|Panel\s+\d+)\s*[,，:：.。]?\s*", "", raw, flags=re.IGNORECASE)
        value = value.strip(" \t\n，,；;。.!！?？")
        if value:
            pieces.append(value)
    value = ("，" if language == "zh" else ", ").join(pieces)
    if language == "zh":
        value = re.sub(r"[，,；;。！!？?]+\s*", "，", value)
        value = re.sub(r"\.\s+(?=\S)|\.$", "，", value)
        return value.strip(" ，") + "。" if value.strip(" ，") else ""
    value = re.sub(r"[，；。]", ", ", value)
    value = re.sub(r"(?:[,;.!]\s*)+,\s*|(?:,\s*){2,}", ", ", value)
    return value.rstrip(" ,;.!") + "." if value.strip() else ""


def _unique(parts: list[str]) -> list[str]:
    result: list[str] = []
    for part in parts:
        key = part.strip(" ，,；;。.").casefold()
        if key and not any(key in previous.casefold() for previous in result):
            result.append(part)
    return result


def _contains_identity(parts: list[str], phrase: str) -> bool:
    # ASCII trigger tokens need word boundaries: token_v2 is not token_v20.
    pattern = rf"(?<![A-Za-z0-9_]){re.escape(phrase)}(?![A-Za-z0-9_])"
    return bool(phrase) and any(re.search(pattern, part, re.IGNORECASE) for part in parts)


def character_caption(identifier: str, characters: Mapping[str, Character], language: str = "zh") -> str:
    character = characters.get(identifier)
    if character is None:
        return identifier
    detail = (
        (character.appearance_zh or character.display_name)
        if language == "zh"
        else (character.appearance_en or character.appearance_zh or character.display_name)
    )
    clothing = [] if language == "en" and character.appearance_en else character.clothing
    parts = _unique([detail, *clothing])
    for trigger in character.trigger_words:
        if trigger and not _contains_identity(parts, trigger):
            parts.append(trigger)
    # Appearance often already starts with the character's name.
    if not _contains_identity(parts, character.display_name):
        parts.insert(0, character.display_name)
    if character.age and character.age not in detail:
        parts.insert(1, character.age)
    return clean_caption(parts, language).rstrip("。.")


def figure_caption(
    figure: Figure, characters: Mapping[str, Character], language: str, shot: str | None = None
) -> str:
    return clean_caption(
        [
            character_caption(figure.character_id, characters, language),
            figure_description(figure, language, head_only=shot in {"close_up", "extreme_close_up"}),
        ],
        language,
    )


def custom_caption_enabled(panel: Panel, page: Page) -> bool:
    return bool(
        panel.caption_en and panel.caption_en.strip() and (panel.use_custom_caption or page.legacy_caption_en)
    )


def _scene_without_repeated_appearance(
    scene: str, identifiers: list[str], characters: Mapping[str, Character], language: str
) -> str:
    """Drop only exact standalone appearance clauses, never names inside actions."""
    appearance_clauses = set()
    for identifier in identifiers:
        character = characters.get(identifier)
        if character is None:
            continue
        detail = character.appearance_zh if language == "zh" else character.appearance_en
        for phrase in [detail, *character.clothing]:
            appearance_clauses.update(
                part.strip().casefold() for part in re.split(r"[，,；;。.!！?？]", phrase) if part.strip()
            )
    pieces = re.split(r"([，,；;。.!！?？])", scene)
    result = []
    for offset in range(0, len(pieces), 2):
        clause = pieces[offset]
        if clause.strip().casefold() not in appearance_clauses:
            result.append(clause)
            if offset + 1 < len(pieces):
                result.append(pieces[offset + 1])
    return "".join(result)


def structured_caption(
    panel: Panel, page: Page, characters: Mapping[str, Character], language: str = "zh"
) -> str:
    index = language == "en"
    figures = panel_figures(panel, page)
    figure_ids = {figure.character_id for figure in figures}
    details = [figure_caption(figure, characters, language, panel.shot) for figure in figures]
    details.extend(
        character_caption(identifier, characters, language)
        for identifier in dict.fromkeys(panel.character_ids)
        if identifier not in figure_ids
    )
    scene = panel.description if language == "zh" else panel.extra.get("description_en") or panel.description
    identifiers = list(dict.fromkeys([*panel.character_ids, *(figure.character_id for figure in figures)]))
    scene = _scene_without_repeated_appearance(scene, identifiers, characters, language)
    parts = [
        SHOTS.get(panel.shot, (panel.shot, panel.shot))[index],
        ANGLES.get(panel.angle, (panel.angle, panel.angle))[index],
        *details,
        scene,
    ]
    parts.extend(
        str(panel.extra[key]) for key in ("props", "atmosphere") if isinstance(panel.extra.get(key), str)
    )
    return clean_caption(parts, language)


def source_hash(panel: Panel, page: Page, characters: Mapping[str, Character]) -> str:
    return hashlib.sha256(structured_caption(panel, page, characters).encode("utf-8")).hexdigest()


def translation_state(panel: Panel, page: Page, characters: Mapping[str, Character]) -> str:
    if preserved_caption(panel, page) is not None:
        return "preserved"
    cached = panel.caption_auto_en
    if not cached or not isinstance(cached.get("text"), str) or not cached["text"].strip():
        return "missing"
    return "fresh" if cached.get("source_hash") == source_hash(panel, page, characters) else "stale"


def format_scene_caption(panel: Panel, page: Page, content: str, language: str) -> str:
    """Add geometry and a single camera sentence without changing the cached source."""
    index = language == "en"
    shot = SHOTS.get(panel.shot, (panel.shot, panel.shot))[index]
    angle = ANGLES.get(panel.angle, (panel.angle, panel.angle))[index]
    body = clean_caption([content], language)
    if language == "en":
        # Accept older AI punctuation and position prefixes, only at the beginning.
        body = re.sub(
            r"^(?:top|upper|middle|lower|bottom)[^:.]*?\bpanel\s*[:.,]\s*", "", body, flags=re.IGNORECASE
        )
        shot_pattern = re.escape(shot).replace(r"\-", "[- ]")
        angle_pattern = re.escape(angle).replace(r"\-", "[- ]")
        if panel.angle == "eye":
            angle_pattern = r"eye[- ]level(?: view)?"
        header_token = (
            rf"^(?:{shot_pattern}(?: at {angle_pattern})?|(?:at )?{angle_pattern})(?:\s*[,.;:]\s*|$)"
        )
        for _ in range(2):
            body = re.sub(header_token, "", body, count=1, flags=re.IGNORECASE)
        camera = f"{shot[:1].upper() + shot[1:]}, {angle}."
        body = clean_caption([body], language)
    else:
        for token in (shot, angle):
            body = re.sub(rf"^{re.escape(token)}[，。,:：\s]*", "", body, count=1)
        camera = f"{shot}，{angle}。"
        body = clean_caption([body], language)
    position = panel_positions(page, language).get(panel.id)
    prefix = f"{position}{': ' if index else '：'}" if position else ""
    return prefix + camera + (" " if index and body else "") + body


def panel_caption(
    panel: Panel, page: Page, characters: Mapping[str, Character], language: str | None = None
) -> str:
    if custom_caption_enabled(panel, page):
        return clean_caption(
            [panel.caption_en], "zh" if re.search(r"[\u4e00-\u9fff]", panel.caption_en) else "en"
        )
    preserved = preserved_caption(panel, page)
    if preserved is not None:
        return preserved
    language = language or page.caption_language or "en"
    if language == "en" and translation_state(panel, page, characters) == "fresh":
        return format_scene_caption(panel, page, panel.caption_auto_en["text"], "en")
    return format_scene_caption(panel, page, structured_caption(panel, page, characters), "zh")


def preserved_caption(panel: Panel, page: Page) -> str | None:
    for entry in page.extra.get("moss_import", {}).get("entries", []):
        if (
            entry["kind"] == "panel"
            and entry["id"] == panel.id
            and entry["snapshot"] == entity_hash(panel.to_dict())
        ):
            return str(entry["item"].get("caption", ""))
    return None


def pose_conflicts(panel: Panel, characters: Mapping[str, Character]) -> list[str]:
    messages = []
    for figure in panel.figures:
        actual = figure.pose if figure.pose in POSE_WORDS else "stand"
        description = panel.description
        if len(panel.figures) > 1:
            character = characters.get(figure.character_id)
            name = character.display_name if character else figure.character_id
            description = "，".join(part for part in re.split(r"[，,。.;；]", description) if name in part)
        for pose, (word, pattern) in POSE_WORDS.items():
            if pose != actual and re.search(pattern, description, re.IGNORECASE):
                actual_word = POSE_WORDS[actual][0]
                messages.append(f"第 {panel.order} 格：描述写'{word}'，人物姿势是'{actual_word}'")
    return list(dict.fromkeys(messages))


def caption_notices(panel: Panel, page: Page, characters: Mapping[str, Character]) -> list[dict[str, str]]:
    notices = [
        {"code": "pose_description_conflict", "message": message}
        for message in pose_conflicts(panel, characters)
    ]
    if custom_caption_enabled(panel, page):
        notices.append(
            {
                "code": "custom_caption_position_hint",
                "message": "建议以方位开头；手动覆盖不会自动添加格子方位。",
            }
        )
    if (page.caption_language or "en") == "en" and not custom_caption_enabled(panel, page):
        state = translation_state(panel, page, characters)
        if state not in {"fresh", "preserved"}:
            reason = "缺失" if state == "missing" else "已过期"
            notices.append(
                {
                    "code": f"caption_translation_{state}",
                    "message": f"第 {panel.order} 格英文译文{reason}，本次用中文",
                }
            )
    return notices


def panel_caption_info(panel: Panel, page: Page, characters: Mapping[str, Character]) -> dict:
    caption = panel_caption(panel, page, characters)
    state = translation_state(panel, page, characters)
    custom = custom_caption_enabled(panel, page)
    language = (
        "custom" if custom else "en" if state == "fresh" and (page.caption_language or "en") == "en" else "zh"
    )
    if state == "preserved":
        language = "zh" if re.search(r"[\u4e00-\u9fff]", caption) else "en"
    return {
        "panel_id": panel.id,
        "caption": caption,
        "custom_override": custom,
        "translation_status": state,
        "language": language,
        "source_hash": source_hash(panel, page, characters),
        "warnings": caption_notices(panel, page, characters),
    }
