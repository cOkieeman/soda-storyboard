import assert from "node:assert/strict";
import test from "node:test";
import { useEditorStore } from "../src/lib/store.ts";
import { projectPageToSodaPage, sodaPageToProjectPage } from "../src/lib/project.ts";
import { generatePageSketchGeometry } from "../src/lib/sketchGeometry.ts";
import { resolvedFigures } from "../src/lib/figures.ts";
import { toggleBubbleTail } from "../src/components/canvas/CanvasContextMenu.tsx";

function withPage(run, modify = page => page) {
  const previous = useEditorStore.getState();
  const panel = (id, order, x) => ({ id, order, shot: "medium", angle: "eye", character_ids: [], figures: [], description: id, caption_en: "", shape: { type: "rect", x, y: 50.987654, w: 420.333333, h: 600.444444 } });
  const text = (id, panelId) => ({ id, panel_id: panelId, kind: "dialogue", speaker_id: "alice", direction: "vertical", bubble: "speech", text: "原台词", bbox: { type: "rect", x: 120.125, y: 140.25, w: 90, h: 180 } });
  const page = modify({ id: "objects", canvas_width: 1024, canvas_height: 1536, reading_direction: "rtl", panel_gap: 20,
    panels: [panel("p1", 1, 40.123456), panel("p2", 2, 520.123456)],
    texts: [text("t1", "p1"), text("t2", "p2"), text("page-text", null)],
    overlays: [{ id: "o1", panel_id: "p1", character_id: "alice", description: "本格图层", rect: { type: "rect", x: 60, y: 80, w: 150, h: 200 } }, { id: "page-overlay", panel_id: null, character_id: "bob", description: "页级图层", rect: { type: "rect", x: 160, y: 180, w: 150, h: 200 } }]
  });
  const install = next => useEditorStore.setState({ sodaPage: next, project: { id: next.id, name: next.id, activePageId: next.id, pages: [sodaPageToProjectPage(next)] }, sketchGeometry: generatePageSketchGeometry(next, []) });
  useEditorStore.setState({ activePageId: page.id, characters: [{ id: "alice", display_name: "Alice" }, { id: "bob", display_name: "Bob" }],
    selection: null, historyPast: [], historyFuture: [], historyGroup: null, canUndo: false, canRedo: false,
    dirtyPanelIds: new Set(), dirtyBubbleIds: new Set(), hasUnsavedChanges: false, autoSaveTimer: null,
    triggerAutoSave: () => useEditorStore.setState({ hasUnsavedChanges: true }) });
  install(page);
  const save = () => { const state = useEditorStore.getState(); return projectPageToSodaPage(state.project.pages[0], state.sodaPage, state.dirtyPanelIds, state.dirtyBubbleIds); };
  try { run({ get: useEditorStore.getState, original: structuredClone(page), save, install }); }
  finally { useEditorStore.setState(previous, true); }
}

for (const split of ["splitPanelHorizontal", "splitPanelVertical"]) {
  test(`${split}: the new selected panel accepts elements before an autosave`, () => withPage(({ get, original, save }) => {
    get()[split]("p1");
    const id = get().selection.id;
    assert.notEqual(id, "p1");
    assert.equal(get().sodaPage.panels.length, 3);
    assert.ok(get().sodaPage.panels.some(panel => panel.id === id));
    assert.ok(get().sketchGeometry.panels.some(panel => panel.panel_id === id));
    assert.deepEqual(get().sodaPage.panels.find(panel => panel.id === "p2").shape, original.panels[1].shape, "untouched panel precision stays exact");
    get().addFigurePreset("stand");
    assert.equal(get().selection.panelId, id);
    get().addTextPreset("speech_horizontal");
    assert.equal(save().texts.find(text => text.id === get().selection.id).panel_id, id);
    assert.equal(save().panels.find(panel => panel.id === "p1").figures.length, 0);
  }));
}

