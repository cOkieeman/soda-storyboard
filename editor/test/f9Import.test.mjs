import assert from "node:assert/strict";
import test from "node:test";
import { collectImportedCharacterIds, mapImportedCharacters, normalizeImportedPageIds, parseImportedPage } from "../src/lib/importPage.ts";
import { projectPageToSodaPage, sodaPageToProjectPage } from "../src/lib/project.ts";

const options = { canvasWidth: 1000, canvasHeight: 1000 };
const rect = { type: "rect", x: 10, y: 10, w: 100, h: 100 };
const sourcePage = () => ({ format: "soda-storyboard-page-v1", id: "page", canvas_width: 1000, canvas_height: 1000,
  panels: [{ id: "panel", order: 1, shape: rect, character_ids: [], figures: [], description: "scene" }], texts: [], overlays: [], objects: [] });
const parse = source => parseImportedPage(JSON.stringify(source), options);

test("F9 anonymous figures survive editor source JSON export, import, and character mapping", () => {
  const page = sourcePage();
  page.panels[0].figures = [{ character_id: "", pose: "stand", position: 0.5, facing: "front", custom: { preserve: true } },
    { id: "named", character_id: "unmapped", pose: "sit", position: "left", facing: "right" }];
  const saved = projectPageToSodaPage(sodaPageToProjectPage(page), page);
  const imported = parse(saved).page;
  assert.deepEqual(collectImportedCharacterIds(imported), ["unmapped"]);
  const mapped = mapImportedCharacters(imported, {});
  assert.deepEqual(mapped.panels[0].figures, saved.panels[0].figures);
  assert.deepEqual(mapImportedCharacters(imported, { unmapped: null }).panels[0].figures, [saved.panels[0].figures[0]]);
});

test("F9 native import warns and renames duplicate panel, text, figure, overlay, and object ids", () => {
  const page = sourcePage();
  page.panels.push({ ...structuredClone(page.panels[0]), order: 2 });
  page.panels.push({ ...structuredClone(page.panels[0]), id: "panel-import-2", order: 3 });
  page.panels[0].figures = [{ id: "figure", character_id: "", pose: "stand", position: 0.5, facing: "front" }];
  page.panels[1].figures = structuredClone(page.panels[0].figures);
  page.texts = [1, 2].map(() => ({ id: "text", text: "台词", panel_id: "panel", bbox: rect }));
  page.overlays = [1, 2].map(() => ({ id: "overlay", character_id: "actor", panel_id: "panel", rect, description: "overlay" }));
  page.objects = [1, 2].map(() => ({ id: "object", rect, panel_id: "panel", caption: "layer" }));
  const result = parse(page);
  assert.deepEqual(result.page.panels.map(panel => panel.id), ["panel", "panel-import-3", "panel-import-2"]);
  for (const items of [result.page.panels, result.page.texts, result.page.overlays, result.page.objects,
    result.page.panels.flatMap(panel => panel.figures)]) {
    assert.equal(new Set(items.map(item => item.id)).size, items.length);
  }
  assert.equal(result.warnings.filter(message => /重复.*已自动改名/.test(message)).length, 5);
  assert.equal(result.page.texts[0].panel_id, "panel", "ambiguous references keep the first source panel");
  assert.deepEqual(page.panels.map(panel => panel.id), ["panel", "panel", "panel-import-2"], "preview never mutates source data");
});

test("F9 MOSS import warns and renames duplicate panel, text, and overlay ids", () => {
  const source = { summary: {}, canvas_width: 1000, canvas_height: 1000, bbox_coord_space: "top_left_pixels", bbox_format: "xywh", items: [
    ...[1, 2].map(() => ({ label: "object", panel_id: "panel", caption: "panel", bbox: [10, 10, 900, 900] })),
    ...[1, 2].map(() => ({ label: "text", text_id: "text", panel_id: "panel", text: "台词", bbox: [20, 20, 30, 60] })),
    ...[1, 2].map(() => ({ label: "character", overlay_id: "overlay", character_id: "actor", bbox: [30, 30, 60, 100] }))
  ] };
  const result = parse(source);
  for (const items of [result.page.panels, result.page.texts, result.page.overlays]) {
    assert.equal(new Set(items.map(item => item.id)).size, items.length);
  }
  assert.equal(result.warnings.filter(message => /重复.*已自动改名/.test(message)).length, 3);
});

test("F9 server import results normalize duplicate identities and retain MOSS entry links", () => {
  const page = sourcePage();
  page.panels.push(structuredClone(page.panels[0]));
  page.panels[0].figures = [{ character_id: "", pose: "stand", position: 0.5, facing: "front" }];
  page.moss_import = { entries: [
    { kind: "panel", id: "panel", item: { label: "object", panel_id: "panel" }, snapshot: "old-first" },
    { kind: "panel", id: "panel", item: { label: "object", panel_id: "panel" }, snapshot: "old-second" }
  ] };
  const normalized = normalizeImportedPageIds(page);
  assert.deepEqual(normalized.page.panels.map(panel => panel.id), ["panel", "panel-import-2"]);
  assert.deepEqual(normalized.page.moss_import.entries.map(entry => entry.id), ["panel", "panel-import-2"]);
  assert.deepEqual(normalized.page.moss_import.entries.map(entry => entry.item.panel_id), ["panel", "panel"]);
  assert.equal(normalized.page.panels[0].figures[0].id, undefined, "figures without explicit ids stay valid");
  assert.equal(normalized.warnings.filter(message => /重复.*已自动改名/.test(message)).length, 1);
});
