"""Character drafts retain raw data and use the page editor's save guarantees."""

from __future__ import annotations

import os
from copy import deepcopy
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest
from test_server_http import client as client  # noqa: PLC0414 -- reusable HTTP fixture

from soda_storyboard.appearance import appearance_warnings, compose_appearance, synthesize_character
from soda_storyboard.io import read_json, write_json
from soda_storyboard.models import Character
from soda_storyboard.server.characters import patch_character
from soda_storyboard.server.common import snapshot

if TYPE_CHECKING:
    from test_server_http import Client

# Chinese punctuation is part of deterministic composition assertions.
# ruff: noqa: RUF001


@pytest.fixture
def profile() -> dict:
    return {
        "version": 1,
        "mode": "structured",
        "hair": {"style": {"zh": "双马尾"}, "color": {"zh": "粉色"}},
        "eyes": {"zh": "琥珀色眼睛"},
        "outfit": [
            {"id": "g1", "style": {"zh": "宽松连帽衫"}, "color": {"zh": "亮黄色"}},
            {"id": "g2", "style": {"zh": "短裤"}, "color": {"zh": "白色"}},
        ],
        "signatures": [{"zh": "红色星形发夹"}],
        "extra": {"zh": ""},
    }


def test_structured_composition_is_deterministic_and_preserves_manual_english(profile: dict) -> None:
    source = {
        "id": "new",
        "display_name": "新角色",
        "appearance_profile": profile,
        "appearance": {"en": "manual"},
    }
    original = deepcopy(source)
    result = synthesize_character(source)
    assert source == original
    assert result["appearance"] == {
        "zh": "粉色双马尾，琥珀色眼睛，亮黄色宽松连帽衫，白色短裤，红色星形发夹",
        "en": "manual",
    }
    assert synthesize_character(result) == result
    assert Character.from_dict(result).appearance_profile == result["appearance_profile"]
    assert "clothing" not in result


def test_external_final_text_is_preserved_until_explicit_regeneration(profile: dict) -> None:
    value = synthesize_character({"id": "new", "display_name": "新角色", "appearance_profile": profile})
    value["appearance"]["en"] = "a manually translated description"
    assert not any(w["code"] == "appearance_generated_mismatch" for w in appearance_warnings(value))
    english = synthesize_character(value)
    assert english["appearance"]["en"] == value["appearance"]["en"]
    value["appearance"]["zh"] = "外部工具写入的蓝色长裙"
    value["appearance_profile"]["hair"]["color"]["zh"] = "黑色"
    assert synthesize_character(value)["appearance"]["zh"] == value["appearance"]["zh"]
    assert "appearance_generated_mismatch" in {w["code"] for w in appearance_warnings(value)}
    del value["appearance_profile"]["generated"]
    assert synthesize_character(value)["appearance"]["zh"].startswith("黑色双马尾")
    value["appearance_profile"]["mode"] = "text"
    assert synthesize_character(value)["appearance"]["zh"] == "外部工具写入的蓝色长裙"


@pytest.mark.parametrize("bad", [{"outfit": "dress"}, {"hair": {"color": 5}}, {"signatures": ["clip"]}])
def test_malformed_profile_is_rejected(bad: dict) -> None:
    with pytest.raises((TypeError, ValueError)):
        compose_appearance({"version": 1, "mode": "structured", **bad})


def test_partial_english_patch_preserves_legacy_string_appearance() -> None:
    updated = patch_character(
        {"id": "legacy", "name": "旧角色", "appearance": "旧中文外观"},
        {"appearance": {"en": "new English appearance"}},
    )
    assert Character.from_dict(updated).appearance_zh == "旧中文外观"
    assert Character.from_dict(updated).appearance_en == "new English appearance"


def test_validation_preserves_legacy_name_without_inserting_empty_display_name(client: Client) -> None:
    raw = {"id": "legacy", "name": "旧角色", "appearance": "白色长裙"}
    status, _, validation = client.call("POST", "/api/characters/validate", {"character": raw})
    assert status == 200
    assert validation["character"] == raw
    assert Character.from_dict(validation["character"]).display_name == "旧角色"