test("Cast toggles synchronize visible figures, generated cast, and undo without duplicating roles", () => withPage(({ get, save, original }) => {
  get().togglePanelCharacter("p1", "alice");
  assert.deepEqual(save().panels[0].character_ids, ["alice"]);
  assert.deepEqual(resolvedFigures(get().sodaPage.panels[0]).map(figure => figure.character_id), ["alice"]);
  assert.equal(get().sketchGeometry.panels[0].figures.length, 1);
  get().togglePanelCharacter("p1", "bob");
  assert.deepEqual(save().panels[0].character_ids, ["alice", "bob"]);
  assert.equal(get().sketchGeometry.panels[0].figures.length, 2);
  get().togglePanelCharacter("p1", "alice");
  assert.deepEqual(save().panels[0].character_ids, ["bob"]);
  assert.deepEqual(save().panels[0].figures.map(figure => figure.character_id), ["bob"]);
  get().undo();
  assert.deepEqual(save().panels[0].character_ids, ["alice", "bob"]);
  get().redo();
  assert.deepEqual(save().panels[0].character_ids, ["bob"]);
  get().togglePanelCharacter("p1", "alice");
  assert.equal(save().panels[0].figures.filter(figure => figure.character_id === "alice").length, 1);
  assert.deepEqual(save().panels[0].shape, original.panels[0].shape);
}));

test("Removing a repeated role removes all its figures while retaining the other person's custom data", () => withPage(({ get, save }) => {
  get().togglePanelCharacter("p1", "alice");
  assert.deepEqual(save().panels[0].figures.map(figure => figure.character_id), ["bob"]);
  assert.equal(save().panels[0].figures[0].custom_note, "keep me");
  get().undo();
  assert.equal(save().panels[0].figures.filter(figure => figure.character_id === "alice").length, 2);
}, page => ({ ...page, panels: [{ ...page.panels[0], character_ids: ["alice", "bob"], figures: [
  { id: "a1", character_id: "alice", pose: "stand", position: 0.2, facing: "right" },
  { id: "a2", character_id: "alice", pose: "wave", position: 0.4, facing: "front" },
  { id: "b1", character_id: "bob", pose: "sit", position: 0.7, facing: "left", custom_note: "keep me" }
] }, page.panels[1]] })));

test("Legacy cast-only people remain visible when a different role is toggled", () => withPage(({ get, save }) => {
  get().togglePanelCharacter("p1", "bob");
  assert.deepEqual(save().panels[0].figures.map(figure => figure.character_id), ["alice", "bob"]);
  assert.equal(get().sketchGeometry.panels[0].figures.length, 2);
  get().togglePanelCharacter("p1", "alice");
  assert.deepEqual(save().panels[0].character_ids, ["bob"]);
}, page => ({ ...page, panels: [{ ...page.panels[0], character_ids: ["alice"] }, page.panels[1]] })));

test("Deleting a panel removes its own texts and overlays with one complete undo and redo", () => withPage(({ get, save }) => {
  const before = save();
  get().selectItem({ kind: "panel", id: "p1" });
  get().deleteSelection();
  const removed = save();
  assert.deepEqual(removed.panels.map(panel => panel.id), ["p2"]);
  assert.deepEqual(removed.texts.map(text => text.id), ["t2", "page-text"]);
  assert.deepEqual(removed.overlays.map(overlay => overlay.id), ["page-overlay"]);
  assert.equal(get().project.pages[0].bubbles.some(bubble => bubble.id === "t1"), false);
  assert.equal(get().sketchGeometry.panels.some(panel => panel.panel_id === "p1"), false);
  const ids = new Set(removed.panels.map(panel => panel.id));
  assert.ok(removed.texts.every(text => !text.panel_id || ids.has(text.panel_id)));
  assert.ok(removed.overlays.every(overlay => !overlay.panel_id || ids.has(overlay.panel_id)));
  assert.equal(get().historyPast.length, 1);
  get().undo();
  assert.deepEqual(save(), before);
  assert.equal(get().project.pages[0].bubbles.length, 3);
  get().redo();
  assert.deepEqual(save(), removed);
}));

test("The context-menu tail action clears a saved tail and remains cleared after reload", () => withPage(({ get, save, install }) => {
  const bubble = () => get().project.pages[0].bubbles.find(item => item.id === "t1");
  toggleBubbleTail(bubble());
  assert.deepEqual(save().texts[0].tail_tip, [45, 208]);
  install(JSON.parse(JSON.stringify(save())));
  toggleBubbleTail(bubble());
  assert.equal(bubble().tailTip, null);
  assert.equal(save().texts[0].tail_tip, null);
  install(JSON.parse(JSON.stringify(save())));
  assert.equal(bubble().tailTip, null);
}));

