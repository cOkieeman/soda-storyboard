import assert from "node:assert/strict";
import test from "node:test";
import { clearRecoveryDraft, readRecoveryDraft, writeRecoveryDraft } from "../src/lib/recovery.ts";

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}
function draft(text, savedAt = 1) {
  return { format: "soda-editor-recovery-v1", projectIdentity: "directory:e:/recovery-tabs", pageId: "page-1",
    baseVersion: "v1", savedAt, page: { id: "page-1", panels: [], texts: [{ id: "t1", text }] } };
}

test("Saving one tab cannot delete or overwrite another tab's recovery draft", () => {
  const storage = memoryStorage(), a = draft("tab A", 2), b = draft("tab B", 1);
  writeRecoveryDraft(b, null, storage, "client-b");
  writeRecoveryDraft(a, null, storage, "client-a");
  assert.equal(readRecoveryDraft(b.projectIdentity, b.pageId, storage, "client-b").page.texts[0].text, "tab B");
  clearRecoveryDraft(a.projectIdentity, a.pageId, false, storage, "client-a");
  assert.equal(readRecoveryDraft(b.projectIdentity, b.pageId, storage, "client-b").page.texts[0].text, "tab B");
});

test("Discarding or restoring one tab only clears its own pending and current recovery records", () => {
  const storage = memoryStorage(), a = draft("tab A", 4), b = draft("tab B", 3), pending = draft("older tab B", 1);
  writeRecoveryDraft(b, pending, storage, "client-b");
  writeRecoveryDraft(a, null, storage, "client-a");
  clearRecoveryDraft(a.projectIdentity, a.pageId, true, storage, "client-a");
  assert.equal(readRecoveryDraft(b.projectIdentity, b.pageId, storage, "client-b").page.texts[0].text, "older tab B");
  clearRecoveryDraft(b.projectIdentity, b.pageId, false, storage, "client-b");
  assert.equal(readRecoveryDraft(b.projectIdentity, b.pageId, storage, "client-b").page.texts[0].text, "older tab B");
});

test("A refreshed or duplicated tab can discover durable drafts without taking ownership of another tab's keys", () => {
  const storage = memoryStorage(), b = draft("survives refresh", 3);
  writeRecoveryDraft(b, null, storage, "old-runtime");
  assert.equal(readRecoveryDraft(b.projectIdentity, b.pageId, storage, "fresh-runtime").page.texts[0].text, "survives refresh");
  const copied = draft("duplicated tab edits", 4);
  writeRecoveryDraft(copied, b, storage, "duplicated-runtime");
  clearRecoveryDraft(b.projectIdentity, b.pageId, true, storage, "duplicated-runtime");
  assert.equal(readRecoveryDraft(b.projectIdentity, b.pageId, storage, "old-runtime").page.texts[0].text, "survives refresh");
});

test("Legacy shared recovery keys remain readable and are never removed by a tab's save", () => {
  const storage = memoryStorage(), old = draft("legacy recovery", 2);
  const prefix = `soda-editor-v1:${encodeURIComponent(old.projectIdentity)}:${old.pageId}:`;
  storage.setItem(prefix + "draft", JSON.stringify(old));
  storage.setItem(prefix + "draft:invalid", "not JSON");
  storage.setItem(prefix + "draft:wrong-page", JSON.stringify({ ...old, pageId: "other-page" }));
  clearRecoveryDraft(old.projectIdentity, old.pageId, true, storage, "new-runtime");
  assert.equal(readRecoveryDraft(old.projectIdentity, old.pageId, storage, "new-runtime").page.texts[0].text, "legacy recovery");
  assert.equal(storage.getItem(prefix + "draft"), JSON.stringify(old));
});

test("Independent document runtimes stay isolated even when duplicated tabs have identical sessionStorage", async () => {
  const originalWindow = globalThis.window, storage = memoryStorage();
  globalThis.window = { localStorage: storage, sessionStorage: { getItem: () => "copied-session-id" } };
  try {
    const a = await import("../src/lib/recovery.ts?document=a");
    const b = await import("../src/lib/recovery.ts?document=b");
    const first = draft("original tab", 2), duplicate = draft("duplicated tab", 3);
    a.writeRecoveryDraft(first);
    b.writeRecoveryDraft(duplicate);
    assert.equal(a.readRecoveryDraft(first.projectIdentity, first.pageId).page.texts[0].text, "original tab");
    a.clearRecoveryDraft(first.projectIdentity, first.pageId, true);
    assert.equal(b.readRecoveryDraft(duplicate.projectIdentity, duplicate.pageId).page.texts[0].text, "duplicated tab");
  } finally { globalThis.window = originalWindow; }
});
