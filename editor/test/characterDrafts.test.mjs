import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InspectorPanel from "../src/components/InspectorPanel.tsx";
import PageSidebar from "../src/components/PageSidebar.tsx";
import { activeCharacterDraft, characterLora, characterPatch, composeAppearanceZh, emptyAppearanceProfile, hasCharacterDraftChanges, isCharacterScope, useCharacterDraftStore } from "../src/lib/characterDrafts.ts";
import { useEditorStore } from "../src/lib/store.ts";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const original = () => ({ format: "soda-storyboard-character-v1", id: "girl", display_name: "妹妹", appearance: { zh: "原外观", en: "original", future: { preserve: 1 } }, clothing: ["白色短裤"], metadata: { unknown: [1, 2] } });
function renderInspector(Component = InspectorPanel) {
  const hydration = useCharacterDraftStore.getInitialState(), editorHydration = useEditorStore.getInitialState();
  const before = { ...hydration }, editorBefore = { ...editorHydration }, previousReact = globalThis.React;
  try {
    Object.assign(hydration, useCharacterDraftStore.getState()); Object.assign(editorHydration, useEditorStore.getState());
    globalThis.React = React;
    return renderToStaticMarkup(React.createElement(Component));
  } finally { Object.assign(hydration, before); Object.assign(editorHydration, editorBefore); globalThis.React = previousReact; }
}
function setup(t) {
  const fetch = globalThis.fetch, characterState = useCharacterDraftStore.getState(), editorState = useEditorStore.getState();
  t.after(() => { globalThis.fetch = fetch; useCharacterDraftStore.setState(characterState, true); useEditorStore.setState(editorState, true); });
  useCharacterDraftStore.setState({ target: { kind: "canvas" }, drafts: {}, loading: null, loadError: null });
  useEditorStore.setState({ sodaPage: null, activePageId: "", characters: [], characterDetails: {}, characterRevision: 0, refreshCharacters: async () => {} });
  return useCharacterDraftStore;
}

test("structured Chinese appearance includes every garment and signature in stable order", () => {
  const profile = emptyAppearanceProfile();
  profile.hair = { style: { zh: "双马尾" }, color: { zh: "粉色" } }; profile.eyes = { zh: "琥珀色眼睛" };
  profile.outfit = [{ id: "one", style: { zh: "宽松连帽衫" }, color: { zh: "亮黄色" } }, { id: "two", style: { zh: "短裤" }, color: { zh: "白色" } }];
  profile.signatures = [{ zh: "红色星形发夹" }]; profile.extra = { zh: "小个子" };
  assert.equal(composeAppearanceZh(profile), "粉色双马尾，琥珀色眼睛，亮黄色宽松连帽衫，白色短裤，红色星形发夹，小个子");
});

test("opening and switching role drafts preserves canvas selection and both unsaved drafts", async t => {
  const store = setup(t), selection = { kind: "figure", panelId: "p1", id: "fig" };
  useEditorStore.setState({ selection, selections: [selection] });
  globalThis.fetch = async url => json({ character: { ...original(), id: url.endsWith("other") ? "other" : "girl" }, version: '"v1"' });
  await store.getState().open("girl"); store.getState().edit("girl", { age: "18" });
  await store.getState().open("other"); store.getState().edit("other", { role_en: "a classmate" });
  store.getState().showCanvas();
  assert.deepEqual(useEditorStore.getState().selection, selection);
  assert.equal(hasCharacterDraftChanges(store.getState()), true);
  assert.equal(isCharacterScope(store.getState().target), false);
  await store.getState().open("girl");
  assert.equal(activeCharacterDraft(store.getState()).value.age, "18");
  assert.equal(store.getState().drafts.other.value.role_en, "a classmate");
  assert.equal(isCharacterScope(store.getState().target), true);
});

