import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { useEditorStore } from "../src/lib/store.ts";
import { projectPageToSodaPage, sodaPageToProjectPage } from "../src/lib/project.ts";

const originalFetch = globalThis.fetch;
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const base = {
  id: "page-a", canvas_width: 800, canvas_height: 1000, reading_direction: "rtl", panel_gap: 20,
  panels: [{ id: "p1", order: 1, shot: "medium", angle: "eye", description: "original", caption_en: "", character_ids: ["girl"],
    figures: [{ id: "figure-one", character_id: "girl", pose: "lie", position: 0.5, facing: "left", editor: {
      version: 1, x: 250, y: 200, size: 160, view: "side", flip: true, style: "box", break_frame: true, joints: { rHand: [39.5, 2.25] }
    } }], shape: { type: "rect", x: 30, y: 40, w: 600, h: 400 } }],
  texts: [{ id: "t1", kind: "dialogue", panel_id: "p1", speaker_id: null, text: "old text", bubble: "speech", direction: "horizontal", bbox: { type: "rect", x: 70, y: 80, w: 200, h: 80 } }]
};
function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
function reset(page = base) {
  clearTimeout(useEditorStore.getState().autoSaveTimer);
  useEditorStore.setState({
    sodaPage: clone(page), activePageId: page.id, currentVersion: "v1", savePromise: null, editRevision: 0,
    project: { id: "test", name: "test", activePageId: page.id, pages: [sodaPageToProjectPage(clone(page))] },
    pages: [{ id: "page-a", version: "v1" }, { id: "page-b", version: "version-b" }],
    hasUnsavedChanges: false, isSaving: false, dirtyPanelIds: new Set(), dirtyBubbleIds: new Set(),
    historyPast: [], historyFuture: [], historyGroup: null, canUndo: false, canRedo: false,
    selection: null, sketchGeometry: null, characters: [], conflictModal: null,
    previewModal: { open: false, url: null }, compileModal: null,
    generateModal: { open: true, loading: false, seeds: 1, preset: "draft" },
    layoutModal: { open: false, loading: false, candidates: [] }, renders: null, selectedRenderUrl: null
  });
}
function stopTimer() { clearTimeout(useEditorStore.getState().autoSaveTimer); }
function geometry(pageId) { return { canvas: [800, 1000], panels: [], marker: pageId }; }
function renders(pageId) { return { renders: [{ path: `${pageId}.png`, url: `/${pageId}.png` }], selected_render: `${pageId}.png`, metadata: [] }; }
function background(url) {
  if (String(url).endsWith("sketch-geometry")) return response(geometry("saved"));
  if (String(url).endsWith("/renders")) return response(renders("saved"));
  throw new Error(`Unexpected request: ${url}`);
}
beforeEach(() => {
  globalThis.window = { history: { replaceState() {} } };
  reset();
});
afterEach(() => { stopTimer(); globalThis.fetch = originalFetch; });

