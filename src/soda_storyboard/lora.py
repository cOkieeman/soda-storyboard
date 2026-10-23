# ruff: noqa: RUF001
"""One optional character LoRA per page, shared by production and diagnostics."""

from __future__ import annotations

from collections import Counter
from typing import TYPE_CHECKING, Any

from .geometry import polygon_area, shape_polygon
from .production.errors import ProductionError

if TYPE_CHECKING:
    from .models import Character, Page, Panel


def panel_characters(panel: Panel) -> list[str]:
    """List each appearing character once, including figure-only appearances."""
    return list(
        dict.fromkeys(
            identifier
            for identifier in [*panel.character_ids, *(f.character_id for f in panel.figures)]
            if identifier
        )
    )


def _appearance_areas(page: Page) -> Counter[str]:
    areas: Counter[str] = Counter()
    for panel in page.panels:
        area = abs(polygon_area(shape_polygon(panel.shape)))
        for character_id in panel_characters(panel):
            areas[character_id] += area
    for overlay in page.overlays:
        if overlay.mode == "moss":
            areas[overlay.character_id] += overlay.rect.w * overlay.rect.h
    return areas


def select_lora(
    page: Page, characters: dict[str, Character], selection: str = "auto"
) -> dict[str, Any] | None:
    """Resolve an explicit override or the project's single/none page policy.

    A page's absent ``lora_character`` means automatic area-weighted selection;
    ``none`` disables it for this page. Explicit CLI ids override either policy.
    """
    if selection == "none":
        return None
    areas = _appearance_areas(page)
    if selection == "auto":
        if page.lora_policy == "none" or page.lora_character == "none":
            return None
        selection = page.lora_character or "auto"
        if selection == "auto":
            eligible = [c for c in characters.values() if c.lora and areas[c.id] > 0]
            if not eligible:
                return None
            # Equal visible area has a stable lexical tie-break independent of
            # filesystem order; a repeated figure never adds a second vote.
            selection = min(eligible, key=lambda c: (-areas[c.id], c.id)).id
    character = characters.get(selection)
    if not character or not character.lora:
        message = f"角色 {selection} 不存在或没有 LoRA"
        raise ProductionError(message)
    if selection not in areas and not any(o.character_id == selection for o in page.overlays):
        message = f"角色 {selection} 没有在此页出场"
        raise ProductionError(message)
    return {"character_id": selection, **character.lora.to_dict()}


def lora_info(page: Page, characters: dict[str, Character]) -> str:
    """Describe the selected LoRA and description-driven supporting cast."""
    chosen = select_lora(page, characters)
    if chosen is None:
        return "本页不使用 LoRA"
    selected_id = chosen["character_id"]
    character = characters[selected_id]
    result = f"本页 LoRA：{character.display_name or character.id}（{chosen['strength']:g}）"
    appearing = dict.fromkeys(
        [
            *(c for panel in page.panels for c in panel_characters(panel)),
            *(o.character_id for o in page.overlays),
        ]
    )
    described = [characters[c].display_name or c for c in appearing if c != selected_id and c in characters]
    if described:
        result += f"；{'、'.join(described)}按角色描述出图"
    return result