test("legacy text remains unchanged when editing color and PATCH uses the original ETag", async t => {
  const store = setup(t), character = original(), calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (!options.method) return json({ character, version: '"opened-version"' });
    assert.equal(options.method, "PATCH"); assert.equal(options.headers.get("If-Match"), '"opened-version"');
    assert.deepEqual(JSON.parse(options.body), { sketch_color: "#AABBCC" });
    return json({ character: { ...character, sketch_color: "#AABBCC" }, version: '"saved-version"' });
  };
  await store.getState().open("girl"); store.getState().edit("girl", { sketch_color: "#AABBCC" });
  assert.equal(store.getState().drafts.girl.value.appearance_profile, undefined);
  assert.equal(await store.getState().save("girl"), true);
  assert.equal(calls.length, 2);
  assert.deepEqual(useEditorStore.getState().characterDetails.girl.metadata, character.metadata);
  assert.equal(useEditorStore.getState().characterRevision, 1);
  assert.equal(store.getState().drafts.girl.version, '"saved-version"');
  assert.equal(store.getState().drafts.girl.dirty, false);
});

test("PATCH excludes identity changes and retains unknown nested appearance metadata", () => {
  const before = original(), after = { ...before, id: "changed", display_name: "changed", appearance: { ...before.appearance, en: "edited" } };
  assert.deepEqual(characterPatch(before, after), { appearance: { zh: "原外观", en: "edited", future: { preserve: 1 } } });
});

test("a version conflict retains the exact draft and never retries with a new server ETag", async t => {
  const store = setup(t); let writes = 0;
  globalThis.fetch = async (_url, options) => options.method ? (writes++, json({ error: "changed", reason: "character_version_conflict", version: '"v2"' }, 409)) : json({ character: original(), version: '"v1"' });
  await store.getState().open("girl"); store.getState().edit("girl", { age: "18" });
  assert.equal(await store.getState().save("girl"), false);
  const draft = store.getState().drafts.girl;
  assert.equal(draft.value.age, "18"); assert.equal(draft.version, '"v1"'); assert.equal(draft.conflict, true); assert.equal(draft.dirty, true);
  assert.equal(await store.getState().save("girl"), false); assert.equal(writes, 1);
});

test("create works with no pages, permits incomplete appearance, and renders the character inspector", async t => {
  const store = setup(t), key = store.getState().create();
  store.getState().edit(key, { display_name: "新角色" });
  const markup = renderInspector();
  assert.match(markup, /新建角色/); assert.match(markup, /英文可以留空保存/); assert.doesNotMatch(markup, /请选择分镜页/);
  globalThis.fetch = async (_url, options) => { assert.equal(options.method, "POST"); assert.equal(options.headers.has("If-Match"), false); return json({ character: JSON.parse(options.body), version: '"new"' }, 201); };
  assert.equal(await store.getState().save(key), true);
  assert.equal(useEditorStore.getState().characters.length, 1); assert.equal(store.getState().target.kind, "character");
});

test("duplicate starts a draft with safe defaults and restores legacy aliases only on explicit opt-in", async t => {
  const store = setup(t);
  const source = { ...original(), triggers: ["legacy_trigger"], lora_path: "legacy.safetensors", lora_strength: 0.7, references: ["reference.png"], approved_reference_images: ["approved.png"] };
  globalThis.fetch = async (_url, options) => {
    if (!options.method) return json({ character: source, version: '"source"' });
    assert.equal(options.headers.get("If-Match"), '"source"');
    const body = JSON.parse(options.body); assert.equal(body.copy_lora, true); assert.equal(body.copy_trigger_words, true); assert.equal(body.copy_reference_images, true);
    return json({ character: body.character, version: '"copy"' }, 201);
  };
  await store.getState().duplicate("girl");
  const draft = activeCharacterDraft(store.getState());
  assert.equal(draft.value.lora_path, undefined); assert.equal(draft.value.triggers, undefined); assert.equal(draft.value.approved_reference_images, undefined);
  assert.deepEqual(draft.value.trigger_words, []); assert.deepEqual(draft.value.approved_images, []); assert.deepEqual(draft.value.references, ["reference.png"]);
  store.getState().setCopyOption(draft.key, "copy_lora", true); store.getState().setCopyOption(draft.key, "copy_trigger_words", true);
  store.getState().setCopyOption(draft.key, "copy_reference_images", false); store.getState().setCopyOption(draft.key, "copy_reference_images", true);
  assert.deepEqual(store.getState().drafts[draft.key].value.lora, { path: "legacy.safetensors", strength: 0.7 });
  assert.deepEqual(store.getState().drafts[draft.key].value.trigger_words, ["legacy_trigger"]);
  assert.deepEqual(store.getState().drafts[draft.key].value.reference_images, ["reference.png"]);
  assert.equal(await store.getState().save(draft.key), true);
});