test("A save drains edits made during its PUT, including an autosave timer firing while busy", async () => {
  const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map(); let timerId = 0;
  globalThis.setTimeout = callback => { const id = ++timerId; timers.set(id, callback); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  const puts = [], releases = [];
  globalThis.fetch = (url, options) => {
    if (options?.method === "PUT") {
      const page = JSON.parse(options.body); puts.push({ page, version: new Headers(options.headers).get("If-Match") });
      return new Promise(resolve => releases.push(() => resolve(response({ page, version: `v${puts.length + 1}` }))));
    }
    return Promise.resolve(background(url));
  };
  try {
    useEditorStore.getState().updatePanel("p1", { x: 50 });
    const saving = useEditorStore.getState().saveCurrentPage();
    useEditorStore.getState().updatePanel("p1", { x: 180 });
    const timer = timers.get(useEditorStore.getState().autoSaveTimer); timer();
    assert.equal(useEditorStore.getState().saveCurrentPage(), saving);
    assert.equal(puts.length, 1);
    releases[0](); await tick();
    assert.equal(puts.length, 2);
    assert.equal(puts[1].page.panels[0].shape.x, 180);
    assert.equal(puts[1].version, "v2");
    assert.equal(useEditorStore.getState().hasUnsavedChanges, true);
    assert.equal(useEditorStore.getState().dirtyPanelIds.has("p1"), true);
    assert.equal(useEditorStore.getState().project.pages[0].panels[0].x, 180);
    assert.deepEqual(puts[1].page.panels[0].figures, base.panels[0].figures);
    releases[1]();
    assert.equal(await saving, true);
    assert.equal(useEditorStore.getState().sodaPage.panels[0].shape.x, 180);
    assert.equal(useEditorStore.getState().hasUnsavedChanges, false);
    assert.equal(useEditorStore.getState().dirtyPanelIds.size, 0);
    assert.equal(useEditorStore.getState().savePromise, null);
    assert.equal(useEditorStore.getState().isSaving, false);
  } finally {
    globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout;
  }
});

test("Failed PUT keeps newer edits dirty and conflict backup includes those latest edits", async () => {
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = () => resolve(response({ error: "conflict", current: base, version: "external-v" }, 409)); });
  useEditorStore.getState().updatePanel("p1", { x: 50 }); stopTimer();
  const saving = useEditorStore.getState().saveCurrentPage();
  useEditorStore.getState().updatePanel("p1", { x: 180 }); stopTimer();
  release();
  assert.equal(await saving, false);
  assert.equal(useEditorStore.getState().hasUnsavedChanges, true);
  assert.equal(useEditorStore.getState().dirtyPanelIds.has("p1"), true);
  assert.equal(JSON.parse(useEditorStore.getState().conflictModal.localBackup).panels[0].shape.x, 180);
  assert.equal(useEditorStore.getState().savePromise, null);
});

test("A successful save rebuilds every editor model from the returned committed page", async () => {
  const puts = [];
  globalThis.fetch = async (url, options) => {
    if (options?.method === "PUT") {
      const page = JSON.parse(options.body);
      puts.push({ page, version: new Headers(options.headers).get("If-Match") });
      if (puts.length === 1) {
        page.panels[0].description = "committed canonical description";
        page.panels[0].shape.x = 135;
        page.texts[0].text = "committed canonical text";
      }
      return response({ page, version: `v${puts.length + 1}` });
    }
    return background(url);
  };
  useEditorStore.getState().updateSodaPanel("p1", { description: "local description" }); stopTimer();
  assert.equal(await useEditorStore.getState().saveCurrentPage(), true);
  const state = useEditorStore.getState();
  assert.equal(state.currentVersion, "v2");
  assert.equal(state.sodaPage.panels[0].description, "committed canonical description");
  assert.equal(state.project.pages[0].panels[0].sodaData.description, "committed canonical description");
  assert.equal(state.project.pages[0].panels[0].x, 135);
  assert.equal(state.project.pages[0].bubbles[0].text, "committed canonical text");
  useEditorStore.getState().updateSodaText("t1", { text: "next local text" }); stopTimer();
  assert.equal(await useEditorStore.getState().saveCurrentPage(), true);
  assert.equal(puts[1].version, "v2");
  assert.equal(puts[1].page.panels[0].description, "committed canonical description");
  assert.equal(puts[1].page.panels[0].shape.x, 135);
  assert.equal(puts[1].page.texts[0].text, "next local text");
});

test("A successful HTTP response without a committed version cannot mark a draft saved", async () => {
  globalThis.fetch = async (_url, options) => response({ page: JSON.parse(options.body) });
  useEditorStore.getState().updateSodaText("t1", { text: "keep unsaved draft" }); stopTimer();
  assert.equal(await useEditorStore.getState().saveCurrentPage(), false);
  assert.equal(useEditorStore.getState().currentVersion, "v1");
  assert.equal(useEditorStore.getState().hasUnsavedChanges, true);
  assert.equal(useEditorStore.getState().sodaPage.texts[0].text, "keep unsaved draft");
});