def test_create_read_patch_require_matching_version(client: Client, profile: dict) -> None:
    source = {"id": "guest", "display_name": "访客", "appearance_profile": profile, "extension": {"keep": 1}}
    status, headers, saved = client.call("POST", "/api/characters", source)
    assert status == 201
    assert headers["ETag"] == saved["version"]
    assert saved["character"]["clothing"] == []
    assert saved["character"]["extension"] == {"keep": 1}
    assert saved["operation_id"]
    status, detail_headers, detail = client.call("GET", "/api/characters/guest")
    assert status == 200
    assert detail_headers["ETag"] == detail["version"] == saved["version"]
    assert detail["character"] == read_json(client.root / "characters/guest.json")
    assert client.call("PATCH", "/api/characters/guest", {"role_en": "guest"})[0] == 409
    status, _, updated = client.call(
        "PATCH", "/api/characters/guest", {"role_en": "guest"}, {"If-Match": detail["version"]}
    )
    assert status == 200
    assert updated["version"] != detail["version"]
    assert updated["character"]["role_en"] == "guest"
    status, _, conflict = client.call(
        "PATCH", "/api/characters/guest", {"role_en": "old"}, {"If-Match": detail["version"]}
    )
    assert status == 409
    assert conflict["current"]["role_en"] == "guest"
    assert conflict["reason"] == "character_version_conflict"
    catalog = client.call("GET", "/api/characters")[2]
    assert catalog["versions"]["guest"] == updated["version"]
    assert catalog["catalog_version"]
    assert (
        client.call("PATCH", "/api/characters/guest", {"id": "other"}, {"If-Match": updated["version"]})[0]
        == 400
    )


@pytest.mark.parametrize("character_id", ["none", "auto", "con", "lpt1", "../bad", "Guest", "a" * 65])
def test_new_ids_are_safe(client: Client, character_id: str) -> None:
    assert client.call("POST", "/api/characters", {"id": character_id, "display_name": "访客"})[0] == 400


def test_real_path_and_legacy_aliases_survive_patch(client: Client) -> None:
    original = {
        "id": "old.role",
        "name": "旧角色",
        "appearance_zh": "旧中文",
        "appearance_en": "old",
        "appearance": {"cn": "旧中文", "en": "old", "future": {"keep": [1, 2]}},
        "lora_path": "old.safetensors",
        "lora_strength": 0.8,
        "lora": {"model": "old.safetensors", "strength": 0.8, "future": {"keep": True}},
        "triggers": ["old"],
        "references": ["refs/a.png"],
        "approved_reference_images": ["refs/approved.png"],
        "future": {"keep": {"nested": 2}},
    }
    path = client.root / "characters/legacy-file.json"
    write_json(path, original)
    detail = client.call("GET", "/api/characters/old.role")[2]
    assert detail["character"] == original
    assert detail["path"] == "characters/legacy-file.json"
    patch = {
        "appearance": {"zh": "新中文", "en": "new"},
        "lora": {"path": "new.safetensors"},
        "trigger_words": ["new"],
    }
    status, _, saved = client.call(
        "PATCH", "/api/characters/old.role", patch, {"If-Match": detail["version"]}
    )
    assert status == 200
    value = read_json(path)
    assert value["appearance_zh"] == value["appearance"]["cn"] == value["appearance"]["zh"] == "新中文"
    assert value["appearance_en"] == value["appearance"]["en"] == "new"
    assert value["lora_path"] == value["lora"]["model"] == value["lora"]["path"] == "new.safetensors"
    assert value["appearance"]["future"] == original["appearance"]["future"]
    assert value["lora"]["future"] == original["lora"]["future"]
    assert value["trigger_words"] == value["triggers"] == ["new"]
    assert value["future"] == original["future"]
    assert value["references"] == original["references"]
    assert not (client.root / "characters/old.role.json").exists()
    status, _, removed = client.call(
        "PATCH", "/api/characters/old.role", {"lora": None}, {"If-Match": saved["version"]}
    )
    assert status == 200
    assert not {"lora", "lora_path", "lora_strength"} & removed["character"].keys()