test("duplicate target ID occupation can be corrected and retried without abandoning the draft", async t => {
  const store = setup(t); let writes = 0;
  globalThis.fetch = async (_url, options) => {
    if (!options.method) return json({ character: original(), version: '"source"' });
    if (++writes === 1) return json({ error: "ID 已占用", reason: "character_id_exists" }, 409);
    return json({ character: JSON.parse(options.body).character, version: '"saved"' }, 201);
  };
  await store.getState().duplicate("girl"); const key = activeCharacterDraft(store.getState()).key;
  assert.equal(await store.getState().save(key), false); assert.equal(store.getState().drafts[key].conflict, false);
  store.getState().edit(key, { id: "girl_second_copy" });
  assert.equal(await store.getState().save(key), true); assert.equal(writes, 2);
});

test("non-version 409 leaves edits retryable after a production block is resolved", async t => {
  const store = setup(t); let writes = 0;
  globalThis.fetch = async (_url, options) => !options.method ? json({ character: original(), version: '"v1"' }) : ++writes === 1 ? json({ error: "任务运行中", reason: "production_running" }, 409) : json({ character: { ...original(), age: "18" }, version: '"v2"' });
  await store.getState().open("girl"); store.getState().edit("girl", { age: "18" });
  assert.equal(await store.getState().save("girl"), false); assert.equal(store.getState().drafts.girl.conflict, false);
  assert.equal(await store.getState().save("girl"), true);
});

test("validation exposes all clothing warning codes and ignores obsolete responses", async t => {
  const store = setup(t), key = store.getState().create(); let resolve;
  const warnings = ["character_clothing_missing", "character_clothing_color_missing", "character_clothing_similar"].map(code => ({ severity: "warning", code, message: code }));
  globalThis.fetch = async (_url, options) => {
    const character = JSON.parse(options.body).character;
    return new Promise(done => { resolve = () => done(json({ character, warnings, errors: [] })); });
  };
  const pending = store.getState().validate(key); store.getState().edit(key, { age: "18" }); resolve(); await pending;
  assert.equal(store.getState().drafts[key].validation, undefined);
  const current = store.getState().validate(key); resolve(); await current;
  assert.deepEqual(store.getState().drafts[key].validation.warnings.map(issue => issue.code), warnings.map(issue => issue.code));
  const markup = renderInspector();
  for (const warning of warnings) assert.match(markup, new RegExp(`data-code="${warning.code}"`));
});

test("external refresh never overwrites edits made while its GET is in flight", async t => {
  const store = setup(t); let resolve;
  globalThis.fetch = async () => json({ character: original(), version: '"v1"' });
  await store.getState().open("girl");
  globalThis.fetch = async () => new Promise(done => { resolve = () => done(json({ character: { ...original(), age: "server" }, version: '"v2"' })); });
  const reload = store.getState().reload("girl");
  store.getState().edit("girl", { age: "local" }); resolve(); await reload;
  assert.equal(store.getState().drafts.girl.value.age, "local"); assert.equal(store.getState().drafts.girl.version, '"v1"'); assert.equal(store.getState().drafts.girl.externalChanged, true);
});