const operations = {
  preview: () => useEditorStore.getState().openPreviewModal(),
  compile: () => useEditorStore.getState().openCompileModal(),
  generate: () => useEditorStore.getState().submitGenerate({ seeds: 1, preset: "draft" }),
  layout: () => useEditorStore.getState().openLayoutModal()
};
for (const [name, operation] of Object.entries(operations)) {
  test(`${name} waits for latest saved text before consuming the page`, async () => {
    const requests = []; let release; let disk;
    globalThis.fetch = async (url, options) => {
      if (options?.method === "PUT") {
        disk = JSON.parse(options.body); requests.push("PUT");
        return await new Promise(resolve => { release = () => resolve(response({ page: disk, version: "v2" })); });
      }
      if (String(url).endsWith("sketch-geometry")) return response(geometry("saved"));
      requests.push(String(url).split("/").at(-1));
      if (String(url).endsWith("/compile")) return response({ moss: { text: disk.texts[0].text }, path: "compiled.json", paths: [] });
      if (String(url).endsWith("/generate")) return response({ id: "fake-job", status: "queued" });
      if (String(url).includes("/layout-suggest")) return response({ candidates: [], version: "v2" });
      throw new Error(String(url));
    };
    useEditorStore.getState().updateSodaText("t1", { text: "new latest text" }); stopTimer();
    const pending = operation();
    assert.deepEqual(requests, ["PUT"]);
    assert.equal(useEditorStore.getState().previewModal.open, false);
    release(); await pending;
    assert.equal(disk.texts[0].text, "new latest text");
    assert.equal(useEditorStore.getState().hasUnsavedChanges, false);
    if (name === "preview") assert.ok(useEditorStore.getState().previewModal.url.endsWith("v=v2"));
    else assert.equal(requests.length, 2);
  });
  for (const status of [409, 422]) {
    test(`${name} stops when save returns ${status}`, async () => {
      const requests = [];
      globalThis.fetch = async (url, options) => {
        requests.push({ url, method: options?.method });
        return response({ error: "cannot save", current: base, version: "external-v", errors: [{ message: "invalid" }] }, status);
      };
      useEditorStore.getState().updateSodaText("t1", { text: "invalid unsaved text" }); stopTimer();
      await operation();
      assert.equal(requests.length, 1);
      assert.equal(requests[0].method, "PUT");
      assert.equal(useEditorStore.getState().hasUnsavedChanges, true);
      assert.equal(useEditorStore.getState().previewModal.open, false);
      if (name === "compile") {
        const modal = useEditorStore.getState().compileModal;
        assert.equal(modal.open, true);
        assert.equal(modal.loading, false);
        assert.equal(modal.moss, null);
        assert.ok(modal.error, "failed saves keep an actionable compile error");
      } else assert.equal(useEditorStore.getState().compileModal, null);
      assert.equal(useEditorStore.getState().generateModal.loading, false);
      assert.equal(useEditorStore.getState().layoutModal.open, false);
    });
  }
}

test("Deleting another page fetches its own version instead of sending the active page version", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, method: options?.method || "GET", version: new Headers(options?.headers).get("If-Match") });
    if (url === "/api/pages/page-b" && !options?.method) return response({ page: { ...base, id: "page-b" }, version: "fresh-b" });
    if (options?.method === "DELETE") return response({});
    if (url === "/api/pages") return response({ pages: [{ id: "page-a", version: "v1" }] });
    throw new Error(String(url));
  };
  await useEditorStore.getState().deletePage("page-b");
  assert.equal(requests.find(request => request.method === "DELETE").version, "fresh-b");
  assert.equal(useEditorStore.getState().activePageId, "page-a");
});

