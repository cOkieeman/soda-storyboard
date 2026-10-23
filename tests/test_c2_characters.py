"""Identity operations update active references atomically and retain anonymous figures."""

from __future__ import annotations

import os
from copy import deepcopy
from typing import TYPE_CHECKING

import pytest
from test_server_http import client as client  # noqa: PLC0414

from soda_storyboard.character_references import page_references, rewrite_page
from soda_storyboard.compiler import compile_page
from soda_storyboard.io import read_json, write_json
from soda_storyboard.models import Page
from soda_storyboard.server.common import APIError, snapshot
from soda_storyboard.server.store import Store
from soda_storyboard.validation import validate_page

if TYPE_CHECKING:
    from test_server_http import Client


def source(client: Client) -> tuple[str, str]:
    identifier = client.call("GET", "/api/characters")[2]["characters"][0]["id"]
    version = client.call("GET", f"/api/characters/{identifier}")[2]["version"]
    return identifier, version


def plan(client: Client, identifier: str, version: str, **options: str) -> tuple[int, dict]:
    status, _, result = client.call(
        "POST", f"/api/characters/{identifier}/plan", options, {"If-Match": version}
    )
    return status, result


def commit(client: Client, identifier: str, version: str, planned: dict) -> tuple[int, dict]:
    status, _, result = client.call(
        "POST", f"/api/characters/{identifier}/commit", {"plan_id": planned["plan_id"]}, {"If-Match": version}
    )
    return status, result


def undo(client: Client, result: dict) -> tuple[int, dict]:
    identifier = result["operation_id"]
    history = client.call("GET", "/api/character-operations")[2]["operations"]
    version = next(item["version"] for item in history if item["operation_id"] == identifier)
    status, _, body = client.call(
        "POST", f"/api/character-operations/{identifier}/undo", {}, {"If-Match": version}
    )
    return status, body


def test_rename_only_changes_display_name_and_is_undoable(client: Client) -> None:
    identifier, version = source(client)
    before = {path: (client.root / path).read_bytes() for path in ("pages/pudding.json", "project.json")}
    original = client.call("GET", f"/api/characters/{identifier}")[2]["character"]
    status, planned = plan(client, identifier, version, action="rename", display_name="新显示名")
    assert status == 200
    status, result = commit(client, identifier, version, planned)
    assert status == 200
    changed = client.call("GET", f"/api/characters/{identifier}")[2]["character"]
    assert changed == {**original, "display_name": "新显示名"}
    assert all((client.root / path).read_bytes() == value for path, value in before.items())
    assert undo(client, result)[0] == 200
    assert client.call("GET", f"/api/characters/{identifier}")[2]["character"] == original


def test_rename_id_updates_pages_bundles_translation_and_undo_as_one(client: Client) -> None:
    identifier, version = source(client)
    raw = read_json(client.root / "pages/pudding.json")
    raw["texts"] = [{"id": "t", "text": identifier, "speaker_id": identifier}]
    raw["panels"][0]["dialogue"] = [{"speaker": identifier, "text": identifier}]
    raw["lora_character"] = "none"
    write_json(client.root / "pages/pudding.json", raw)
    second = deepcopy(raw)
    second["id"] = "second"
    write_json(client.root / "pages/second.json", second)
    card = client.call("GET", f"/api/characters/{identifier}")[2]["character"]
    write_json(
        client.root / "exports/book.storyboard.json",
        {
            "format": "soda-storyboard-bundle-v1",
            "page": raw,
            "characters": {identifier: card},
            "production": {"character_id": identifier},
        },
    )
    write_json(
        client.root / "translations/todo.json",
        {
            "format": "scene-v1",
            "panels": [{"characters": [{"character_id": identifier}], "source_hash": "unchanged"}],
        },
    )
    originals = {path: path.read_bytes() for path in client.root.rglob("*.json") if ".soda" not in path.parts}
    status, planned = plan(client, identifier, version, action="rename_id", new_id="renamed")
    assert status == 200, planned
    assert any(reference["kind"] == "translation" for reference in planned["references"])
    status, result = commit(client, identifier, version, planned)
    assert status == 200, result
    assert commit(client, identifier, version, planned)[1] == result
    assert client.call("GET", f"/api/characters/{identifier}")[0] == 404
    changed = read_json(client.root / "pages/pudding.json")
    assert not any(reference["character_id"] == identifier for reference in page_references(changed))
    assert changed["texts"][0]["text"] == identifier
    bundle = read_json(client.root / "exports/book.storyboard.json")
    assert bundle["characters"]["renamed"]["id"] == "renamed"
    assert bundle["production"]["character_id"] == identifier
    assert read_json(client.root / "translations/todo.json")["panels"][0]["source_hash"] == "unchanged"
    assert undo(client, result)[0] == 200
    assert all(path.read_bytes() == content for path, content in originals.items())


