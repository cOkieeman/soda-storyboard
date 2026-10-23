import assert from "node:assert/strict";
import test from "node:test";
import { sodaPageToProjectPage, projectPageToSodaPage } from "../src/lib/project.ts";
import { useEditorStore } from "../src/lib/store.ts";

const source = () => ({ id: "page", canvas_width: 1000, canvas_height: 1400, text_direction: "horizontal", panels: [], texts: [
  { id: "auto", text: "inherited", direction: null, bbox: null, kind: "dialogue", bubble: "speech" },
  { id: "explicit", text: "vertical", direction: "vertical", bbox: { type: "rect", x: 1.25, y: 2.5, w: 15, h: 22 }, kind: "dialogue", bubble: "speech" },
  { id: "missing", text: "absent fields", kind: "narration", bubble: "none" }
] });

test("inherited direction and automatic or absent boxes survive repeated serialization", () => {
  let raw = source();
  for (let i = 0; i < 3; i++) {
    const view = sodaPageToProjectPage(raw);
    assert.equal(view.bubbles[0].direction, "horizontal");
    assert.equal(view.bubbles[1].direction, "vertical");
    raw = projectPageToSodaPage(view, raw, new Set(), new Set());
    assert.deepEqual(raw.texts, source().texts);
  }
});

test("editing only text or direction does not materialize an automatic box", t => {
  const before = useEditorStore.getState(); t.after(() => useEditorStore.setState(before, true));
  const raw = source();
  useEditorStore.setState({ sodaPage: raw, project: { ...before.project, pages: [sodaPageToProjectPage(raw)] }, dirtyBubbleIds: new Set(), triggerAutoSave: () => {}, recordEdit: () => {} });
  useEditorStore.getState().updateBubble("auto", { text: "changed" });
  let saved = useEditorStore.getState().getEditableSource();
  assert.equal(saved.texts[0].bbox, null);
  assert.equal(saved.texts[0].direction, null);
  useEditorStore.getState().updateBubble("auto", { direction: "vertical" });
  saved = useEditorStore.getState().getEditableSource();
  assert.equal(saved.texts[0].direction, "vertical");
  assert.equal(saved.texts[0].bbox, null);
  useEditorStore.getState().updateBubble("auto", { x: 72 });
  saved = useEditorStore.getState().getEditableSource();
  assert.equal(saved.texts[0].bbox.x, 72);
});

test("clearing explicit direction or box restores inheritance and automatic layout", t => {
  const before = useEditorStore.getState(); t.after(() => useEditorStore.setState(before, true));
  const raw = source();
  useEditorStore.setState({ sodaPage: raw, project: { ...before.project, pages: [sodaPageToProjectPage(raw)] }, dirtyBubbleIds: new Set(), triggerAutoSave: () => {}, recordEdit: () => {} });
  useEditorStore.getState().updateSodaText("explicit", { direction: null, bbox: null });
  assert.equal(useEditorStore.getState().project.pages[0].bubbles[1].direction, "horizontal");
  const saved = useEditorStore.getState().getEditableSource();
  assert.equal(saved.texts[1].direction, null);
  assert.equal(saved.texts[1].bbox, null);
});

test("changing the page direction does not turn inherited direction into a text override", () => {
  const raw = source();
  const view = sodaPageToProjectPage(raw);
  const saved = projectPageToSodaPage(view, { ...raw, text_direction: "vertical" }, new Set(), new Set());
  assert.equal(saved.texts[0].direction, null);
  assert.equal("direction" in saved.texts[2], false);
  assert.equal(sodaPageToProjectPage(saved).bubbles[0].direction, "vertical");
});
