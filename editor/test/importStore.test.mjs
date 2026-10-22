import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { ApiError } from "../src/lib/api.ts";
import { useEditorStore } from "../src/lib/store.ts";
import { sodaPageToProjectPage } from "../src/lib/project.ts";

const originalFetch = globalThis.fetch;
const clone = value => JSON.parse(JSON.stringify(value));
const page = {
  format: "soda-storyboard-page-v1", id: "current", canvas_width: 800, canvas_height: 1000,
  reading_direction: "rtl", panel_gap: 20, dialogue_mode: "moss_text", text_direction: "vertical", color_mode: "color", description: "current page",
  panels: [{ id: "p1", order: 1, shot: "medium", angle: "eye", description: "original", caption_en: "", character_ids: [], figures: [], shape: { type: "rect", x: 40, y: 50, w: 600, h: 400 } }],
  texts: [{ id: "t1", panel_id: "p1", kind: "dialogue", speaker_id: null, direction: "vertical", bubble: "speech", text: "current text", bbox: { type: "rect", x: 80, y: 90, w: 80, h: 160 } }]
};
const input = { ...clone(page), id: "../../outside", page_id: "external-alias", description: "imported page",
  custom_metadata: { origin: "keep", nested: [1, 2, 3] }, production: { renders: [{ seed: "8925744111054236951", custom_note: "metadata only" }] } };
input.panels[0].shape.x = 40.123456789;
input.panels[0].custom_panel_field = { retain: true };
input.texts[0].custom_text_field = ["keep"];

