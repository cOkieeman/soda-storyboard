"""Typed active references; prose, captions and production history are never searched."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

# JSON is heterogeneous and pointers describe public document fields.
# ruff: noqa: ANN401, RUF001


def anonymous_character(value: Any) -> bool:
    """An anonymous instance owns a portable appearance snapshot, never a hidden card."""
    if not isinstance(value, dict):
        return False
    appearance = value.get("appearance")
    return (
        value.get("id") == ""
        and value.get("display_name") == "无名人物"
        and isinstance(appearance, dict)
        and all(isinstance(appearance.get(key), str) for key in ("zh", "en"))
        and not any(key in value for key in ("lora", "lora_path", "trigger_words", "triggers"))
    )


def snapshot_character(raw: dict) -> dict:
    from .models import Character  # noqa: PLC0415 -- avoids a model import cycle

    card = Character.from_dict(raw)
    return {
        "id": "",
        "display_name": "无名人物",
        "role_en": "an unnamed person",
        "appearance": {"zh": card.appearance_zh, "en": card.appearance_en},
        "clothing": list(card.clothing),
        "age": card.age,
        **({"sketch_color": card.extra["sketch_color"]} if "sketch_color" in card.extra else {}),
    }


def rewrite_page(  # noqa: C901, PLR0912 -- explicit legacy reference families
    raw: dict, source: str, target: str | None, card: dict | None = None
) -> tuple[dict, list[dict]]:
    """Return a copy and exact references. None means detach with appearance snapshots."""
    value = deepcopy(raw)
    references = []

    def record(pointer: str, kind: str) -> None:
        references.append({"pointer": pointer, "kind": kind, "character_id": source})

    def scalar(item: dict, keys: tuple[str, ...], pointer: str, kind: str) -> None:
        for key in keys:
            if item.get(key) == source:
                record(f"{pointer}/{key}", kind)
                item[key] = target if target is not None else ("none" if key == "lora_character" else None)

    def instance(item: dict, pointer: str) -> None:
        if item.get("character_id") == source:
            record(pointer + "/character_id", "figure")
            item["character_id"] = target or ""
            if target is None and card is not None:
                item["anonymous_character"] = snapshot_character(card)

    scalar(value, ("lora_character",), "", "lora")
    for pi, panel in enumerate(value.get("panels", [])):
        pointer = f"/panels/{pi}"
        for key in ("character_ids", "characters"):
            ids = panel.get(key)
            if not isinstance(ids, list):
                continue
            if source in ids:
                for index, identifier in enumerate(ids):
                    if identifier == source:
                        record(f"{pointer}/{key}/{index}", "cast")
                # Materialize implicit figures before detaching the legacy cast list.
                if target is None and not panel.get("figures"):
                    count = len(ids)
                    panel["figures"] = [
                        {
                            "character_id": identifier,
                            "position": 1 - (i + 0.5) / count
                            if value.get("reading_direction", "rtl") == "rtl"
                            else (i + 0.5) / count,
                        }
                        for i, identifier in enumerate(ids)
                    ]
                panel[key] = list(
                    dict.fromkeys(
                        target if identifier == source else identifier
                        for identifier in ids
                        if identifier != source or target is not None
                    )
                )
        for fi, figure in enumerate(panel.get("figures", [])):
            instance(figure, f"{pointer}/figures/{fi}")
        for di, dialogue in enumerate(panel.get("dialogue", [])):
            scalar(dialogue, ("speaker_id", "speaker"), f"{pointer}/dialogue/{di}", "speaker")
        for key in ("character_positions", "positions", "character_position"):
            positions = panel.get(key)
            if isinstance(positions, dict):
                scalar(positions, ("character_id", "id"), f"{pointer}/{key}", "position")
            if isinstance(positions, dict) and source in positions:
                record(f"{pointer}/{key}/{source}", "position")
                if target is not None:
                    if target in positions and positions[target] != positions[source]:
                        message = f"位置映射冲突：{pointer}/{key}/{target}"
                        raise ValueError(message)
                    positions[target] = positions[source]
                # Anonymous instances keep their legacy position metadata locally.
                elif card is not None:
                    for figure in panel.get("figures", []):
                        if figure.get("anonymous_character"):
                            figure.setdefault("anonymous_positions", {})[key] = deepcopy(positions[source])
                del positions[source]
            for index, position in enumerate(positions if isinstance(positions, list) else []):
                if isinstance(position, dict):
                    scalar(position, ("character_id", "id"), f"{pointer}/{key}/{index}", "position")
    for ti, text in enumerate(value.get("texts", [])):
        scalar(text, ("speaker_id", "speaker"), f"/texts/{ti}", "speaker")
    for oi, overlay in enumerate(value.get("overlays", [])):
        instance(overlay, f"/overlays/{oi}")
    return value, references


def page_references(raw: dict) -> list[dict]:
    """List active IDs including legacy aliases, without requiring character cards."""
    ids = set()

    def collect(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key in {"production", "renders", "history", "anonymous_character"}:
                    continue
                if (
                    key in {"character_id", "speaker_id", "speaker", "lora_character"}
                    and isinstance(child, str)
                    and child not in {"", "none", "auto"}
                ):
                    ids.add(child)
                elif key in {"character_ids", "characters"} and isinstance(child, list):
                    ids.update(item for item in child if isinstance(item, str))
                elif key in {"character_positions", "positions", "character_position"} and isinstance(
                    child, dict
                ):
                    ids.update(child)
                    collect(child)
                else:
                    collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)

    collect(raw)
    return [
        reference for identifier in sorted(ids) for reference in rewrite_page(raw, identifier, identifier)[1]
    ]


def rewrite_document(
    raw: dict, source: str, target: str | None, card: dict, replacement: dict | None = None
) -> tuple[dict, list[dict]]:
    """Pages, portable bundles, and translation requests share the same operation."""
    if raw.get("format") == "soda-storyboard-bundle-v1":
        value = deepcopy(raw)
        value["page"], references = rewrite_page(raw["page"], source, target, card)
        cards = value.get("characters", {})
        if source in cards:
            references.append(
                {"pointer": f"/characters/{source}", "kind": "bundle_card", "character_id": source}
            )
            del cards[source]
            if target is not None:
                cards[target] = {**deepcopy(replacement or card), "id": target}
        return value, references
    if raw.get("format") == "scene-v1":
        value = deepcopy(raw)
        references = []
        for pi, panel in enumerate(value.get("panels", [])):
            cast = panel.get("characters", [])
            for ci, character in enumerate(cast):
                if character.get("character_id") == source:
                    references.append(
                        {
                            "pointer": f"/panels/{pi}/characters/{ci}/character_id",
                            "kind": "translation",
                            "character_id": source,
                        }
                    )
                    character["character_id"] = target
            panel["characters"] = [
                character for character in cast if character.get("character_id") is not None
            ]
        return value, references
    return rewrite_page(raw, source, target, card)