@pytest.mark.parametrize("mode", ["block", "replace", "anonymous"])
def test_delete_choices_and_atomic_undo(client: Client, mode: str) -> None:
    identifier, version = source(client)
    other = next(
        item["id"]
        for item in client.call("GET", "/api/characters")[2]["characters"]
        if item["id"] != identifier
    )
    original = read_json(client.root / "pages/pudding.json")
    status, planned = plan(client, identifier, version, action="delete", mode=mode, replacement_id=other)
    if mode == "block":
        assert status == 409
        assert planned["reason"] == "character_referenced"
        assert planned["references"]
        assert read_json(client.root / "pages/pudding.json") == original
        return
    assert status == 200, planned
    status, result = commit(client, identifier, version, planned)
    assert status == 200, result
    changed = read_json(client.root / "pages/pudding.json")
    assert not any(reference["character_id"] == identifier for reference in page_references(changed))
    if mode == "anonymous":
        figures = [
            figure
            for panel in changed["panels"]
            for figure in panel.get("figures", [])
            if "anonymous_character" in figure
        ]
        assert figures
        assert all(figure["character_id"] == "" for figure in figures)
        assert all(figure["anonymous_character"]["display_name"] == "无名人物" for figure in figures)
        cards = client.server.store.character_map()
        assert not validate_page(Page.from_dict(changed), cards).errors
        compiled = compile_page(Page.from_dict(changed), cards)
        assert "无名人物" in str(compiled)
    assert undo(client, result)[0] == 200
    assert read_json(client.root / "pages/pudding.json") == original


@pytest.mark.parametrize("mutation", ["new_page", "project", "same_size_card", "replacement", "bundle"])
def test_preview_rejects_external_changes_without_partial_writes(client: Client, mutation: str) -> None:
    identifier, version = source(client)
    status, planned = plan(client, identifier, version, action="rename_id", new_id="renamed")
    assert status == 200
    root = client.root
    if mutation == "new_page":
        raw = read_json(root / "pages/pudding.json")
        raw["id"] = "new"
        write_json(root / "pages/new.json", raw)
    elif mutation == "project":
        raw = read_json(root / "project.json")
        write_json(root / "project.json", {**raw, "name": "external"})
    elif mutation == "bundle":
        write_json(root / "exports/new.json", {"format": "scene-v1", "panels": []})
    else:
        path = client.server.store.character_store.locate(identifier)[0]
        if mutation == "replacement":
            path = next(
                path
                for path in (root / "characters").glob("*.json")
                if path != path.parent / f"{identifier}.json"
            )
        content = path.read_bytes()
        stat = path.stat()
        path.write_bytes(content.replace(b'"id"', b'"Id"', 1))
        os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    status, error = commit(client, identifier, version, planned)
    assert status == 409
    assert error["reason"] == "reference_version_conflict"
    assert not (root / "characters/renamed.json").exists()