test("new edits made during a save remain dirty against the acknowledged baseline", async t => {
  const store = setup(t); let resolve;
  globalThis.fetch = async (_url, options) => !options.method ? json({ character: original(), version: '"v1"' }) : new Promise(done => { resolve = () => done(json({ character: { ...original(), age: "18" }, version: '"v2"' })); });
  await store.getState().open("girl"); store.getState().edit("girl", { age: "18" });
  const save = store.getState().save("girl"); store.getState().edit("girl", { age: "19" }); resolve(); assert.equal(await save, true);
  assert.equal(store.getState().drafts.girl.value.age, "19"); assert.equal(store.getState().drafts.girl.baseline.age, "18"); assert.equal(store.getState().drafts.girl.dirty, true);
});

test("legacy aliases stay in sync during structural editing and unknown profile data survives", async t => {
  const store = setup(t), profile = emptyAppearanceProfile(); profile.hair.style = { zh: "短发", future: true };
  const character = { ...original(), appearance_zh: "原外观", appearance_en: "original", appearance: { cn: "原外观", en: "original", future: { preserve: 1 } }, appearance_profile: { ...profile, future: [1] } };
  globalThis.fetch = async () => json({ character, version: '"v1"' });
  await store.getState().open("girl");
  store.getState().edit("girl", { appearance_profile: { ...character.appearance_profile, hair: { ...profile.hair, color: { zh: "黑色" } } } });
  const value = store.getState().drafts.girl.value;
  assert.equal(value.appearance.zh, "黑色短发"); assert.equal(value.appearance.cn, "黑色短发"); assert.equal(value.appearance_zh, "黑色短发");
  assert.deepEqual(value.appearance.future, { preserve: 1 }); assert.equal(value.appearance_profile.hair.style.future, true); assert.deepEqual(value.appearance_profile.future, [1]);
});

test("external generated-text mismatch offers an explicit choice and protects the original text", async t => {
  const store = setup(t), profile = emptyAppearanceProfile(); profile.hair.style = { zh: "短发" }; profile.generated = { source_hash: "old", appearance_hash: "old" };
  const character = { ...original(), appearance: { zh: "外部更新的描述", en: "external" }, appearance_profile: profile };
  globalThis.fetch = async (_url, options) => !options.method ? json({ character, version: '"v1"' }) : json({ character, warnings: [{ severity: "warning", code: "appearance_generated_mismatch", message: "外部修改" }], errors: [] });
  await store.getState().open("girl"); await store.getState().validate("girl");
  const markup = renderInspector();
  assert.match(markup, /保留外部文本/); assert.match(markup, /重新生成结构化外观/); assert.doesNotMatch(markup, /aria-label="发型"/);
  assert.equal(store.getState().drafts.girl.value.appearance.zh, "外部更新的描述"); assert.equal(store.getState().drafts.girl.dirty, false);
});

test("create-and-assign recognizes legacy figure identities and refuses a different active page", async t => {
  const store = setup(t), assignments = [], figure = { character_id: "girl", pose: "stand", position: "center", facing: "front" };
  useEditorStore.setState({ activePageId: "page1", sodaPage: { id: "page1", canvas_width: 800, canvas_height: 900, reading_direction: "ltr", panels: [{ id: "panel", shape: { type: "rect", x: 0, y: 0, w: 800, h: 900 }, figures: [figure] }] }, updateFigureById: (...args) => assignments.push(args) });
  let key = store.getState().create({ pageId: "page1", panelId: "panel", figureId: "legacy-figure-0" }); store.getState().edit(key, { display_name: "创建角色" });
  globalThis.fetch = async (_url, options) => json({ character: JSON.parse(options.body), version: '"created"' }, 201);
  assert.equal(await store.getState().save(key), true); assert.equal(assignments.length, 1); assert.equal(assignments[0][1], "legacy-figure-0");
  key = store.getState().create({ pageId: "page1", panelId: "panel", figureId: "legacy-figure-0" }); store.getState().edit(key, { display_name: "另一个角色" });
  useEditorStore.setState({ activePageId: "page2" });
  assert.equal(await store.getState().save(key), true); assert.equal(assignments.length, 1); assert.match(useEditorStore.getState().notice, /原人物已变化/);
});