function response(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
function background(url) {
  if (String(url).endsWith("sketch-geometry")) return response({ canvas: [800, 1000], panels: [] });
  if (String(url).endsWith("renders")) return response({ renders: [], metadata: [], selected_render: null });
  throw new Error(String(url));
}
function reset() {
  clearTimeout(useEditorStore.getState().autoSaveTimer);
  useEditorStore.setState({ activePageId: "current", sodaPage: clone(page), currentVersion: "v-current", editRevision: 0, savePromise: null, isSaving: false,
    hasUnsavedChanges: false, dirtyPanelIds: new Set(), dirtyBubbleIds: new Set(), autoSaveTimer: null,
    project: { id: "test", name: "test", activePageId: "current", pages: [sodaPageToProjectPage(clone(page))] },
    pages: [{ id: "current", description: "current page", panel_count: 1, version: "v-current" }], characters: [], sketchGeometry: null,
    historyPast: [], historyFuture: [], historyGroup: null, canUndo: false, canRedo: false, conflictModal: null, importModalOpen: false });
}
function stopTimer() { clearTimeout(useEditorStore.getState().autoSaveTimer); }
beforeEach(() => { globalThis.window = { history: { replaceState() {} } }; reset(); });
afterEach(() => { stopTimer(); globalThis.fetch = originalFetch; });

test("Import modal actions expose one shared visible state", () => {
  useEditorStore.getState().openImportModal(); assert.equal(useEditorStore.getState().importModalOpen, true);
  useEditorStore.getState().closeImportModal(); assert.equal(useEditorStore.getState().importModalOpen, false);
});

for (const status of [409, 422]) {
  test(`Import stops without POST when the current dirty page cannot save (${status})`, async () => {
    const methods = [];
    globalThis.fetch = async (url, options) => {
      methods.push(options?.method);
      return response({ error: "save blocked", current: page, version: "external", errors: [{ message: "invalid" }] }, status);
    };
    useEditorStore.getState().updateSodaText("t1", { text: "keep my unsaved text" }); stopTimer();
    await assert.rejects(useEditorStore.getState().importPageAsNew(input), /当前页尚未保存/);
    assert.deepEqual(methods, ["PUT"]);
    assert.equal(useEditorStore.getState().activePageId, "current");
    assert.equal(useEditorStore.getState().sodaPage.texts[0].text, "keep my unsaved text");
    assert.equal(useEditorStore.getState().hasUnsavedChanges, true);
    assert.equal(useEditorStore.getState().pages.length, 1);
  });
}

test("Import flushes the current page then atomically POSTs one fresh safe page without mutating the input", async () => {
  const requests = [], createdPages = new Map();
  const source = clone(input);
  globalThis.fetch = async (url, options) => {
    requests.push({ url, method: options?.method || "GET" });
    if (options?.method === "PUT") return response({ page: JSON.parse(options.body), version: "v-saved" });
    if (options?.method === "POST") {
      assert.equal(url, "/api/pages");
      const imported = JSON.parse(options.body); createdPages.set(imported.id, imported);
      return response({ page: imported, version: `v-${imported.id}` }, 201);
    }
    if (url === "/api/pages") return response({ pages: [...useEditorStore.getState().pages, ...Array.from(createdPages.values(), item => ({ id: item.id, panel_count: item.panels.length, version: `v-${item.id}` }))] });
    const id = String(url).split("/")[3];
    if (createdPages.has(id) && String(url) === `/api/pages/${id}`) return response({ page: createdPages.get(id), version: `v-${id}` });
    return background(url);
  };
  useEditorStore.getState().updateSodaText("t1", { text: "save before importing" }); stopTimer();
  const result = await useEditorStore.getState().importPageAsNew(input);
  assert.match(result.id, /^import_[a-f0-9]{12}$/);
  assert.equal(result.selected, true);
  assert.equal(useEditorStore.getState().activePageId, result.id);
  assert.deepEqual(input, source, "external JSON is never changed in place");
  const created = createdPages.get(result.id);
  assert.equal(created.page_id, undefined);
  const expected = { ...source, id: result.id }; delete expected.page_id;
  assert.deepEqual(created, expected);
  assert.equal(created.panels[0].shape.x, 40.123456789);
  assert.equal(created.production.renders[0].seed, "8925744111054236951");
  assert.deepEqual(requests.filter(request => ["PUT", "POST"].includes(request.method)), [
    { url: "/api/pages/current", method: "PUT" }, { url: "/api/pages", method: "POST" }
  ]);
  const second = await useEditorStore.getState().importPageAsNew(input);
  assert.notEqual(second.id, result.id, "importing the same source again cannot overwrite an existing page");
  assert.equal(createdPages.size, 2);
});

test("A schema rejection keeps the current page and exposes the original detailed API issues", async () => {
  const original = clone(useEditorStore.getState().sodaPage), methods = [];
  const issues = [{ code: "panel_out_of_bounds", message: "格 p1 超出画布范围", field: "shape" }];
  globalThis.fetch = async (url, options) => { methods.push(options?.method); return response({ error: "页面校验失败", errors: issues, warnings: [] }, 422); };
  await assert.rejects(useEditorStore.getState().importPageAsNew(input), error => error instanceof ApiError && error.status === 422 && JSON.stringify(error.data.errors) === JSON.stringify(issues));
  assert.deepEqual(methods, ["POST"]);
  assert.deepEqual(useEditorStore.getState().sodaPage, original);
  assert.equal(useEditorStore.getState().pages.length, 1);
  assert.match(useEditorStore.getState().notice, /超出画布范围/);
});

test("A delayed import never replaces edits started in the current page", async () => {
  let release, created, requestedImportedPage = false;
  globalThis.fetch = async (url, options) => {
    if (options?.method === "POST") { created = JSON.parse(options.body); return await new Promise(resolve => { release = () => resolve(response({ page: created, version: "new-v" }, 201)); }); }
    if (url === "/api/pages") return response({ pages: [...useEditorStore.getState().pages, { id: created.id, version: "new-v" }] });
    requestedImportedPage = true; throw new Error(String(url));
  };
  const importing = useEditorStore.getState().importPageAsNew(input);
  useEditorStore.getState().updateSodaText("t1", { text: "typed during import" }); stopTimer();
  release(); const result = await importing;
  assert.equal(result.selected, false);
  assert.equal(requestedImportedPage, false);
  assert.equal(useEditorStore.getState().activePageId, "current");
  assert.equal(useEditorStore.getState().sodaPage.texts[0].text, "typed during import");
  assert.equal(useEditorStore.getState().hasUnsavedChanges, true);
  assert.ok(useEditorStore.getState().pages.some(item => item.id === result.id));
  assert.match(useEditorStore.getState().notice, /已导入新页/);
});

test("A delayed import never reverses a user page switch", async () => {
  let release, created;
  globalThis.fetch = async (url, options) => {
    if (options?.method === "POST") { created = JSON.parse(options.body); return await new Promise(resolve => { release = () => resolve(response({ page: created, version: "new-v" }, 201)); }); }
    if (url === "/api/pages/other") return response({ page: { ...clone(page), id: "other" }, version: "other-v" });
    if (url === "/api/pages") return response({ pages: [{ id: "current" }, { id: "other" }, { id: created.id }] });
    return background(url);
  };
  const importing = useEditorStore.getState().importPageAsNew(input);
  await useEditorStore.getState().selectPage("other");
  release(); const result = await importing;
  assert.equal(result.selected, false);
  assert.equal(useEditorStore.getState().activePageId, "other");
  assert.equal(useEditorStore.getState().sodaPage.id, "other");
  assert.ok(useEditorStore.getState().pages.some(item => item.id === result.id));
});

test("A created page stays visible when refreshing the list fails and is not reported as a failed import", async () => {
  let created;
  globalThis.fetch = async (url, options) => {
    if (options?.method === "POST") { created = JSON.parse(options.body); return response({ page: created, version: "new-v" }, 201); }
    throw new Error("list offline");
  };
  const result = await useEditorStore.getState().importPageAsNew(input);
  assert.deepEqual(result, { id: created.id, selected: false });
  assert.equal(useEditorStore.getState().activePageId, "current");
  assert.ok(useEditorStore.getState().pages.some(item => item.id === created.id));
  assert.match(useEditorStore.getState().notice, /勿重复导入/);
});

test("A created page stays listed after its initial load fails", async t => {
  t.mock.method(console, "error", () => {});
  let created;
  globalThis.fetch = async (url, options) => {
    if (options?.method === "POST") { created = JSON.parse(options.body); return response({ page: created, version: "new-v" }, 201); }
    if (url === "/api/pages") return response({ pages: [...useEditorStore.getState().pages, { id: created.id, version: "new-v" }] });
    return response({ error: "temporary load failure" }, 500);
  };
  const result = await useEditorStore.getState().importPageAsNew(input);
  assert.deepEqual(result, { id: created.id, selected: false });
  assert.ok(useEditorStore.getState().pages.some(item => item.id === created.id));
  assert.equal(useEditorStore.getState().activePageId, "current");
  assert.match(useEditorStore.getState().notice, /勿重复导入/);
});

test("Editing while the imported page GET is pending keeps the new file but cancels automatic navigation", async () => {
  let created, release;
  globalThis.fetch = async (url, options) => {
    if (options?.method === "POST") { created = JSON.parse(options.body); return response({ page: created, version: "new-v" }, 201); }
    if (url === "/api/pages") return response({ pages: [...useEditorStore.getState().pages, { id: created.id, version: "new-v" }] });
    return await new Promise(resolve => { release = () => resolve(response({ page: created, version: "new-v" })); });
  };
  const importing = useEditorStore.getState().importPageAsNew(input);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof release, "function");
  useEditorStore.getState().updateSodaText("t1", { text: "edit during imported page load" }); stopTimer();
  release();
  const result = await importing;
  assert.equal(result.selected, false);
  assert.equal(useEditorStore.getState().activePageId, "current");
  assert.equal(useEditorStore.getState().sodaPage.texts[0].text, "edit during imported page load");
  assert.equal(useEditorStore.getState().hasUnsavedChanges, true);
  assert.ok(useEditorStore.getState().pages.some(item => item.id === created.id));
});

test("An empty project can import its first page without trying to save a nonexistent current page", async () => {
  useEditorStore.setState({ activePageId: "", sodaPage: null, pages: [], project: { id: "empty", name: "empty", activePageId: "", pages: [] } });
  const methods = []; let created;
  globalThis.fetch = async (url, options) => {
    methods.push(options?.method || "GET");
    if (options?.method === "POST") { created = JSON.parse(options.body); return response({ page: created, version: "new-v" }, 201); }
    if (url === "/api/pages") return response({ pages: [{ id: created.id, version: "new-v" }] });
    if (url === `/api/pages/${created.id}`) return response({ page: created, version: "new-v" });
    return background(url);
  };
  const result = await useEditorStore.getState().importPageAsNew(input);
  assert.equal(result.selected, true);
  assert.equal(useEditorStore.getState().activePageId, created.id);
  assert.equal(methods.includes("PUT"), false);
  assert.equal(methods.filter(method => method === "POST").length, 1);
});
