"""Write local Chinese/English MOSS prompt variants; never submit generation jobs.

Run from the repository with:
    uv run python scripts/ab_caption_lang.py path/to/pages/page.json --output-dir out

English uses fresh caption_auto_en or --translations, otherwise falls back to Chinese.
No translation service is called. An optional --english-page supplies a translated copy.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from soda_storyboard.captions import source_hash, structured_caption, translation_state
from soda_storyboard.compiler import compile_page
from soda_storyboard.io import load_characters, load_project, read_json, write_json
from soda_storyboard.models import Page
from soda_storyboard.translations import apply_translations

# ruff: noqa: INP001 -- directly executable repository script


def _page(path: Path) -> Page:
    raw = read_json(path)
    page = Page.from_dict(raw)
    project_path = path.parent.parent / "project.json"
    if project_path.is_file():
        project = load_project(project_path)
        for key in ("text_direction", "color_mode", "tags"):
            if key not in raw:
                setattr(page, key, getattr(project, key))
        if not raw.get("style_prompt"):
            page.style_prompt = project.style_prompt
    return page


def main(argv: list[str] | None = None) -> int:  # noqa: C901 -- offline bilingual compilation options
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("page", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--characters", type=Path, help="Defaults to the page project's characters directory")
    parser.add_argument(
        "--translations", type=Path, help="AI translations with panel_id, source_hash and text"
    )
    parser.add_argument("--english-page", type=Path, help="Optional translated page copy for the English arm")
    parser.add_argument("--slant-mode", choices=("cut", "hint", "rect"), default="cut")
    options = parser.parse_args(argv)
    page = _page(options.page)
    english = Page.from_dict(page.to_dict())
    characters = load_characters(options.characters or options.page.parent.parent / "characters")
    for source in (page, english):
        source.legacy_caption_en = False
        for panel in source.panels:
            panel.use_custom_caption = False
    if options.english_page:
        translated = _page(options.english_page)
        descriptions = {panel.id: panel.description for panel in translated.panels}
        for panel in english.panels:
            if panel.id in descriptions:
                panel.extra["description_en"] = descriptions[panel.id]
                panel.caption_auto_en = {
                    "text": structured_caption(panel, english, characters, "en"),
                    "source_hash": source_hash(panel, english, characters),
                    "translated_at": "manual-comparison",
                }
    if options.translations:
        result = apply_translations(english, characters, read_json(options.translations))
        if result["rejected"]:
            parser.error(f"Rejected translations: {result['rejected']}")
    missing = [
        panel.id for panel in english.panels if translation_state(panel, english, characters) != "fresh"
    ]
    if missing:
        sys.stderr.write(
            "English translations missing or stale; Chinese fallback for panels: "
            + ", ".join(missing)
            + ". Supply --translations.\n"
        )
    for language, source in (("zh", page), ("en", english)):
        # A language comparison always uses structured prompts, ignoring manual overrides.
        source.legacy_caption_en = False
        for panel in source.panels:
            panel.use_custom_caption = False
        target = options.output_dir / f"{options.page.stem}.{language}.moss.json"
        write_json(
            target, compile_page(source, characters, caption_language=language, slant_mode=options.slant_mode)
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
