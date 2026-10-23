"""Keep imported MOSS items byte-value equivalent until their entity is edited."""

from __future__ import annotations

import copy
import hashlib
import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import Page

from .geometry import from_moss_bbox


def entity_hash(value: dict) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()
    ).hexdigest()


def _legacy_snapshots(metadata: dict) -> dict[tuple[str, str], str]:
    """Reconstruct display baselines for imports saved before model-v1 snapshots."""
    from .importers import import_moss  # noqa: PLC0415 -- lazy import avoids the importer/hash cycle

    source = {
        **metadata.get("top_level", {}),
        "summary": metadata.get("summary", {}),
        "items": [entry["item"] for entry in metadata.get("entries", [])],
    }
    baseline, _ = import_moss(source)
    return {
        (entry["kind"], entry["id"]): entry["snapshot"]
        for entry in baseline.extra["moss_import"]["entries"]
        if entry["kind"] != "passthrough"
    }


def imported_result(page: Page, compiled: dict, *, with_ids: bool) -> dict:  # noqa: C901, PLR0912, PLR0915 -- ordered passthrough, legacy snapshots, edits, deletion and additions
    metadata = page.extra.get("moss_import")
    if not isinstance(metadata, dict):
        return compiled
    entities = {
        **{("panel", item.id): item for item in page.panels},
        **{("text", item.id): item for item in page.texts},
        **{("object", item.id): item for item in page.objects},
    }
    generated = {}
    for index, item in enumerate(compiled["items"]):
        for kind, key in (("object", "object_id"), ("text", "text_id"), ("panel", "panel_id")):
            if key in item and (kind != "panel" or item["label"] == "object"):
                generated[kind, item[key]] = (index, item)
                break
    used = set()
    items = []
    legacy_snapshots = None
    for entry in metadata.get("entries", []):
        # Source fidelity must obey the current mode, including uneditable text.
        if page.dialogue_mode != "moss_text" and (
            entry["kind"] == "text"
            or (isinstance(entry.get("item"), dict) and entry["item"].get("label") == "text")
        ):
            continue
        if entry["kind"] == "passthrough":
            items.append(copy.deepcopy(entry["item"]))
            continue
        key = entry["kind"], entry["id"]
        entity = entities.get(key)
        if entity is None:
            continue
        produced = generated.get(key)
        if produced:
            used.add(produced[0])
        current_hash = entity_hash(entity.to_dict())
        unchanged = current_hash == entry["snapshot"]
        if not unchanged and metadata.get("snapshot_format") is None:
            if legacy_snapshots is None:
                legacy_snapshots = _legacy_snapshots(metadata)
            unchanged = current_hash == legacy_snapshots.get(key)
        if unchanged:
            original_item = copy.deepcopy(entry["item"])
            if with_ids:
                original_item[
                    {"panel": "panel_id", "text": "text_id", "object": "object_id"}[entry["kind"]]
                ] = entry["id"]
            items.append(original_item)
        elif produced:
            replacement = copy.deepcopy(produced[1])
            replacement["bbox"] = _source_bbox(replacement["bbox"], page, metadata.get("top_level", {}))
            if not with_ids:
                for field in (
                    "panel_id",
                    "text_id",
                    "object_id",
                    "figure_index",
                    "character_id",
                    "speaker_id",
                ):
                    if field not in entry["item"]:
                        replacement.pop(field, None)
            items.append({**copy.deepcopy(entry["item"]), **replacement})
    for index, generated_item in enumerate(compiled["items"]):
        if index not in used:
            item = {
                **generated_item,
                "bbox": _source_bbox(generated_item["bbox"], page, metadata.get("top_level", {})),
            }
            if not with_ids:
                item = {
                    key: value
                    for key, value in item.items()
                    if key
                    not in {"panel_id", "text_id", "object_id", "figure_index", "character_id", "speaker_id"}
                }
            items.append(item)
    original = metadata.get("top_level", {})
    result = {**copy.deepcopy(original), **compiled, "items": items}
    result["summary"] = copy.deepcopy(metadata["summary"])
    if page.style_prompt:
        result["summary"]["caption"] = page.style_prompt + "; " + result["summary"].get("caption", "")
    if "summary" not in metadata.get("declared_fields", []) and not page.style_prompt:
        result.pop("summary", None)
    # Original coordinate declarations belong to the unchanged source contract.
    for key in ("bbox_format", "bbox_coord_space"):
        if key in original:
            result[key] = original[key]
        elif key not in metadata.get("declared_fields", []):
            result.pop(key, None)
    return result


def _source_bbox(bbox: list, page: Page, declarations: dict) -> list:
    x, y, right, bottom = from_moss_bbox(bbox, page.width, page.height)
    space = declarations.get("bbox_coord_space", "abs_centralized")
    if space in {"abs_centralized", "centered"}:
        x, right = x - page.width / 2, right - page.width / 2
        y, bottom = y - page.height / 2, bottom - page.height / 2
    elif space in {"normalized", "0-1", "relative"}:
        x, right, y, bottom = x / page.width, right / page.width, y / page.height, bottom / page.height
    elif space in {"normalized_1000", "0-1000"}:
        x, right, y, bottom = (
            x / page.width * 1000,
            right / page.width * 1000,
            y / page.height * 1000,
            bottom / page.height * 1000,
        )
    fmt = declarations.get("bbox_format", "yxyx")
    return (
        [y, x, bottom, right]
        if fmt == "yxyx"
        else [x, y, right - x, bottom - y]
        if fmt == "xywh"
        else [x, y, right, bottom]
    )