test("character rows give editing and copying separate native button hit areas", t => {
  setup(t);
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => JSON.stringify({ tab: "characters" }), setItem: () => {} };
  t.after(() => { globalThis.localStorage = previousStorage; });
  useEditorStore.setState({ characters: [{ id: "girl", display_name: "妹妹", has_lora: false }] });
  const markup = renderInspector(PageSidebar);
  const row = markup.match(/<div class="character-row"[\s\S]*?<\/div>/)?.[0];
  assert.ok(row); assert.match(row, /draggable="true"/); assert.doesNotMatch(row, /role="button"/);
  assert.match(row, /<button[^>]*class="[^"]*flex-1[^"]*"[^>]*aria-label="编辑角色 妹妹"/);
  assert.match(row, /<\/button>\s*<button[^>]*data-character-action="copy"[^>]*aria-label="复制角色 妹妹"/);
  const buttons = row.match(/<button\b[\s\S]*?<\/button>/g);
  assert.equal(buttons.length, 2); assert.doesNotMatch(buttons[0].slice(1), /<button\b/);
});

test("legacy LoRA paths display and edit correctly without string-spread fields or lost metadata", async t => {
  const store = setup(t);
  const variants = [
    { lora: "string.safetensors" },
    { lora: { model: "model.safetensors", strength: 0.7, future: { preserved: true } } },
    { lora: { file: "file.safetensors", future: { preserved: true } } },
    { lora_path: "flat.safetensors", lora_strength: 0.6 }
  ];
  for (const [index, variant] of variants.entries()) {
    const id = `legacy_${index}`, character = { ...original(), ...variant, id };
    globalThis.fetch = async () => json({ character, version: '"v1"' });
    await store.getState().open(id);
    const normalized = characterLora(character), expectedPath = ["string.safetensors", "model.safetensors", "file.safetensors", "flat.safetensors"][index];
    assert.equal(normalized.path, expectedPath);
    assert.match(renderInspector(), new RegExp(`aria-label="LoRA 文件"[^>]*value="${expectedPath}"`));
    store.getState().edit(id, { lora: { ...normalized, path: "edited.safetensors" } });
    const edited = store.getState().drafts[id].value.lora;
    assert.equal(edited.path, "edited.safetensors"); assert.equal(Object.keys(edited).some(key => /^\d+$/.test(key)), false);
    if (variant.lora?.future) assert.deepEqual(edited.future, variant.lora.future);
    assert.equal(character.lora, variant.lora);
  }
});

test("opting into copied LoRA then opting out clears form state and keeps subsequent edits disabled", async t => {
  const store = setup(t), source = { ...original(), lora: { model: "source.safetensors", strength: 0.8, future: true }, lora_path: "source.safetensors", lora_strength: 0.8 };
  globalThis.fetch = async () => json({ character: source, version: '"source"' });
  await store.getState().duplicate("girl"); const key = activeCharacterDraft(store.getState()).key;
  store.getState().setCopyOption(key, "copy_lora", true);
  assert.equal(characterLora(store.getState().drafts[key].value).path, "source.safetensors");
  assert.equal(store.getState().drafts[key].value.lora.future, true);
  store.getState().setCopyOption(key, "copy_lora", false);
  const draft = store.getState().drafts[key];
  assert.equal(draft.copyOptions.copy_lora, false); assert.equal(draft.value.lora, null); assert.equal(characterLora(draft.value), null);
  assert.doesNotMatch(renderInspector(), /aria-label="LoRA 文件"/);
  store.getState().edit(key, { age: "18" }); assert.equal(store.getState().drafts[key].copyOptions.copy_lora, false);
  store.getState().setCopyOption(key, "copy_lora", true);
  assert.equal(characterLora(store.getState().drafts[key].value).path, "source.safetensors");
});
