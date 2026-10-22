import assert from "node:assert/strict";
import test from "node:test";
import { characterSketchColor, normalizeCharacterColor } from "../src/lib/characterColors.ts";
import { ApiError, saveCharacterColor } from "../src/lib/api.ts";
import { generateFigureGeometry, generateOverlayFigure, generatePageSketchGeometry } from "../src/lib/sketchGeometry.ts";
import { useEditorStore } from "../src/lib/store.ts";

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

test("Character colors accept portable hex values and retain existing defaults for invalid metadata", () => {
  assert.equal(normalizeCharacterColor("#aBc"), "#AABBCC");
  assert.equal(normalizeCharacterColor("#a3b4c5"), "#A3B4C5");
  for (const invalid of ["red", "rgba(1,2,3,1)", "#12", "#12345678", "<script>", null, 4]) assert.equal(normalizeCharacterColor(invalid), null);
  assert.equal(characterSketchColor({ sketch_color: "#aBc" }), "#AABBCC");
  assert.equal(characterSketchColor({}, "red"), "red");
});

test("Custom character colors reach legacy, editable, overlay and every panel figure", () => {
  const character = { id: "girl", display_name: "Girl", has_lora: false, sketch_color: "#b44a3a" };
  const legacy = { character_id: "girl", pose: "stand", position: "center", facing: "front" };
  for (const figure of [legacy, { ...legacy, editor: { version: 1, x: 160, y: 200, size: 180 } }]) {
    assert.equal(generateFigureGeometry([400, 300], figure, character).color, "#B44A3A");
  }
  assert.equal(generateOverlayFigure({ character_id: "girl", mode: "moss", rect: { x: 0, y: 0, w: 200, h: 300 } }, [character]).color, "#B44A3A");
  const page = { id: "p", canvas_width: 800, canvas_height: 900, reading_direction: "ltr", panels: [0, 1].map(index => ({ id: `p${index}`, shape: { type: "rect", x: 0, y: index * 400, w: 800, h: 400 }, figures: [legacy], character_ids: ["girl"] })) };
  assert.deepEqual(generatePageSketchGeometry(page, [character]).panels.map(panel => panel.figures[0].color), ["#B44A3A", "#B44A3A"]);
});

test("Color saving GETs the complete current character and merges only color with If-Match", async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  const original = { id: "girl", display_name: "Girl", lora: { path: "role.safetensors", strength: 0.75 }, appearance: { en: "Original" }, future_metadata: { keep: [1, 2] } };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return json({ character: original }, 200, { ETag: '"character-v1"' });
    assert.equal(options.method, "PUT");
    assert.equal(options.headers.get("If-Match"), '"character-v1"');
    const merged = JSON.parse(options.body);
    assert.deepEqual(merged, { ...original, sketch_color: "#AABBCC" });
    return json({ character: merged });
  };
  const result = await saveCharacterColor("girl", "#abc");
  assert.equal(result.sketch_color, "#AABBCC");
  assert.equal(calls.length, 2);
  assert.equal(original.sketch_color, undefined);
});

test("A stale character version fails without retrying or blindly overwriting", async t => {
  const fetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = fetch; });
  let count = 0;
  globalThis.fetch = async () => ++count === 1 ? json({ character: { id: "girl" }, version: '"v1"' }) : json({ error: "角色资料已修改" }, 409);
  await assert.rejects(saveCharacterColor("girl", "#112233"), error => error instanceof ApiError && error.status === 409);
  assert.equal(count, 2);
});

test("Saved color updates role summaries, full metadata and all matching canvas geometry", async t => {
  const fetch = globalThis.fetch, snapshot = useEditorStore.getState();
  t.after(() => { globalThis.fetch = fetch; useEditorStore.setState(snapshot, true); });
  const character = { id: "girl", display_name: "Girl", future: { retained: true } };
  useEditorStore.setState({ characters: [{ ...character, has_lora: false }, { id: "other", display_name: "Other", has_lora: false }], characterDetails: {}, sketchGeometry: { panels: [0, 1].map(index => ({ panel_id: `p${index}`, figures: [{ character_id: "girl", color: "blue" }, { character_id: "other", color: "green" }] })) } });
  globalThis.fetch = async (_url, options) => options.method === "PUT" ? json({ character: JSON.parse(options.body) }) : json({ character, version: '"v1"' });
  assert.equal(await useEditorStore.getState().updateCharacterColor("girl", "#B44A3A"), true);
  const state = useEditorStore.getState();
  assert.equal(state.characters[0].sketch_color, "#B44A3A");
  assert.deepEqual(state.characterDetails.girl.future, { retained: true });
  assert.deepEqual(state.sketchGeometry.panels.map(panel => panel.figures.map(figure => figure.color)), [["#B44A3A", "green"], ["#B44A3A", "green"]]);
});

test("Failed color saving leaves visible colors unchanged and gives a conflict notice", async t => {
  const fetch = globalThis.fetch, snapshot = useEditorStore.getState();
  t.after(() => { globalThis.fetch = fetch; useEditorStore.setState(snapshot, true); });
  useEditorStore.setState({ characters: [{ id: "girl", display_name: "Girl", has_lora: false, sketch_color: "#3288A2" }] });
  globalThis.fetch = async (_url, options) => options.method === "PUT" ? json({ error: "conflict" }, 409) : json({ character: { id: "girl" }, version: '"v1"' });
  assert.equal(await useEditorStore.getState().updateCharacterColor("girl", "#B44A3A"), false);
  assert.equal(useEditorStore.getState().characters[0].sketch_color, "#3288A2");
  assert.match(useEditorStore.getState().notice, /颜色未保存/);
});
