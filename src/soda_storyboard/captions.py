"""Canonical captions, conservative pose checks and offline translation freshness."""

from __future__ import annotations

import hashlib
import json
import re
from typing import TYPE_CHECKING

from .clothing import clothing_phrases
from .figure_semantics import figure_description
from .figures import panel_figures
from .moss_roundtrip import entity_hash
from .panel_positions import panel_positions

if TYPE_CHECKING:
    from collections.abc import Mapping

    from .models import Character, Figure, Page, Panel

# ruff: noqa: RUF001 -- bilingual prompt punctuation and user-facing diagnostics.

SCENE_TRANSLATION_FORMAT = "scene-v1"
MIN_GROUP_SIZE = 2
TRANSLATION_MIGRATION = (
    "旧整句译文需要重新翻译：运行 translate <页> --todo，仅翻场景、动作和道具，"
    "排除人物外观、服装、方位和程序姿势，再用 translate <页> --apply <译文文件>；"
    "角色外观由编译器统一插入。"
)

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


def _join_preserving(parts: list[str], language: str, *, sentence: bool = True) -> str:
    """Join generated blocks without rewriting the canonical appearance text."""
    result = ""
    for part in parts:
        if not part:
            continue
        if result:
            result += (
                (" " if language == "en" else "")
                if result[-1] in ".。!?！？"
                else (", " if language == "en" else "，")
            )
        result += part
    if sentence and result and result[-1] not in ".。!?！？":
        result += "." if language == "en" else "。"
    return result


def character_caption(identifier: str, characters: Mapping[str, Character], language: str = "zh") -> str:
    character = characters.get(identifier)
    if character is None:
        return identifier
    detail = (
        (character.appearance_zh or character.display_name)
        if language == "zh"
        else (character.appearance_en or character.appearance_zh or character.display_name)
    )
    parts = _unique([detail, *character.clothing])
    # Appearance is inserted verbatim; it can already start with the name.
    name = (character.role_en or character.display_name) if language == "en" else character.display_name
    if not re.match(rf"^\s*{re.escape(name)}(?![A-Za-z0-9_])", detail, re.IGNORECASE):
        parts.insert(0, name)
    if character.age and character.age not in detail:
        parts.insert(1, character.age)
    for trigger in character.trigger_words:
        if trigger and not _contains_identity(parts, trigger):
            parts.append(trigger)
    return _join_preserving(parts, language, sentence=False)


def figure_caption(
    figure: Figure, characters: Mapping[str, Character], language: str, shot: str | None = None
) -> str:
    return _join_preserving(
        [
            instance_caption(figure.character_id, figure.extra, characters, language),
            figure_description(figure, language, head_only=shot in {"close_up", "extreme_close_up"}),
        ],
        language,
    )


def instance_caption(identifier: str, extra: dict, characters: Mapping[str, Character], language: str) -> str:
    """Anonymous figures carry their own appearance and never load a character LoRA."""
    from .character_references import anonymous_character  # noqa: PLC0415
    from .models import Character  # noqa: PLC0415 -- needed for instance snapshots

    snapshot = extra.get("anonymous_character")
    if not identifier and anonymous_character(snapshot):
        return character_caption("", {"": Character.from_dict(snapshot)}, language)
    return character_caption(identifier, characters, language)


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


def panel_character_ids(panel: Panel, page: Page) -> list[str]:
    return list(
        dict.fromkeys(
            identifier
            for identifier in [*panel.character_ids, *(f.character_id for f in panel_figures(panel, page))]
            if identifier
        )
    )