test("Moving a parent panel carries its text, overlays and figure geometry together with complete undo and redo", () => withPage(({ get, save }) => {
  const before = structuredClone(save());
  const oldGeometry = generatePageSketchGeometry(before, get().characters);
  const sourcePanel = get().project.pages[0].panels.find(panel => panel.id === "p1");
  const dx = 37.25, dy = -22.5;
  get().updatePanel("p1", { x: sourcePanel.x + dx, y: sourcePanel.y + dy });
  const moved = structuredClone(save());
  const targetText = moved.texts.find(text => text.id === "t1");
  const originalText = before.texts.find(text => text.id === "t1");
  assert.equal(targetText.bbox.x, originalText.bbox.x + dx);
  assert.equal(targetText.bbox.y, originalText.bbox.y + dy);
  assert.deepEqual(targetText.tail_tip, originalText.tail_tip, "the tail is local to its bubble");
  const targetBubble = get().project.pages[0].bubbles.find(bubble => bubble.id === "t1");
  assert.deepEqual([targetBubble.x, targetBubble.y], [targetText.bbox.x, targetText.bbox.y]);
  const targetOverlay = moved.overlays.find(overlay => overlay.id === "o1");
  const originalOverlay = before.overlays.find(overlay => overlay.id === "o1");
  assert.deepEqual(targetOverlay.rect, { ...originalOverlay.rect, x: originalOverlay.rect.x + dx, y: originalOverlay.rect.y + dy });

  // Figure anchors and joints are panel-local. Their stored coordinates stay
  // fixed while the displayed geometry moves by the parent's page offset.
  assert.deepEqual(moved.panels[0].figures, before.panels[0].figures);
  const oldFigures = oldGeometry.panels.find(panel => panel.panel_id === "p1").figures;
  const newFigures = get().sketchGeometry.panels.find(panel => panel.panel_id === "p1").figures;
  assert.equal(oldFigures.length, 2);
  oldFigures.forEach((figure, index) => {
    const oldHead = figure.primitives.find(primitive => primitive.type === "circle");
    const newHead = newFigures[index].primitives.find(primitive => primitive.type === "circle");
    assert.ok(Math.abs(newHead.cx - oldHead.cx - dx) < 0.0001);
    assert.ok(Math.abs(newHead.cy - oldHead.cy - dy) < 0.0001);
    assert.ok(Math.abs(newHead.r - oldHead.r) < 0.0001, "moving the parent must not resize its people");
  });

  assert.deepEqual(moved.panels.find(panel => panel.id === "p2"), before.panels.find(panel => panel.id === "p2"));
  assert.deepEqual(moved.texts.filter(text => text.panel_id !== "p1"), before.texts.filter(text => text.panel_id !== "p1"));
  assert.deepEqual(moved.overlays.filter(overlay => overlay.panel_id !== "p1"), before.overlays.filter(overlay => overlay.panel_id !== "p1"));
  assert.deepEqual(get().sketchGeometry.panels.find(panel => panel.panel_id === "p2"), oldGeometry.panels.find(panel => panel.panel_id === "p2"));
  assert.equal(get().historyPast.length, 1);
  get().undo();
  assert.deepEqual(save(), before);
  assert.deepEqual(get().sketchGeometry.panels.map(panel => panel.figures.map(figure => figure.primitives)), oldGeometry.panels.map(panel => panel.figures.map(figure => figure.primitives)));
  get().redo();
  assert.deepEqual(save(), moved);
  assert.deepEqual(get().project.pages[0].bubbles.find(bubble => bubble.id === "t1").tailTip, originalText.tail_tip);
}, page => ({ ...page,
  panels: [{ ...page.panels[0], character_ids: ["alice", "bob"], figures: [
    { id: "editable", character_id: "alice", pose: "lie", position: 0.4, facing: "left", custom_note: "retain this", editor: {
      version: 1, x: 180, y: 240, size: 120, flip: true, view: "side", style: "box", break_frame: true,
      joints: { rHand: [39.5, 2.25] }
    } },
    { id: "legacy", character_id: "bob", pose: "sit", position: 0.75, facing: "right" }
  ] }, { ...page.panels[1], character_ids: ["bob"], figures: [{ id: "other", character_id: "bob", pose: "stand", position: 0.5, facing: "front" }] }],
  texts: page.texts.map(text => text.id === "t1" ? { ...text, tail_tip: [45, 208] } : text),
  overlays: [...page.overlays, { id: "other-overlay", panel_id: "p2", character_id: "bob", description: "other panel", rect: { type: "rect", x: 560, y: 90, w: 120, h: 160 } }]
})));
