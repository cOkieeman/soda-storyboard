import assert from "node:assert/strict";
import test from "node:test";
import { useEditorStore } from "../src/lib/store.ts";
import { useCharacterDraftStore } from "../src/lib/characterDrafts.ts";
import { acceptIdentityResult, prepareIdentity, applyIdentity, undoIdentity, useIdentityState } from "../src/lib/characterIdentity.ts";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function setup(t) {
  const editor = useEditorStore.getState(), drafts = useCharacterDraftStore.getState(), identity = useIdentityState.getState(), fetch = globalThis.fetch;
  t.after(() => { useEditorStore.setState(editor, true); useCharacterDraftStore.setState(drafts, true); useIdentityState.setState(identity, true); globalThis.fetch = fetch; });
  useEditorStore.setState({ hasUnsavedChanges: false, savePromise: null, reloadCurrentPage: async () => true, refreshCharacters: async () => {}, historyPast: [{}], historyFuture: [{}], canUndo: true, canRedo: true, clipboard: { old: true } });
  useCharacterDraftStore.setState({ drafts: {}, target: { kind: "canvas" } });
  useIdentityState.setState({ busy: false, error: "", last: null });
  globalThis.fetch = async () => json({ operations: [] });
}

test("preview waits for the whole page save drain and retains the opened character ETag", async t => {
  setup(t); let release, requested = false;
  useEditorStore.setState({ hasUnsavedChanges: true, saveCurrentPage: async () => { await new Promise(resolve => { release = resolve; }); useEditorStore.setState({ hasUnsavedChanges: false }); return true; } });
  globalThis.fetch = async (url, options) => { requested = true; assert.equal(options.headers.get("If-Match"), '"opened"'); assert.match(url, /girl\/plan$/); return json({ plan_id: "plan" }); };
  const result = prepareIdentity("girl", '"opened"', { action: "rename_id", new_id: "other" });
  await Promise.resolve(); assert.equal(requested, false); release();
  assert.equal((await result).plan_id, "plan");
});

test("a page conflict prevents preview and keeps drafts and history", async t => {
  setup(t); let requests = 0;
  useEditorStore.setState({ hasUnsavedChanges: true, saveCurrentPage: async () => false });
  globalThis.fetch = async () => { requests++; return json({}); };
  await assert.rejects(prepareIdentity("girl", '"v"', { action: "delete" }), /当前页未能保存/);
  assert.equal(requests, 0); assert.equal(useEditorStore.getState().historyPast.length, 1);
});

test("HTTP and SSE echoes share one refresh, clear stale page history, and preserve dirty role drafts", async t => {
  setup(t); let reloads = 0, release;
  useEditorStore.setState({ reloadCurrentPage: async () => { reloads++; await new Promise(resolve => { release = resolve; }); return true; } });
  const dirty = { dirty: true, saving: false, value: { id: "local" } };
  useCharacterDraftStore.setState({ drafts: { dirty, clean: { dirty: false, saving: false } } });
  const result = { operation_id: "echo-unit", affected_files: ["pages/p.json"], action: "delete" };
  const first = acceptIdentityResult(result), echo = acceptIdentityResult(result);
  assert.equal(first, echo); release(); await first;
  assert.equal(reloads, 1); assert.equal(useEditorStore.getState().canUndo, false); assert.equal(useEditorStore.getState().clipboard, null);
  assert.deepEqual(useCharacterDraftStore.getState().drafts, { dirty });
});

test("commit conflicts retain the exact identity draft and never retry with a newer ETag", async t => {
  setup(t); let requests = 0;
  const draft = { dirty: true, value: { id: "girl", appearance: { zh: "local" } } };
  useCharacterDraftStore.setState({ drafts: { girl: draft }, target: { kind: "character", id: "girl" } });
  globalThis.fetch = async (_url, options) => { requests++; assert.equal(options.headers.get("If-Match"), '"opened"'); return json({ error: "引用文件已变化", reason: "reference_version_conflict" }, 409); };
  await assert.rejects(applyIdentity("girl", '"opened"', { plan_id: "stale" }), /引用文件已变化/);
  assert.equal(requests, 1); assert.deepEqual(useCharacterDraftStore.getState().drafts.girl, draft); assert.equal(useIdentityState.getState().busy, false);
});

test("undo conflicts are shown and do not clear local history or drafts", async t => {
  setup(t); useIdentityState.setState({ last: { operation_id: "op", version: '"journal"' } });
  globalThis.fetch = async (_url, options) => { assert.equal(options.headers.get("If-Match"), '"journal"'); return json({ error: "受影响文件已被修改" }, 409); };
  await undoIdentity();
  assert.match(useIdentityState.getState().error, /文件已被修改/); assert.equal(useEditorStore.getState().historyPast.length, 1);
});

test("an open identity dialog retains its original baseline across external changes", async t => {
  setup(t);
  const draft = { key: "girl", baseline: { id: "girl" }, value: { id: "girl" }, version: '"opened"', dirty: false, saving: false, identityEditing: true };
  useCharacterDraftStore.setState({ drafts: { girl: draft }, target: { kind: "character", id: "girl" } });
  await acceptIdentityResult({ operation_id: "external-dialog", action: "rename", affected_files: ["characters/girl.json"] });
  useCharacterDraftStore.getState().checkExternal({ girl: '"newer"' });
  assert.equal(useCharacterDraftStore.getState().drafts.girl.version, '"opened"');
  assert.equal(useCharacterDraftStore.getState().drafts.girl.identityEditing, true);
  assert.equal(useCharacterDraftStore.getState().drafts.girl.externalChanged, true);
});