def outfit_distinction(panel: Panel, page: Page, characters: Mapping[str, Character], language: str) -> str:
    identifiers = panel_character_ids(panel, page)
    if len(identifiers) < MIN_GROUP_SIZE:
        return ""
    outfits = []
    for identifier in identifiers:
        character = characters.get(identifier)
        name = (
            identifier
            if character is None
            else (
                (character.role_en or character.display_name) if language == "en" else character.display_name
            )
        )
        phrases = clothing_phrases(character, language) if character is not None else []
        outfit = (", " if language == "en" else "、").join(phrases)
        if not outfit:
            outfit = (
                "the outfit specified in their character card" if language == "en" else "角色卡指定的服装"
            )
        outfits.append(f"{name} in {outfit}" if language == "en" else f"{name}穿{outfit}")
    if language == "en":
        return "each character keeps their own outfit: " + "; ".join(outfits) + "."
    return "每个角色保持各自的服装：" + "；".join(outfits) + "。"


def translation_source(panel: Panel) -> dict[str, str]:
    """Only scene prose is translated; cards, camera and rigs are generated."""
    return {
        "description": panel.description,
        **{key: panel.extra[key] for key in ("props", "atmosphere") if isinstance(panel.extra.get(key), str)},
    }


def _caption_body(
    panel: Panel, page: Page, characters: Mapping[str, Character], language: str, scene: str | None = None
) -> str:
    figures = panel_figures(panel, page)
    figure_ids = {figure.character_id for figure in figures}
    details = [figure_caption(figure, characters, language, panel.shot) for figure in figures]
    details.extend(
        character_caption(identifier, characters, language)
        for identifier in dict.fromkeys(panel.character_ids)
        if identifier not in figure_ids
    )
    if scene is None:
        source = (
            panel.description if language == "zh" else panel.extra.get("description_en") or panel.description
        )
        scene = clean_caption(
            [source, *(value for key, value in translation_source(panel).items() if key != "description")],
            language,
        )
    identifiers = panel_character_ids(panel, page)
    scene = _scene_without_repeated_appearance(scene, identifiers, characters, language)
    return _join_preserving(
        [*details, scene, outfit_distinction(panel, page, characters, language)], language
    )


def structured_caption(
    panel: Panel, page: Page, characters: Mapping[str, Character], language: str = "zh"
) -> str:
    index = language == "en"
    return _join_preserving(
        [
            SHOTS.get(panel.shot, (panel.shot, panel.shot))[index],
            ANGLES.get(panel.angle, (panel.angle, panel.angle))[index],
            _caption_body(panel, page, characters, language),
        ],
        language,
    )


def source_hash(panel: Panel, page: Page, characters: Mapping[str, Character]) -> str:
    del page, characters  # Public signature retained for existing callers.
    source = json.dumps(translation_source(panel), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def translation_state(panel: Panel, page: Page, characters: Mapping[str, Character]) -> str:
    if preserved_caption(panel, page) is not None:
        return "preserved"
    cached = panel.caption_auto_en
    if not cached or not isinstance(cached.get("text"), str) or not cached["text"].strip():
        return "missing"
    if cached.get("format") != SCENE_TRANSLATION_FORMAT:
        return "legacy"
    return "fresh" if cached.get("source_hash") == source_hash(panel, page, characters) else "stale"


def format_scene_caption(panel: Panel, page: Page, content: str, language: str) -> str:
    """Add geometry and a single camera sentence without changing the cached source."""
    index = language == "en"
    shot = SHOTS.get(panel.shot, (panel.shot, panel.shot))[index]
    angle = ANGLES.get(panel.angle, (panel.angle, panel.angle))[index]
    body = content
    camera = f"{shot[:1].upper() + shot[1:]}, {angle}." if index else f"{shot}，{angle}。"
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
        body = _caption_body(panel, page, characters, "en", panel.caption_auto_en["text"])
        return format_scene_caption(panel, page, body, "en")
    return format_scene_caption(panel, page, _caption_body(panel, page, characters, "zh"), "zh")


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
                    "message": f"第 {panel.order} 格：{TRANSLATION_MIGRATION} 本次用中文"
                    if state == "legacy"
                    else f"第 {panel.order} 格英文译文{reason}，本次用中文",
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
