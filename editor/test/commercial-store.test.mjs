import assert from "node:assert/strict";
import test from "node:test";
import { useEditorStore } from "../src/lib/store.ts";
import { sodaPageToProjectPage } from "../src/lib/project.ts";
import { ensureFigureEditor } from "../src/lib/figureRig.ts";
import { generatePageSketchGeometry } from "../src/lib/sketchGeometry.ts";
import { normalizeSelections, selectionKey, selectionBounds, movePageSelections, copyPageSelections, pastePageSelections } from "../src/lib/batchEditing.ts";
import { readRecoveryDraft, writeRecoveryDraft, clearRecoveryDraft, readObjectFlags, writeObjectFlags, discoverProjectIdentity } from "../src/lib/recovery.ts";

const clone = value => JSON.parse(JSON.stringify(value));
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function fixture() {
  const figure = { id: "f1", character_id: "alice", pose: "stand", position: "center", facing: "front", framing: "full" };
  figure.editor = ensureFigureEditor(figure, { width: 400, height: 600 });
  return { format: "soda-storyboard-page-v1", id: "test-page", canvas_width: 1000, canvas_height: 1400,
    reading_direction: "rtl", panel_gap: 20, dialogue_mode: "moss_text", text_direction: "vertical", color_mode: "color", description: "test",
    panels: [{ id: "p1", order: 1, shot: "full", angle: "eye", description: "scene", caption_en: "", character_ids: ["alice"], figures: [figure],
      shape: { type: "rect", x: 40.123456, y: 60.654321, w: 400.333333, h: 600.111111 } }],
    texts: [{ id: "t1", kind: "dialogue", panel_id: "p1", speaker_id: "alice", direction: "vertical", bubble: "speech", text: "hello", font_size: 28, tail_tip: null,
      bbox: { type: "rect", x: 80.25, y: 100.5, w: 90, h: 180 } },
    { id: "t2", kind: "dialogue", panel_id: "p1", speaker_id: "alice", direction: "vertical", bubble: "speech", text: "world", font_size: 30, tail_tip: null,
      bbox: { type: "rect", x: 300.25, y: 320.5, w: 100, h: 160 } }],
    overlays: [{ id: "o1", panel_id: "p1", character_id: "alice", description: "overlay", rect: { type: "rect", x: 120, y: 400, w: 100, h: 200 } }],
    custom_metadata: { keep: true } };
}
async function withStore(run) {
  const original = useEditorStore.getState(), page = fixture();
  useEditorStore.setState({ sodaPage: page, project: { id: page.id, name: page.id, activePageId: page.id, pages: [sodaPageToProjectPage(page)] },
    activePageId: page.id, currentVersion: "v1", projectIdentity: "directory:e:/test-only", characters: [], characterDetails: {},
    sketchGeometry: generatePageSketchGeometry(page, []), selection: null, selections: [], objectFlags: {}, clipboard: null,
    dirtyPanelIds: new Set(), dirtyBubbleIds: new Set(), historyPast: [], historyFuture: [], historyGroup: null,
    canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, recoveryDraft: null, recoveryStorageError: null,
    saveStatus: "saved", saveError: null, savePromise: null, isSaving: false, hasUnsavedChanges: false, editRevision: 0, autoSaveTimer: null,
    triggerAutoSave: () => useEditorStore.setState(state => ({ hasUnsavedChanges: true, editRevision: state.editRevision + 1, saveStatus: "dirty" }))
  });
  try { await run(useEditorStore.getState, page); }
  finally { clearTimeout(useEditorStore.getState().autoSaveTimer); useEditorStore.setState(original, true); }
}
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

test("Selection normalization removes aliases and children of selected panels", () => {
  const page = fixture();
  assert.deepEqual(normalizeSelections(page, [{ kind: "text", id: "t1" }, { kind: "bubble", id: "t1" }, { kind: "figure", id: "f1", panelId: "p1" }, { kind: "panel", id: "p1" }]), [{ kind: "panel", id: "p1" }]);
  assert.notEqual(selectionKey({ kind: "figure", panelId: "a:b", id: "c" }), selectionKey({ kind: "figure", panelId: "a", id: "b:c" }));
});