def test_catalog_diagnoses_bad_files_and_id_collisions(client: Client) -> None:
    directory = client.root / "characters"
    write_json(directory / "also-older.json", {"id": "OLDER", "display_name": "碰撞"})
    (directory / "broken.json").write_text("not JSON", encoding="utf-8")
    catalog = client.call("GET", "/api/characters")[2]
    assert {"character_id_collision", "invalid_character_file", "character_filename_mismatch"} <= {
        diagnostic["code"] for diagnostic in catalog["diagnostics"]
    }
    assert client.call("GET", "/api/characters/older")[0] == 409
    assert client.call("POST", "/api/characters", {"id": "older", "display_name": "访客"})[0] == 409


def test_draft_clothing_warnings_use_same_page_and_never_write(client: Client, profile: dict) -> None:
    path = client.root / "characters/younger.json"
    original = path.read_bytes()
    draft = {"id": "younger", "display_name": "妹妹", "appearance": {"zh": "粉色头发，蓝色眼睛"}}
    result = client.call("POST", "/api/characters/validate", {"character": draft})[2]
    assert "character_clothing_missing" in {warning["code"] for warning in result["warnings"]}
    draft["appearance"]["zh"] += "，连帽衫"
    result = client.call("POST", "/api/characters/validate", {"character": draft})[2]
    assert "character_clothing_color_missing" in {warning["code"] for warning in result["warnings"]}
    profile["outfit"][1]["color"]["zh"] = ""
    draft["appearance_profile"] = profile
    result = client.call("POST", "/api/characters/validate", {"character": draft})[2]
    assert "character_garment_color_missing" in {warning["code"] for warning in result["warnings"]}
    assert result["appearance"]["zh"].startswith("粉色双马尾")
    assert "character_clothing_similar" not in {warning["code"] for warning in result["warnings"]}
    other = read_json(client.root / "characters/older.json")
    other["appearance"] = {"zh": "亮黄色连帽衫"}
    write_json(client.root / "characters/older.json", other)
    page = client.page()[0]
    result = client.call("POST", "/api/characters/validate", {"character": draft, "page": page})[2]
    assert "character_clothing_similar" in {warning["code"] for warning in result["warnings"]}
    assert path.read_bytes() == original
    assert result["errors"] == []


def test_duplicate_is_versioned_and_filters_optional_metadata(client: Client) -> None:
    path = client.root / "characters/older.json"
    source = read_json(path)
    source.update(
        lora={"path": "old.safetensors", "strength": 0.5, "unknown": {"keep": True}},
        trigger_words=["trigger"],
        reference_images=["refs/a.png"],
        approved_images=["refs/approved.png"],
        editor_history=[{"operation": "old"}],
        unknown={"nested": True},
    )
    write_json(path, source)
    detail = client.call("GET", "/api/characters/older")[2]
    options = {
        "character": {
            "id": "older_copy",
            "display_name": "姐姐副本",
            "appearance": {"zh": "编辑后的白色长裙"},
        }
    }
    endpoint = "/api/characters/older/duplicate"
    assert client.call("POST", endpoint, options)[0] == 409
    status, _, copied = client.call("POST", endpoint, options, {"If-Match": detail["version"]})
    assert status == 201
    assert copied["character"]["appearance"]["zh"] == "编辑后的白色长裙"
    assert copied["character"]["unknown"] == source["unknown"]
    assert copied["character"]["reference_images"] == source["reference_images"]
    assert not {"lora", "trigger_words", "approved_images", "editor_history"} & copied["character"].keys()
    assert read_json(path) == source
    options.update(
        character={"id": "older_copy2", "display_name": "副本二"}, copy_lora=True, copy_trigger_words=True
    )
    copied = client.call("POST", endpoint, options, {"If-Match": detail["version"]})[2]["character"]
    assert copied["lora"] == source["lora"]
    assert copied["trigger_words"] == source["trigger_words"]
    source["role_en"] = "changed source"
    write_json(path, source)
    options["character"]["id"] = "older_copy3"
    assert client.call("POST", endpoint, options, {"If-Match": detail["version"]})[0] == 409
    assert not (path.parent / "older_copy3.json").exists()