test("Deleting the dirty active page first saves into its trash snapshot and switches without resaving the deleted file", async () => {
  const calls = []; let trash;
  const other = { ...clone(base), id: "page-b" };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options?.method || "GET" });
    if (options?.method === "PUT") { trash = JSON.parse(options.body); return response({ page: trash, version: "v2" }); }
    if (options?.method === "DELETE") { assert.equal(new Headers(options.headers).get("If-Match"), "v2"); return response({}); }
    if (url === "/api/pages") return response({ pages: [{ id: "page-b", version: "version-b" }] });
    if (url === "/api/pages/page-b") return response({ page: other, version: "version-b" });
    return background(url);
  };
  useEditorStore.getState().updateSodaText("t1", { text: "keep this in trash" }); stopTimer();
  await useEditorStore.getState().deletePage("page-a"); await tick();
  assert.equal(trash.texts[0].text, "keep this in trash");
  assert.deepEqual(calls.filter(call => ["PUT", "DELETE"].includes(call.method)).map(call => call.method), ["PUT", "DELETE"]);
  assert.equal(useEditorStore.getState().activePageId, "page-b");
  assert.equal(useEditorStore.getState().hasUnsavedChanges, false);
});

test("Applying a saved layout is one undo step and keeps all figure metadata", async () => {
  const applied = clone(base); applied.panels[0].shape.x = 150;
  globalThis.fetch = async (url, options) => {
    if (options?.method === "PUT") return response({ page: JSON.parse(options.body), version: "v1" });
    if (String(url).endsWith("layout-apply")) return response({ page: applied, version: "v2" });
    return background(url);
  };
  await useEditorStore.getState().applyLayoutCandidate("candidate");
  assert.equal(useEditorStore.getState().project.pages[0].panels[0].x, 150);
  assert.equal(useEditorStore.getState().historyPast.length, 1);
  useEditorStore.getState().undo(); stopTimer();
  assert.equal(useEditorStore.getState().project.pages[0].panels[0].x, 30);
  useEditorStore.getState().redo(); stopTimer();
  const current = useEditorStore.getState();
  assert.equal(current.project.pages[0].panels[0].x, 150);
  assert.deepEqual(projectPageToSodaPage(current.project.pages[0], current.sodaPage, current.dirtyPanelIds, current.dirtyBubbleIds).panels[0].figures, base.panels[0].figures);
});

test("Fast page switching ignores earlier page and background responses", async () => {
  const releases = new Map();
  globalThis.fetch = (url) => new Promise(resolve => releases.set(String(url), data => resolve(response(data))));
  const first = useEditorStore.getState().selectPage("page-b");
  const second = useEditorStore.getState().selectPage("page-c");
  releases.get("/api/pages/page-c")({ page: { ...clone(base), id: "page-c" }, version: "vc" }); await second;
  releases.get("/api/pages/page-b")({ page: { ...clone(base), id: "page-b" }, version: "vb" }); await first;
  assert.equal(useEditorStore.getState().activePageId, "page-c");
  const third = useEditorStore.getState().selectPage("page-d");
  releases.get("/api/pages/page-d")({ page: { ...clone(base), id: "page-d" }, version: "vd" }); await third;
  releases.get("/api/pages/page-d/sketch-geometry")(geometry("page-d"));
  releases.get("/api/pages/page-d/renders")(renders("page-d")); await tick();
  releases.get("/api/pages/page-c/sketch-geometry")(geometry("page-c"));
  releases.get("/api/pages/page-c/renders")(renders("page-c")); await tick();
  assert.equal(useEditorStore.getState().sketchGeometry.marker, "page-d");
  assert.equal(useEditorStore.getState().selectedRenderUrl, "/page-d.png");
});

test("A reload response cannot erase edits started after its GET", async () => {
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = () => resolve(response({ page: clone(base), version: "external" })); });
  const reload = useEditorStore.getState().reloadCurrentPage();
  useEditorStore.getState().updateSodaText("t1", { text: "typed while loading" }); stopTimer();
  release(); await reload;
  assert.equal(useEditorStore.getState().sodaPage.texts[0].text, "typed while loading");
  assert.equal(useEditorStore.getState().hasUnsavedChanges, true);
});