test("Batch movement and deletion preserve children, unedited floats and one named undo step", async () => withStore(async (get, original) => {
  get().selectItems([{ kind: "panel", id: "p1" }, { kind: "text", id: "t1" }]);
  get().moveSelection(25.5, 17.25);
  assert.equal(get().selections.length, 1);
  assert.equal(get().getEditableSource().texts[0].bbox.x, original.texts[0].bbox.x + 25.5, "a child moves once, not twice");
  assert.equal(get().getEditableSource().panels[0].shape.w, original.panels[0].shape.w);
  assert.equal(get().historyPast.length, 1);
  assert.equal(get().undoLabel, "移动对象");
  get().undo();
  assert.deepEqual(get().getEditableSource(), original);
  assert.equal(get().redoLabel, "移动对象");
  get().redo(); get().deleteSelection();
  assert.equal(get().getEditableSource().panels.length, 0);
  assert.equal(get().getEditableSource().texts.length, 0);
  assert.equal(get().getEditableSource().overlays.length, 0);
  get().undo();
  assert.equal(get().getEditableSource().texts.length, 2);
}));

test("Duplicating a panel clones its whole subtree with fresh IDs and no shared references", async () => withStore(async (get, original) => {
  get().selectItem({ kind: "panel", id: "p1" });
  const selected = get().duplicateSelection(30, 40), page = get().getEditableSource();
  const copied = page.panels.find(panel => panel.id === selected[0].id);
  assert.notEqual(copied.id, "p1");
  assert.notEqual(copied.figures[0].id, "f1");
  assert.equal(copied.shape.x, original.panels[0].shape.x + 30);
  assert.equal(page.texts.filter(text => text.panel_id === copied.id).length, 2);
  assert.ok(page.texts.filter(text => text.panel_id === copied.id).every(text => !original.texts.some(old => old.id === text.id)));
  assert.equal(page.overlays.filter(overlay => overlay.panel_id === copied.id).length, 1);
  copied.figures[0].editor.joints.head[0] = 900;
  assert.notEqual(get().getEditableSource().panels[0].figures[0].editor.joints.head[0], 900);
  assert.equal(get().historyPast.length, 1);
  get().undo(); assert.deepEqual(get().getEditableSource(), original);
}));

test("Object clipboard pastes a new independent selection and rejects cross-project character reuse", async () => withStore(async get => {
  get().selectItem({ kind: "text", id: "t1" });
  assert.equal(await get().copySelection(), true);
  const selected = await get().pasteSelection();
  assert.equal(selected.length, 1);
  assert.notEqual(selected[0].id, "t1");
  assert.equal(get().historyPast.length, 1);
  const clipboard = { ...get().clipboard, projectIdentity: "directory:e:/another" };
  useEditorStore.setState({ clipboard });
  assert.deepEqual(await get().pasteSelection(), []);
  assert.equal(get().historyPast.length, 1);
}));

test("Batch style and dialogue updates each make one undo step and preserve per-figure transforms", async () => withStore(async (get, original) => {
  get().selectItems([{ kind: "text", id: "t1" }, { kind: "text", id: "t2" }]);
  get().batchUpdateSelections({ text: { font_size: 36, bubble: "thought", speaker_id: null } });
  assert.equal(get().historyPast.length, 1);
  assert.ok(get().getEditableSource().texts.every(text => text.font_size === 36 && text.bubble === "thought" && text.speaker_id === null));
  assert.ok(get().project.pages[0].bubbles.every(bubble => bubble.fontSize === 36));
  get().undo(); assert.deepEqual(get().getEditableSource().texts, original.texts);
  get().updateTextsBatch([{ id: "t1", patch: { text: "A" } }, { id: "t2", patch: { text: "B" } }]);
  assert.equal(get().historyPast.length, 1);
  assert.deepEqual(get().getEditableSource().texts.map(text => text.text), ["A", "B"]);
  get().selectItem({ kind: "figure", panelId: "p1", id: "f1" });
  get().applySelectionStyle({ figure: { pose: "wave", editor: { style: "rough", joints: { rHand: [35, -95] } } } });
  const figure = get().getEditableSource().panels[0].figures[0];
  assert.equal(figure.editor.x, original.panels[0].figures[0].editor.x);
  assert.equal(figure.editor.size, original.panels[0].figures[0].editor.size);
  assert.deepEqual(figure.editor.joints.rHand, [35, -95]);
  assert.equal(figure.pose, "wave");
}));

