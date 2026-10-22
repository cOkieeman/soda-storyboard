import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { applyTheme, initialTheme, readThemePreference, saveThemePreference, THEME_MEDIA_QUERY, THEME_STORAGE_KEY } from "../src/lib/theme.ts";

function storage(value = null) {
  const values = new Map(value === null ? [] : [[THEME_STORAGE_KEY, value]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, next) => values.set(key, next) };
}
function documentFixture() {
  const meta = new Map();
  return { documentElement: { dataset: {}, style: {} }, querySelector: () => ({ setAttribute: (key, value) => meta.set(key, value) }), meta };
}

test("Without a saved choice the theme follows the system; valid saved choices take precedence", () => {
  const dark = query => { assert.equal(query, THEME_MEDIA_QUERY); return { matches: true }; };
  assert.equal(initialTheme(storage(), dark), "dark");
  assert.equal(initialTheme(storage(), () => ({ matches: false })), "light");
  assert.equal(initialTheme(storage("light"), dark), "light");
  assert.equal(initialTheme(storage("dark"), () => ({ matches: false })), "dark");
  assert.equal(initialTheme(storage("unexpected"), dark), "dark");
});

test("Changing the theme persists the choice and synchronizes document theme, native controls, and browser chrome", () => {
  const saved = storage();
  const doc = documentFixture();
  saveThemePreference("dark", saved);
  applyTheme("dark", doc);
  assert.equal(readThemePreference(saved), "dark");
  assert.equal(doc.documentElement.dataset.theme, "dark");
  assert.equal(doc.documentElement.style.colorScheme, "dark");
  assert.equal(doc.meta.get("content"), "#222520");
  saveThemePreference("light", saved);
  applyTheme("light", doc);
  assert.equal(initialTheme(saved, () => ({ matches: true })), "light");
  assert.equal(doc.documentElement.style.colorScheme, "light");
});

test("Theme resolution and application remain usable without window or storage access", () => {
  assert.equal(initialTheme(), "light");
  assert.doesNotThrow(() => applyTheme("dark"));
  const blocked = { getItem: () => { throw new Error("storage denied"); }, setItem: () => { throw new Error("storage denied"); } };
  assert.equal(initialTheme(blocked, () => ({ matches: true })), "dark");
  assert.doesNotThrow(() => saveThemePreference("light", blocked));
});

test("The early page bootstrap applies the same saved or system theme before React starts", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const bootstrap = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(bootstrap, "the document must initialize its theme before loading the app");
  for (const [saved, systemDark, expected] of [[null, true, "dark"], [null, false, "light"], ["light", true, "light"], ["dark", false, "dark"]]) {
    const doc = documentFixture();
    vm.runInNewContext(bootstrap, { document: doc, localStorage: storage(saved), matchMedia: () => ({ matches: systemDark }) });
    assert.equal(doc.documentElement.dataset.theme, expected);
    assert.equal(doc.documentElement.style.colorScheme, expected);
  }
  const doc = documentFixture();
  vm.runInNewContext(bootstrap, { document: doc, localStorage: { getItem: () => { throw new Error("denied"); } }, matchMedia: () => ({ matches: true }) });
  assert.equal(doc.documentElement.dataset.theme, "dark");
});