def test_duplicate_checks_source_again_after_preparing_candidate(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = client.root / "characters/older.json"
    detail = client.call("GET", "/api/characters/older")[2]
    service = client.server.store.character_store
    prepare = service.prepare

    def prepare_then_change_source(raw: dict) -> dict:
        prepared = prepare(raw)
        write_json(path, {**detail["character"], "role_en": "external change during validation"})
        return prepared

    monkeypatch.setattr(service, "prepare", prepare_then_change_source)
    status, _, error = client.call(
        "POST",
        "/api/characters/older/duplicate",
        {"character": {"id": "late_copy", "display_name": "副本"}},
        {"If-Match": detail["version"]},
    )
    assert status == 409
    assert error["current"]["role_en"] == "external change during validation"
    assert not (path.parent / "late_copy.json").exists()


def test_explicit_lora_selection_and_production_block_unsafe_changes(client: Client) -> None:
    endpoint = "/api/characters/older"
    path = client.root / "characters/older.json"
    write_json(path, {**read_json(path), "lora": {"path": "older.safetensors", "strength": 0.8}})
    detail = client.call("GET", endpoint)[2]
    page, match = client.page()
    page["lora_character"] = "older"
    assert client.call("PUT", "/api/pages/pudding", page, match)[0] == 200
    status, _, error = client.call("PATCH", endpoint, {"lora": None}, {"If-Match": detail["version"]})
    assert status == 409
    assert error["reason"] == "lora_references_require_plan"
    assert error["affected_pages"] == ["pudding"]
    assert client.call("GET", endpoint)[2]["version"] == detail["version"]
    client.server.store.production_pages.add("pudding")
    status, _, error = client.call("PATCH", endpoint, {"role_en": "updated"}, {"If-Match": detail["version"]})
    assert status == 409
    assert error["reason"] == "production_running"


def test_same_mtime_and_size_external_character_changes_conflict(client: Client) -> None:
    path = client.root / "characters/older.json"
    detail = client.call("GET", "/api/characters/older")[2]
    before = path.stat()
    path.write_bytes(path.read_bytes().replace(b"20-year-old", b"21-year-old"))
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
    assert path.stat().st_size == before.st_size
    status, _, error = client.call(
        "PATCH", "/api/characters/older", {"role_en": "mine"}, {"If-Match": detail["version"]}
    )
    assert status == 409
    assert error["current"]["age"] == "21-year-old"


def test_character_save_rejects_external_replacement_during_commit(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = client.root / "characters/older.json"
    detail = client.call("GET", "/api/characters/older")[2]
    replace = Path.replace

    def replace_then_edit(path: Path, destination: Path) -> Path:
        result = replace(path, destination)
        if destination == target:
            write_json(target, {**detail["character"], "role_en": "external during commit"})
        return result

    monkeypatch.setattr(Path, "replace", replace_then_edit)
    status, headers, error = client.call(
        "PATCH", "/api/characters/older", {"role_en": "mine"}, {"If-Match": detail["version"]}
    )
    assert status == 409
    assert error["current"]["role_en"] == "external during commit"
    assert headers["ETag"] == snapshot(target)[1]
    assert read_json(target)["role_en"] == "external during commit"
    assert not list(target.parent.glob("*.tmp"))


def test_character_response_and_event_keep_committed_snapshot(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = client.server.store
    detail = client.call("GET", "/api/characters/older")[2]
    target = client.root / "characters/older.json"
    atomic = store.atomic
    committed_version = ""
    queue = client.server.events.subscribe()

    def commit_then_edit(*args: Any, **kwargs: Any) -> Any:  # noqa: ANN401
        nonlocal committed_version
        result = atomic(*args, **kwargs)
        committed_version = result[1]
        write_json(target, {**detail["character"], "role_en": "later external"})
        return result

    monkeypatch.setattr(store, "atomic", commit_then_edit)
    status, headers, saved = client.call(
        "PATCH", "/api/characters/older", {"role_en": "mine"}, {"If-Match": detail["version"]}
    )
    assert status == 200
    assert saved["character"]["role_en"] == "mine"
    assert saved["version"] == headers["ETag"] == committed_version
    assert saved["version"] != snapshot(target)[1]
    event, payload = queue.get(timeout=2)
    assert event == "file_changed"
    assert payload["character_id"] == "older"
    assert payload["version"] == saved["version"]
    assert payload["operation_id"] == saved["operation_id"]
    client.server.events.unsubscribe(queue)