test("Locked descendants block parent movement/deletion and all direct and batch edits honor locks", async () => withStore(async (get, original) => {
  get().toggleObjectLock({ kind: "text", id: "t1" });
  get().selectItem({ kind: "panel", id: "p1" });
  get().moveSelection(10, 10); get().deleteSelection();
  get().updatePanel("p1", { x: 300 }); get().updateSodaText("t1", { text: "blocked" });
  get().selectItem({ kind: "text", id: "t1" }); get().applySelectionStyle({ text: { font_size: 40 } });
  assert.deepEqual(get().getEditableSource(), original);
  assert.equal(get().historyPast.length, 0);
  get().toggleObjectLock({ kind: "panel", id: "p1" });
  assert.equal(get().isObjectLocked({ kind: "figure", panelId: "p1", id: "f1" }), true);
  get().updateFigureById("p1", "f1", { pose: "run" }); get().addTextToPanel("p1");
  assert.deepEqual(get().getEditableSource(), original);
  get().toggleObjectVisibility({ kind: "panel", id: "p1" });
  assert.equal(get().isObjectHidden({ kind: "text", id: "t2" }), true);
  assert.deepEqual(get().getEditableSource(), original, "temporary view aids never enter generation source");
}));

test("Equal spacing distributes variable-size bubbles without rounding other geometry", async () => withStore(async (get, original) => {
  const page = get().getEditableSource();
  page.texts.push({ ...clone(page.texts[0]), id: "t3", bbox: { type: "rect", x: 700, y: 50, w: 70, h: 100 } });
  useEditorStore.setState({ sodaPage: page, project: { ...get().project, pages: [sodaPageToProjectPage(page)] } });
  get().selectItems(page.texts.map(text => ({ kind: "text", id: text.id })));
  get().alignSelection("distribute-x");
  const boxes = get().getEditableSource().texts.map(text => text.bbox).sort((a, b) => a.x - b.x);
  assert.equal(boxes[1].x - boxes[0].x - boxes[0].w, boxes[2].x - boxes[1].x - boxes[1].w);
  assert.equal(get().historyPast.length, 1);
  assert.deepEqual(get().getEditableSource().panels[0].shape, original.panels[0].shape);
}));

test("Rotated figure bounds and movement use world coordinates while preserving local pose", () => {
  const page = fixture(), project = sodaPageToProjectPage(page);
  project.panels[0].rotation = 90;
  const selected = { kind: "figure", panelId: "p1", id: "f1" };
  const before = selectionBounds(project, page, selected);
  const moved = movePageSelections(page, [selected], 30, 10, undefined, project);
  const nextProject = { ...project, panels: [{ ...project.panels[0], sodaData: moved.panels[0] }] };
  const after = selectionBounds(nextProject, moved, selected);
  assert.ok(Math.abs(after.x - before.x - 30) < 1e-8);
  assert.ok(Math.abs(after.y - before.y - 10) < 1e-8);
  assert.deepEqual(moved.panels[0].figures[0].editor.joints, page.panels[0].figures[0].editor.joints);
  const clipboard = copyPageSelections(page, [selected]);
  const duplicate = pastePageSelections(page, clipboard, 30, 10, undefined, project);
  const duplicateProject = { ...project, panels: [{ ...project.panels[0], sodaData: duplicate.page.panels[0] }] };
  const duplicated = selectionBounds(duplicateProject, duplicate.page, duplicate.selections[0]);
  assert.ok(Math.abs(duplicated.x - before.x - 30) < 1e-8);
  assert.ok(Math.abs(duplicated.y - before.y - 10) < 1e-8);
});

test("Recovery and view aids are scoped to stable project identity and never clear an older pending draft on save", async t => {
  const storage = memoryStorage(), page = fixture();
  const draft = { format: "soda-editor-recovery-v1", projectIdentity: "directory:e:/a", pageId: page.id, baseVersion: "old", savedAt: 1, page };
  assert.equal(writeRecoveryDraft(draft, null, storage), true);
  assert.equal(readRecoveryDraft("directory:e:/b", page.id, storage), null);
  const current = { ...draft, baseVersion: "new", savedAt: 2 };
  writeRecoveryDraft(current, draft, storage); clearRecoveryDraft(draft.projectIdentity, page.id, false, storage);
  assert.equal(readRecoveryDraft(draft.projectIdentity, page.id, storage).baseVersion, "old");
  clearRecoveryDraft(draft.projectIdentity, page.id, true, storage);
  assert.equal(readRecoveryDraft(draft.projectIdentity, page.id, storage), null);
  const flags = { "text:t1": { locked: true, hidden: false } };
  writeObjectFlags(draft.projectIdentity, page.id, flags, storage);
  assert.deepEqual(readObjectFlags(draft.projectIdentity, page.id, storage), flags);
  assert.deepEqual(readObjectFlags("directory:e:/b", page.id, storage), {});
  t.mock.method(globalThis, "fetch", async () => response({ project_dir: "E:\\Projects\\Storyboard\\" }));
  assert.equal(await discoverProjectIdentity(), "directory:e:/projects/storyboard");
});

