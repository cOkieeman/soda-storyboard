import assert from "node:assert/strict";
import test from "node:test";
import { parseNumberDraft } from "../src/components/ui/NumberInput.tsx";
import { isComposingEvent } from "../src/components/modals/ModalShell.tsx";
import { commonValue } from "../src/components/BatchInspector.tsx";
import { FAVORITES_KEY, readFavorites, saveFavorite, removeFavorite, validateFavorite } from "../src/lib/favorites.ts";

test("number drafts preserve incomplete input instead of silently clamping or persisting it", () => {
  for (const draft of ["", " ", "-", "+", ".", "NaN", "Infinity", "0x10"]) assert.equal(parseNumberDraft(draft).value, undefined);
  assert.deepEqual(parseNumberDraft("-12.5"), { value: -12.5 });
  assert.deepEqual(parseNumberDraft(".5", { min: 0, max: 1 }), { value: 0.5 });
  assert.equal(parseNumberDraft("7", { min: 8, max: 128 }).value, undefined);
  assert.equal(parseNumberDraft("129", { min: 8, max: 128 }).value, undefined);
  assert.equal(parseNumberDraft("1.5", { integer: true }).value, undefined);
  assert.deepEqual(parseNumberDraft("12", { integer: true, min: 1 }), { value: 12 });
});

test("IME guards cover composition and Windows legacy 229 events", () => {
  assert.equal(isComposingEvent({ isComposing: true }), true);
  assert.equal(isComposingEvent({ keyCode: 229 }), true);
  assert.equal(isComposingEvent({ isComposing: false, keyCode: 13 }), false);
});

test("mixed styles preserve falsy common values and distinguish mixed from empty", () => {
  assert.equal(commonValue([false, false]), false);
  assert.equal(commonValue([0, 0]), 0);
  assert.equal(commonValue(["", ""]), "");
  assert.equal(commonValue(["speech", "box"]), undefined);
  assert.equal(commonValue([]), undefined);
});

function storage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }
const bubble = (id = "b1") => ({ id, name: "横排旁白", createdAt: "2026-10-22", kind: "bubble", data: { bubble: "box", direction: "horizontal", font_size: 24, hasTail: false } });

test("favorites survive storage round trip, replace by id, and can be removed", () => {
  const db = storage();
  saveFavorite(bubble(), db);
  assert.deepEqual(readFavorites(db), [bubble()]);
  saveFavorite({ ...bubble(), name: "更新名称" }, db);
  assert.equal(readFavorites(db).length, 1);
  assert.equal(readFavorites(db)[0].name, "更新名称");
  assert.deepEqual(removeFavorite("b1", db), []);
});

test("favorites reject malformed persisted styles and cap local history", () => {
  const db = storage();
  db.setItem(FAVORITES_KEY, "{broken"); assert.deepEqual(readFavorites(db), []);
  db.setItem(FAVORITES_KEY, JSON.stringify([bubble(), { ...bubble("bad"), data: { bubble: "invalid" } }]));
  assert.equal(readFavorites(db).length, 1);
  assert.equal(validateFavorite({ ...bubble(), data: { ...bubble().data, font_size: Infinity } }), false);
  assert.equal(validateFavorite({ id: "pose", name: "错误", createdAt: "now", kind: "pose", data: { pose: "stand", editor: { joints: { head: [0, "bad"] } } } }), false);
  assert.equal(validateFavorite({ id: "pose", name: "位置不属于样式", createdAt: "now", kind: "pose", data: { pose: "stand", editor: { x: 999 } } }), false);
  for (let i = 0; i < 55; i++) saveFavorite(bubble(String(i)), db);
  assert.equal(readFavorites(db).length, 50);
  assert.equal(readFavorites(db)[0].id, "54");
});

test("favorite storage failures stay visible to callers", () => {
  assert.throws(() => saveFavorite(bubble(), { getItem: () => null, setItem: () => { throw new Error("quota"); } }), /quota/);
});