test("A failed network save can be retried without losing its dirty geometry", async () => {
  globalThis.fetch = async () => { throw new Error("offline"); };
  useEditorStore.getState().updatePanel("p1", { x: 210 }); stopTimer();
  assert.equal(await useEditorStore.getState().saveCurrentPage(), false);
  assert.equal(useEditorStore.getState().hasUnsavedChanges, true);
  let saved;
  globalThis.fetch = async (url, options) => {
    if (options?.method === "PUT") { saved = JSON.parse(options.body); return response({ page: saved, version: "v2" }); }
    return background(url);
  };
  assert.equal(await useEditorStore.getState().saveCurrentPage(), true);
  assert.equal(saved.panels[0].shape.x, 210);
  assert.equal(useEditorStore.getState().hasUnsavedChanges, false);
});

test("Sketch geometry fetched by a save cannot overwrite subsequent local edits", async () => {
  let release;
  globalThis.fetch = async (url, options) => {
    if (options?.method === "PUT") return response({ page: JSON.parse(options.body), version: "v2" });
    if (String(url).endsWith("sketch-geometry")) return await new Promise(resolve => { release = () => resolve(response(geometry("old-server"))); });
    throw new Error(String(url));
  };
  await useEditorStore.getState().saveCurrentPage();
  useEditorStore.getState().updateSodaPanel("p1", { description: "new local edit" }); stopTimer();
  const localGeometry = useEditorStore.getState().sketchGeometry;
  release(); await tick();
  assert.equal(useEditorStore.getState().sketchGeometry, localGeometry);
  assert.equal(useEditorStore.getState().hasUnsavedChanges, true);
});

test("A pending page switch keeps new edits made in the still-visible current page", async () => {
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = () => resolve(response({ page: { ...clone(base), id: "page-b" }, version: "vb" })); });
  const switching = useEditorStore.getState().selectPage("page-b");
  useEditorStore.getState().updateSodaText("t1", { text: "edit before navigation completed" }); stopTimer();
  release(); await switching;
  assert.equal(useEditorStore.getState().activePageId, "page-a");
  assert.equal(useEditorStore.getState().sodaPage.texts[0].text, "edit before navigation completed");
  assert.equal(useEditorStore.getState().hasUnsavedChanges, true);
});

test("A stale reload cannot replace the version established by a newer save", async () => {
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = () => resolve(response({ page: clone(base), version: "v1" })); });
  const reload = useEditorStore.getState().reloadCurrentPage();
  useEditorStore.setState({ currentVersion: "v2" });
  release(); await reload;
  assert.equal(useEditorStore.getState().currentVersion, "v2");
});

test("Applying a clean layout candidate does not PUT again and invalidate its saved ETag", async () => {
  let serverVersion = "etag-initial", candidateVersion;
  const applied = clone(base); applied.panels[0].shape.x = 150;
  const methods = [];
  globalThis.fetch = async (url, options) => {
    if (options?.method === "PUT") {
      methods.push("PUT"); serverVersion += "-replaced";
      return response({ page: JSON.parse(options.body), version: serverVersion });
    }
    if (String(url).includes("/layout-suggest")) {
      candidateVersion = serverVersion;
      return response({ candidates: [{ candidate_id: "candidate" }], version: candidateVersion });
    }
    if (String(url).endsWith("/layout-apply")) {
      methods.push("APPLY");
      const match = new Headers(options.headers).get("If-Match");
      if (match !== candidateVersion || match !== serverVersion) return response({ error: "候选基于旧页面" }, 409);
      serverVersion += "-applied";
      return response({ page: applied, version: serverVersion });
    }
    return background(url);
  };
  await useEditorStore.getState().openLayoutModal();
  assert.equal(useEditorStore.getState().currentVersion, candidateVersion);
  await useEditorStore.getState().applyLayoutCandidate("candidate");
  assert.deepEqual(methods, ["PUT", "APPLY"]);
  assert.equal(useEditorStore.getState().project.pages[0].panels[0].x, 150);
  assert.equal(useEditorStore.getState().canUndo, true);
  assert.equal(useEditorStore.getState().notice, "已应用版式候选");
});