def test_undo_rejects_new_reference_and_external_edits(client: Client) -> None:
    identifier, version = source(client)
    status, planned = plan(client, identifier, version, action="rename_id", new_id="renamed")
    assert status == 200
    status, result = commit(client, identifier, version, planned)
    assert status == 200
    raw = read_json(client.root / "pages/pudding.json")
    raw["id"] = "new"
    write_json(client.root / "pages/new.json", raw)
    assert undo(client, result)[1]["reason"] == "undo_new_references"
    raw["description"] = "external"
    write_json(client.root / "pages/pudding.json", raw)
    assert undo(client, result)[1]["reason"] == "undo_version_conflict"


def test_failure_rolls_back_and_restart_recovers_prepared_journal(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    identifier, version = source(client)
    operations = client.server.store.character_operations
    planned = operations.plan(identifier, {"action": "rename_id", "new_id": "renamed"}, version)
    originals = {path: path.read_bytes() for path in client.root.rglob("*.json") if ".soda" not in path.parts}
    original_replace = operations.replace_bytes
    count = 0

    def failing(relative: str, content: bytes | None) -> None:
        nonlocal count
        count += 1
        if count == 2:
            message = "injected file replacement failure"
            raise OSError(message)
        original_replace(relative, content)

    monkeypatch.setattr(operations, "replace_bytes", failing)
    with pytest.raises(OSError, match="injected"):
        operations.commit(identifier, planned["plan_id"], version)
    assert all(path.read_bytes() == content for path, content in originals.items())
    manifest = next(operations.directory().glob("*/manifest.json"))
    journal = read_json(manifest)
    journal["state"] = "prepared"
    write_json(manifest, journal)
    Store(client.root)
    assert read_json(manifest)["state"] == "rolled_back"


def test_reference_aliases_position_collisions_and_no_prose_replacement() -> None:
    raw = {
        "panels": [
            {
                "characters": ["a", "b"],
                "character_positions": {"a": 1, "b": 2},
                "dialogue": [{"speaker": "a", "text": "a"}],
            }
        ],
        "texts": [{"speaker_id": "a"}],
        "overlays": [{"character_id": "a", "mode": "layer"}],
        "lora_character": "a",
    }
    with pytest.raises(ValueError, match="位置映射冲突"):
        rewrite_page(raw, "a", "b")
    changed, references = rewrite_page(raw, "a", "c")
    assert len(references) == 6
    assert changed["panels"][0]["dialogue"][0] == {"speaker": "c", "text": "a"}


def test_validate_detects_all_dangling_references_with_empty_catalog() -> None:
    raw = {
        "id": "page",
        "canvas_width": 100,
        "canvas_height": 100,
        "panels": [
            {
                "id": "p",
                "order": 1,
                "shape": {"type": "rect", "x": 0, "y": 0, "w": 100, "h": 100},
                "character_ids": ["missing"],
                "dialogue": [{"speaker": "missing", "text": "hello"}],
            }
        ],
        "texts": [{"id": "t", "text": "hi", "speaker_id": "missing"}],
        "lora_character": "missing",
    }
    report = validate_page(Page.from_dict(raw), {})
    pointers = {issue.field for issue in report.errors if issue.code == "unknown_character_reference"}
    assert pointers == {
        "/panels/0/character_ids/0",
        "/panels/0/dialogue/0/speaker_id",
        "/texts/0/speaker_id",
        "/lora_character",
    }


def test_stale_etag_and_production_guard(client: Client) -> None:
    identifier, version = source(client)
    assert plan(client, identifier, '"stale"', action="delete")[1]["reason"] == "character_version_conflict"
    client.server.store.production_pages.add("pudding")
    with pytest.raises(APIError, match="生产"):
        client.server.store.character_operations.plan(
            identifier, {"action": "rename", "display_name": "new"}, version
        )


def test_noncanonical_card_path_is_renamed(client: Client) -> None:
    identifier, version = source(client)
    path = client.server.store.character_store.locate(identifier)[0]
    path.rename(path.with_name("legacy-filename.json"))
    _, version = snapshot(path.with_name("legacy-filename.json"))
    status, planned = plan(client, identifier, version, action="rename_id", new_id="canonical")
    assert status == 200
    assert commit(client, identifier, version, planned)[0] == 200
    assert not path.with_name("legacy-filename.json").exists()
    assert path.with_name("canonical.json").exists()


def test_design_routes_and_unreferenced_delete(client: Client) -> None:
    raw = {"id": "unused", "display_name": "Unused", "appearance": {"en": "white dress"}}
    status, _, created = client.call("POST", "/api/characters", raw)
    assert status == 201
    assert client.call("DELETE", "/api/characters/unused", headers={"If-Match": '"wrong"'})[0] == 409
    status, _, deleted = client.call(
        "DELETE", "/api/characters/unused", headers={"If-Match": created["version"]}
    )
    assert status == 200
    assert undo(client, deleted)[0] == 200
    version = client.call("GET", "/api/characters/unused")[2]["version"]
    status, _, planned = client.call(
        "POST",
        "/api/character-operations/preview",
        {"character_id": "unused", "action": "rename_id", "new_id": "updated"},
        {"If-Match": version},
    )
    assert status == 200
    status, _, result = client.call(
        "POST", f"/api/character-operations/{planned['plan_id']}/commit", {}, {"If-Match": version}
    )
    assert status == 200
    assert result["target_id"] == "updated"


def test_preparation_race_cannot_adopt_external_bytes(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    identifier, version = source(client)
    operations = client.server.store.character_operations
    planned = operations.plan(identifier, {"action": "rename", "display_name": "new"}, version)
    original_transact = operations.transact
    path, card, _ = client.server.store.character_store.locate(identifier)
    changed = {**card, "display_name": "external"}

    def raced(changes: dict, metadata: dict, versions: dict) -> dict:
        write_json(path, changed)
        return original_transact(changes, metadata, versions)

    monkeypatch.setattr(operations, "transact", raced)
    with pytest.raises(APIError) as error:
        operations.commit(identifier, planned["plan_id"], version)
    assert error.value.payload["reason"] == "transaction_conflict"
    assert read_json(path) == changed


def test_recovery_conflict_keeps_external_update_and_blocks_restart(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    identifier, version = source(client)
    operations = client.server.store.character_operations
    planned = operations.plan(identifier, {"action": "rename_id", "new_id": "renamed"}, version)
    replace = operations.replace_bytes
    external = b'{"id":"external","description":"never overwrite"}\n'
    first = None
    count = 0

    def raced(relative: str, content: bytes | None) -> None:
        nonlocal first, count
        count += 1
        if count == 1:
            first = client.root / relative
            replace(relative, content)
            first.write_bytes(external)
        elif count == 2:
            message = "interrupted"
            raise OSError(message)
        else:
            replace(relative, content)

    monkeypatch.setattr(operations, "replace_bytes", raced)
    with pytest.raises(APIError) as error:
        operations.commit(identifier, planned["plan_id"], version)
    assert error.value.payload["reason"] == "recovery_conflict"
    assert first.read_bytes() == external
    with pytest.raises(APIError) as restarted:
        Store(client.root)
    assert restarted.value.payload["reason"] == "recovery_conflict"
    assert first.read_bytes() == external


@pytest.mark.parametrize("preserve", [False, True])
def test_lora_tie_plan_and_preserve_original_selection(client: Client, *, preserve: bool) -> None:
    store = client.server.store
    for identifier in ("older", "younger"):
        path, raw, _ = store.character_store.locate(identifier)
        write_json(path, {**raw, "lora": {"path": f"{identifier}.safetensors", "strength": 0.8}})
    page = {
        "id": "pudding",
        "canvas_width": 100,
        "canvas_height": 100,
        "panels": [
            {
                "id": "p",
                "order": 1,
                "shape": {"type": "rect", "x": 0, "y": 0, "w": 100, "h": 100},
                "character_ids": ["older", "younger"],
            }
        ],
    }
    write_json(client.root / "pages/pudding.json", page)
    version = store.character_store.detail("older")["version"]
    planned = store.character_operations.plan(
        "older", {"action": "rename_id", "new_id": "zzzz", "preserve_lora": preserve}, version
    )
    assert planned["lora_changes"][0]["before"]["character_id"] == "older"
    assert planned["lora_changes"][0]["after"]["character_id"] == ("zzzz" if preserve else "younger")
    result = store.character_operations.commit("older", planned["plan_id"], version)
    assert undo(client, result)[0] == 200


def test_delete_explicit_lora_disables_page_and_undo_restores(client: Client) -> None:
    store = client.server.store
    path, card, _ = store.character_store.locate("older")
    write_json(path, {**card, "lora": {"path": "older.safetensors", "strength": 1}})
    raw = read_json(client.root / "pages/pudding.json")
    raw["lora_character"] = "older"
    write_json(client.root / "pages/pudding.json", raw)
    version = store.character_store.detail("older")["version"]
    planned = store.character_operations.plan(
        "older", {"action": "delete", "mode": "replace", "replacement_id": "younger"}, version
    )
    result = store.character_operations.commit("older", planned["plan_id"], version)
    assert read_json(client.root / "pages/pudding.json")["lora_character"] == "none"
    assert undo(client, result)[0] == 200
    assert read_json(client.root / "pages/pudding.json")["lora_character"] == "older"


def test_undo_rejects_id_reuse_in_noncanonical_filename(client: Client) -> None:
    identifier, version = source(client)
    status, planned = plan(client, identifier, version, action="rename_id", new_id="renamed")
    assert status == 200
    status, result = commit(client, identifier, version, planned)
    assert status == 200
    write_json(client.root / "characters/new-card.json", {"id": identifier, "display_name": "new occupant"})
    assert undo(client, result)[1]["reason"] == "undo_id_occupied"


def test_old_page_save_cannot_revive_renamed_character(client: Client) -> None:
    raw, headers = client.page()
    identifier, version = source(client)
    status, planned = plan(client, identifier, version, action="rename_id", new_id="renamed")
    assert status == 200
    assert commit(client, identifier, version, planned)[0] == 200
    assert client.call("PUT", "/api/pages/pudding", raw, headers)[0] == 409
    _, latest = client.page()
    status, _, report = client.call("PUT", "/api/pages/pudding", raw, latest)
    assert status == 422
    assert any(issue["code"] == "unknown_character_reference" for issue in report["errors"])


def test_after_write_external_update_is_never_adopted_as_our_commit(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    identifier, version = source(client)
    operations = client.server.store.character_operations
    planned = operations.plan(identifier, {"action": "rename", "display_name": "our name"}, version)
    replace = operations.replace_bytes
    path, card, _ = client.server.store.character_store.locate(identifier)
    outside = {**card, "display_name": "outside name"}

    def raced(relative: str, content: bytes | None) -> None:
        replace(relative, content)
        write_json(path, outside)

    monkeypatch.setattr(operations, "replace_bytes", raced)
    with pytest.raises(APIError) as error:
        operations.commit(identifier, planned["plan_id"], version)
    assert error.value.payload["reason"] == "recovery_conflict"
    assert read_json(path) == outside
    assert not operations.history()["operations"]


@pytest.mark.parametrize("layout", [{}, {"direction": None, "bbox": None}])
def test_http_text_layout_preserves_missing_and_inherited_fields(client: Client, layout: dict) -> None:
    page, headers = client.page()
    page["text_direction"] = "horizontal"
    page["texts"] = [{"id": "automatic", "text": "inherits page direction", **layout}]
    for index in range(3):
        page["texts"][0]["text"] = f"edited {index}"
        status, _, saved = client.call("PUT", "/api/pages/pudding", page, headers)
        assert status == 200
        text = saved["page"]["texts"][0]
        assert {key: text[key] for key in ("direction", "bbox") if key in text} == layout
        page, headers = client.page()
        assert page["text_direction"] == "horizontal"