test("Recovery refuses stale server versions without PUT and restores a matching draft as one undoable edit", async t => withStore(async (get, original) => {
  const recovered = clone(original); recovered.texts[0].text = "recovered";
  const draft = { format: "soda-editor-recovery-v1", projectIdentity: get().projectIdentity, pageId: original.id, baseVersion: "v0", savedAt: 1, page: recovered };
  useEditorStore.setState({ recoveryDraft: draft });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => { requests.push(options?.method || "GET"); return response({ page: original, version: "v1" }); });
  assert.equal(await get().restoreRecoveryDraft(), false);
  assert.deepEqual(get().getEditableSource(), original);
  assert.equal(get().saveStatus, "conflict");
  assert.ok(get().saveError);
  assert.deepEqual(requests, ["GET"]);
  useEditorStore.setState({ recoveryDraft: { ...draft, baseVersion: "v1" } });
  assert.equal(await get().restoreRecoveryDraft(), true);
  assert.equal(get().getEditableSource().texts[0].text, "recovered");
  assert.equal(get().undoLabel, "恢复本地草稿");
  assert.equal(get().recoveryDraft, null);
  get().undo(); assert.deepEqual(get().getEditableSource(), original);
}));

test("Saving a recovery copy uses a new POST and preserves current dirty work without overwriting the source", async t => withStore(async (get, original) => {
  const draft = { format: "soda-editor-recovery-v1", projectIdentity: get().projectIdentity, pageId: original.id, baseVersion: "old", savedAt: 1, page: { ...clone(original), production: { selected_render: "old-image.png" } } };
  useEditorStore.setState({ recoveryDraft: draft, hasUnsavedChanges: true });
  let posted;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (options?.method === "POST") { posted = JSON.parse(options.body); return response({ page: posted, version: "copy" }); }
    assert.equal(url, "/api/pages");
    return response({ pages: [] });
  });
  const result = await get().saveRecoveryAsNewPage();
  assert.ok(result.id.startsWith("copy_"));
  assert.equal(result.selected, false);
  assert.equal(posted.production, undefined);
  assert.deepEqual(get().getEditableSource(), original);
  assert.equal(get().hasUnsavedChanges, true);
}));

test("Save errors remain actionable until a successful retry and dirty source export stays accurate", async t => withStore(async get => {
  get().updateBubble("t1", { x: 321.125 });
  let fail = true, stored;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (options?.method === "PUT") {
      if (fail) throw new Error("test network unavailable");
      stored = JSON.parse(options.body); return response({ page: stored, version: "v2", warnings: [] });
    }
    return response({ error: "not supported" }, 501);
  });
  assert.equal(await get().saveCurrentPage(), false);
  assert.equal(get().saveStatus, "error");
  assert.match(get().saveError, /test network unavailable/);
  assert.equal(get().getEditableSource().texts[0].bbox.x, 321.125);
  fail = false;
  assert.equal(await get().retrySave(), true);
  assert.equal(get().saveStatus, "saved");
  assert.equal(get().saveError, null);
  assert.equal(stored.texts[0].bbox.x, 321.125);
}));

test("Picking waits for persisted server selection and failure keeps the prior selected image", async t => withStore(async get => {
  const previous = { renders: [{ path: "old.png", url: "/old.png" }], selected_render: "old.png", candidate_sheet: null };
  useEditorStore.setState({ renders: previous, selectedRenderUrl: "/old.png" });
  let selected = "old.png";
  t.mock.method(globalThis, "fetch", async (url, options) => options?.method === "POST"
    ? response({ id: "job-pick", status: "completed", operation: "pick", page_id: "test-page" })
    : response({ renders: [{ path: "new.png", url: "/new.png" }], selected_render: selected, candidate_sheet: null }));
  assert.equal(await get().pickRender("new.png"), false);
  assert.equal(get().selectedRenderUrl, "/old.png");
  selected = "new.png";
  assert.equal(await get().pickRender("new.png"), true);
  assert.equal(get().selectedRenderUrl, "/new.png");
}));
