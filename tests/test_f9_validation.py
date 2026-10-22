"""Regression coverage for JSON persistence and editor object identity."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest
from test_server_http import PAGE_URL, Client, client  # noqa: F401 -- shared loopback fixture

from soda_storyboard.io import read_json, write_json
from soda_storyboard.models import Page
from soda_storyboard.server.app import Server
from soda_storyboard.server.common import APIError
from soda_storyboard.validation import validate_page

# The imported fixture exposes a fixed loopback server; parameters select that fixture.
# ruff: noqa: F811, S310


def page_data() -> dict:
    return {
        "id": "p",
        "canvas_width": 1000,
        "canvas_height": 1000,
        "panel_gap": 0,
        "panels": [
            {"id": "a", "order": 1, "shape": {"type": "rect", "x": 0, "y": 0, "w": 400, "h": 900}},
            {"id": "b", "order": 2, "shape": {"type": "rect", "x": 600, "y": 0, "w": 400, "h": 900}},
        ],
    }


@pytest.mark.parametrize(
    "number",
    ["1e999", "-1e999", "NaN", "Infinity", "-Infinity", "9" * 5000],
    ids=["positive-overflow", "negative-overflow", "nan", "inf", "negative-inf", "huge-integer"],
)
def test_http_rejects_unreadable_numbers_without_committing(client: Client, number: str) -> None:
    raw, headers = client.page()
    original = (client.root / "pages/pudding.json").read_bytes()
    # Send the exact JSON token; json.dumps would hide the valid exponent reproduction.
    payload = json.dumps(raw)[:-1] + ', "custom": [{"nested": ' + number + "}]}"
    request = Request(
        client.url + PAGE_URL,
        method="PUT",
        data=payload.encode(),
        headers={"Content-Type": "application/json", **headers},
    )
    with pytest.raises(HTTPError) as error:
        urlopen(request, timeout=5)
    assert error.value.code == 422
    assert "数值" in json.loads(error.value.read())["error"]
    assert (client.root / "pages/pudding.json").read_bytes() == original
    assert client.call("GET", PAGE_URL)[0] == 200


@pytest.mark.parametrize("number", [float("inf"), float("nan"), 10**400])
def test_json_writer_rejects_before_truncating(tmp_path: Path, number: float) -> None:
    path = write_json(tmp_path / "data.json", {"kept": "原文"})
    original = path.read_bytes()
    with pytest.raises(ValueError, match="数值"):
        write_json(path, {"custom": [{"value": number}]})
    assert path.read_bytes() == original
    assert read_json(path) == {"kept": "原文"}


def test_json_roundtrip_keeps_finite_metadata_and_uint64_seeds(tmp_path: Path) -> None:
    value = {"production": {"seed": 2**64 - 1}, "custom": [1e300, 0, False, -1.25]}
    assert read_json(write_json(tmp_path / "finite.json", value)) == value


@pytest.mark.parametrize("kind", ["panel", "text", "figure", "overlay", "object"])
def test_validate_and_store_reject_duplicate_ids(tmp_path: Path, kind: str) -> None:
    raw = page_data()
    if kind == "panel":
        raw["panels"][1]["id"] = "a"
    elif kind == "text":
        raw["texts"] = [{"id": "t", "text": "台词"}, {"id": "t", "text": "重复"}]
    elif kind == "figure":
        for panel in raw["panels"]:
            panel["figures"] = [{"id": "f", "character_id": ""}]
    elif kind == "overlay":
        overlay = {"id": "l", "character_id": "", "rect": {"x": 0, "y": 0, "w": 30, "h": 30}}
        raw["overlays"] = [overlay, deepcopy(overlay)]
    else:
        item = {"id": "o", "rect": {"x": 0, "y": 0, "w": 30, "h": 30}}
        raw["objects"] = [item, deepcopy(item)]
    assert any("id" in issue.code for issue in validate_page(raw).errors)
    assert any("id" in issue.code for issue in validate_page(Page.from_dict(raw)).errors)
    write_json(tmp_path / "project.json", {"id": "project"})
    server = Server(tmp_path, port=0)
    try:
        with pytest.raises(APIError) as error:
            server.store.checked(raw)
        assert error.value.status == 422
    finally:
        server.server_close()


def test_http_rejects_duplicate_panel_ids(client: Client) -> None:
    raw, headers = client.page()
    raw["panels"][1]["id"] = raw["panels"][0]["id"]
    status, _, body = client.call("PUT", PAGE_URL, raw, headers)
    assert status == 422
    assert any(issue["code"] == "invalid_panel_id" for issue in body["errors"])


@pytest.mark.parametrize(
    ("scope", "field", "value"),
    [
        ("panel", "shot", "close"),
        ("panel", "angle", "sideways"),
        ("panel", "status", "ready"),
        ("page", "reading_direction", "backwards"),
        ("page", "dialogue_mode", "hidden"),
        ("page", "text_direction", "diagonal"),
        ("page", "color_mode", "sepia"),
    ],
)
def test_invalid_enums_are_validation_errors(scope: str, field: str, value: str) -> None:
    raw = page_data()
    target = raw["panels"][0] if scope == "panel" else raw
    target[field] = value
    for page in (raw, Page.from_dict(raw)):
        assert any(issue.field == field for issue in validate_page(page).errors)
