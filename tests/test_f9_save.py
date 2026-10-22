"""Save responses must describe exactly the version this request committed."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from test_server_http import PAGE_URL
from test_server_http import client as client  # noqa: PLC0414 -- reusable fixture

from soda_storyboard.io import read_json, write_json
from soda_storyboard.server.common import snapshot

if TYPE_CHECKING:
    import pytest
    from test_server_http import Client


def test_save_rejects_external_replacement_during_commit(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    page, match = client.page()
    target = client.root / "pages/pudding.json"
    replace = Path.replace

    def replace_then_edit(path: Path, destination: Path) -> Path:
        result = replace(path, destination)
        if destination == target:
            write_json(target, {**page, "description": "external edit during commit"})
        return result

    monkeypatch.setattr(Path, "replace", replace_then_edit)
    status, headers, body = client.call(
        "PUT", PAGE_URL, {**page, "description": "submitted editor content"}, match
    )
    assert status == 409
    assert body["current"]["description"] == "external edit during commit"
    assert headers["ETag"] == body["version"] == snapshot(target)[1]
    assert read_json(target)["description"] == "external edit during commit"
    assert not list(target.parent.glob("*.tmp"))


def test_save_response_does_not_adopt_a_later_external_version(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = client.server.store
    page, match = client.page()
    target = client.root / "pages/pudding.json"
    atomic = store.atomic
    submitted_version = ""

    def commit_then_edit(*args: Any, **kwargs: Any) -> Any:  # noqa: ANN401
        nonlocal submitted_version
        result = atomic(*args, **kwargs)
        submitted_version = snapshot(target)[1]
        write_json(target, {**page, "description": "external edit after completed commit"})
        return result

    monkeypatch.setattr(store, "atomic", commit_then_edit)
    status, headers, body = client.call(
        "PUT", PAGE_URL, {**page, "description": "submitted editor content"}, match
    )
    assert status == 200
    assert body["page"]["description"] == "submitted editor content"
    assert headers["ETag"] == body["version"] == submitted_version
    assert body["version"] != snapshot(target)[1]
    status, _, conflict = client.call("PUT", PAGE_URL, body["page"], {"If-Match": body["version"]})
    assert status == 409
    assert conflict["current"]["description"] == "external edit after completed commit"
