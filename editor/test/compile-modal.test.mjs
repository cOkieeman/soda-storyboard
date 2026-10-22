import assert from "node:assert/strict";
import test from "node:test";
import { useEditorStore } from "../src/lib/store.ts";

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const response = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" }
});
async function withStore(run) {
  const original = useEditorStore.getState();
  useEditorStore.setState({
    activePageId: "compile-qa", currentVersion: "v1", editRevision: 0,
    hasUnsavedChanges: false, saveError: null, compileModal: null,
    saveCurrentPage: async () => true
  });
  try { await run(useEditorStore.getState); }
  finally { useEditorStore.setState(original, true); }
}

test("Compile opens immediately and prevents duplicate submission and closing throughout save and compile", async t => withStore(async get => {
  const saved = deferred(), compiled = deferred(), compileStarted = deferred();
  let saveCalls = 0, compileCalls = 0;
  useEditorStore.setState({ saveCurrentPage: () => { saveCalls++; return saved.promise; } });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    compileCalls++;
    assert.equal(url, "/api/pages/compile-qa/compile");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { with_ids: true, slant_mode: "cut" });
    compileStarted.resolve();
    return compiled.promise;
  });

  const pending = get().openCompileModal();
  assert.equal(get().compileModal.open, true);
  assert.equal(get().compileModal.loading, true);
  assert.equal(get().compileModal.moss, null);
  assert.equal(await get().openCompileModal(), false);
  get().closeCompileModal();
  assert.equal(get().compileModal.loading, true);
  assert.equal(saveCalls, 1);
  assert.equal(compileCalls, 0);

  saved.resolve(true);
  await compileStarted.promise;
  assert.equal(await get().openCompileModal(), false);
  get().closeCompileModal();
  assert.equal(get().compileModal.loading, true);
  assert.equal(saveCalls, 1);
  assert.equal(compileCalls, 1);
  const result = { moss: { regions: ["a", "b"] }, path: "exports/page.json", paths: ["exports/page.json", "exports/page-2.json"] };
  compiled.resolve(response(result));
  assert.equal(await pending, true);
  assert.deepEqual(get().compileModal, { open: true, loading: false, ...result });
  get().closeCompileModal();
  assert.equal(get().compileModal, null);
}));

test("Save and compile failures retain a retryable dialog and successful retry clears errors", async t => withStore(async get => {
  let compileCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    compileCalls++;
    if (compileCalls === 1) return response({ error: "compiler unavailable" }, 503);
    return response({ moss: { regions: ["current"] }, path: "exports/current.json", paths: [] });
  });
  useEditorStore.setState({ saveError: "文件已被外部修改", saveCurrentPage: async () => false });
  assert.equal(await get().openCompileModal(), false);
  assert.equal(compileCalls, 0, "an unsaved page must never be compiled");
  assert.equal(get().compileModal.open, true);
  assert.equal(get().compileModal.loading, false);
  assert.equal(get().compileModal.error, "文件已被外部修改");
  assert.equal(get().compileModal.moss, null);

  useEditorStore.setState({ saveError: null, saveCurrentPage: async () => true });
  assert.equal(await get().openCompileModal(), false);
  assert.equal(get().compileModal.open, true);
  assert.equal(get().compileModal.loading, false);
  assert.match(get().compileModal.error, /compiler unavailable/);
  assert.equal(await get().openCompileModal(), true);
  assert.equal(compileCalls, 2);
  assert.equal(get().compileModal.error, undefined);
  assert.deepEqual(get().compileModal.moss, { regions: ["current"] });
  assert.deepEqual(get().compileModal.paths, ["exports/current.json"]);
}));

test("Late compilation cannot present stale results after edits, page switches, or another request", async t => {
  for (const change of ["edit", "page", "request"]) await t.test(change, async t => withStore(async get => {
    const compiled = deferred(), compileStarted = deferred();
    t.mock.method(globalThis, "fetch", async () => { compileStarted.resolve(); return compiled.promise; });
    const pending = get().openCompileModal();
    await compileStarted.promise;
    const replacement = { open: true, loading: true, moss: null, path: "", paths: [] };
    if (change === "edit") useEditorStore.setState({ editRevision: 1, hasUnsavedChanges: true });
    else if (change === "page") useEditorStore.setState({ activePageId: "another-page" });
    else useEditorStore.setState({ compileModal: replacement });
    compiled.resolve(response({ moss: { stale: true }, path: "exports/stale.json", paths: ["exports/stale.json"] }));
    assert.equal(await pending, false);
    if (change === "edit") {
      assert.equal(get().compileModal.loading, false);
      assert.equal(get().compileModal.moss, null);
      assert.match(get().compileModal.error, /分镜已变化/);
    } else if (change === "page") assert.equal(get().compileModal, null);
    else assert.equal(get().compileModal, replacement);
  }));
});
