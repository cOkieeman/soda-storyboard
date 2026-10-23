"""Character edits refresh generated appearance without invalidating scene translations."""

from __future__ import annotations

from copy import deepcopy
from typing import TYPE_CHECKING

import pytest
from test_server_http import PAGE_URL
from test_server_http import client as client  # noqa: PLC0414 -- reusable loopback HTTP fixture

from soda_storyboard.captions import source_hash
from soda_storyboard.io import write_json

if TYPE_CHECKING:
    from test_server_http import Client


@pytest.fixture
def translated_page(client: Client) -> dict:
    raw, _ = client.page()
    raw["caption_language"] = "en"
    rendered = client.server.store.render_page("pudding", raw=raw)
    characters = client.server.store.character_map()
    for panel, model in zip(raw["panels"], rendered.panels, strict=True):
        panel["caption_auto_en"] = {
            "format": "scene-v1",
            "text": f"The scene continues beside the refrigerator in {panel['id']}.",
            "source_hash": source_hash(model, rendered, characters),
            "translated_at": "before-character-edit",
            "future_translation_metadata": {"keep": True},
        }
    write_json(client.root / "pages/pudding.json", raw)
    return raw


@pytest.mark.parametrize("manual_override", [False, True], ids=["generated", "manual-override"])
def test_character_patch_refreshes_all_referencing_captions_without_changing_page(
    client: Client, translated_page: dict, *, manual_override: bool
) -> None:
    raw = translated_page
    custom_caption = "Middle-left panel: preserve this manually written costume and composition."
    if manual_override:
        raw["panels"][3].update(use_custom_caption=True, caption_en=custom_caption)
        write_json(client.root / "pages/pudding.json", raw)
    page_path = client.root / "pages/pudding.json"
    page_before = deepcopy(raw)
    bytes_before = page_path.read_bytes()
    _, page_headers, _ = client.call("GET", PAGE_URL)
    endpoint = PAGE_URL + "/caption-preview"
    status, _, before = client.call("POST", endpoint, {"page": raw})
    assert status == 200
    before = {panel["panel_id"]: panel for panel in before["panels"]}
    status, role_headers, role = client.call("GET", "/api/characters/younger")
    assert status == 200
    old_appearance = role["character"]["appearance"]["en"]
    new_appearance = "a girl with silver braided hair, a teal coat, and a copper moon brooch"
    status, _, saved = client.call(
        "PATCH",
        "/api/characters/younger",
        {"appearance": {"zh": "银色麻花辫，青绿色外套，铜色月亮胸针", "en": new_appearance}},  # noqa: RUF001
        {"If-Match": role_headers["ETag"]},
    )
    assert status == 200, saved

    status, _, preview = client.call("POST", endpoint, {"page": raw})
    assert status == 200
    after = {panel["panel_id"]: panel for panel in preview["panels"]}
    references = {
        panel["id"]
        for panel in raw["panels"]
        if "younger" in panel["character_ids"]
        or any(figure["character_id"] == "younger" for figure in panel["figures"])
    }
    assert references == {"p1", "p4", "p5"}
    for panel_id in references - ({"p4"} if manual_override else set()):
        assert old_appearance in before[panel_id]["caption"]
        assert new_appearance in after[panel_id]["caption"]
        assert old_appearance not in after[panel_id]["caption"]
    for panel in raw["panels"]:
        info = after[panel["id"]]
        assert info["translation_status"] == "fresh"
        assert info["source_hash"] == panel["caption_auto_en"]["source_hash"]
    if manual_override:
        assert after["p4"]["custom_override"] is True
        assert after["p4"]["caption"] == before["p4"]["caption"] == custom_caption
        assert new_appearance not in after["p4"]["caption"]
        assert "custom_caption_position_hint" in {notice["code"] for notice in after["p4"]["warnings"]}
    status, final_headers, final = client.call("GET", PAGE_URL)
    assert status == 200
    assert final_headers["ETag"] == page_headers["ETag"]
    assert final["page"] == page_before
    assert raw == page_before
    assert page_path.read_bytes() == bytes_before
