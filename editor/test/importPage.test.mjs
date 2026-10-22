import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { collectImportedCharacterIds, mapImportedCharacters, parseImportedPage } from "../src/lib/importPage.ts";

const options = { canvasWidth: 1024, canvasHeight: 1536 };
const fixture = path => readFileSync(new URL(`../../examples/${path}`, import.meta.url), "utf8");
const parse = value => parseImportedPage(typeof value === "string" ? value : JSON.stringify(value), options);
const panel = () => ({ id: "p1", order: 1, shape: { type: "rect", x: 40.123456, y: 50.987654, w: 400.333333, h: 600.444444 }, character_ids: [], figures: [], description: "原画面" });
const native = () => ({ format: "soda-storyboard-page-v1", id: "sample", canvas_width: 1024, canvas_height: 1536, panels: [panel()], texts: [], reading_direction: "rtl" });
const moss = items => ({ summary: { caption: "原始MOSS说明" }, items, bbox_coord_space: "abs_centralized", bbox_format: "yxyx" });
const objectItem = extra => ({ label: "object", caption: "A comic panel", bbox: [-700, -450, -100, -50], ...extra });

test("Real station native JSON migrates every dialogue and sound effect into editable, distributed text", () => {
  const source = JSON.parse(fixture("station/pages/station-turn.json"));
  const result = parse(source);
  assert.equal(result.format, "soda");
  assert.equal(result.needsCanvasSize, false);
  assert.equal(result.page.panels.length, 4);
  assert.equal(result.page.texts.length, 5);
  assert.deepEqual(result.page.texts.map(item => item.text).sort(), ["……是你？", "我正要走。", "脚步声", "轰——", "嘟——"].sort());
  assert.ok(result.page.panels.every(item => !item.dialogue?.length && !item.sfx?.length), "legacy collections must be emptied to prevent double rendering");
  for (const item of result.page.texts) {
    const shape = result.page.panels.find(panel => panel.id === item.panel_id).shape;
    assert.ok(item.bbox.x >= shape.x && item.bbox.y >= shape.y);
    assert.ok(item.bbox.x + item.bbox.w <= shape.x + shape.w + 1e-6);
    assert.ok(item.bbox.y + item.bbox.h <= shape.y + shape.h + 1e-6);
  }
  const thirdPanelTexts = result.page.texts.filter(item => item.panel_id === "p3");
  assert.notDeepEqual(thirdPanelTexts[0].bbox, thirdPanelTexts[1].bbox, "two text objects should not share a placeholder location");
  assert.deepEqual(result.page.import_source.data, source);
  assert.deepEqual(collectImportedCharacterIds(result.page), ["girl"]);
  assert.ok(result.warnings.some(message => message.includes("可编辑文字")));
});

test("Real pudding native and wrapped pages preserve original text rectangles and metadata", () => {
  const source = JSON.parse(fixture("pudding/pages/pudding.json"));
  const direct = parse(source), wrapped = parse({ page: source, version: "ignored transport version" });
  assert.deepEqual(wrapped.page, direct.page);
  assert.equal(direct.page.panels.length, 5);
  assert.equal(direct.page.texts.length, source.texts.length);
  assert.equal(direct.page.overlays.length, source.overlays.length);
  direct.page.texts.forEach((item, index) => assert.deepEqual(item.bbox, source.texts[index].bbox));
  assert.deepEqual(collectImportedCharacterIds(direct.page).sort(), ["older", "younger"]);
});

test("Native figures retain editor view, joint precision, unknown fields, and untouched quad coordinates", () => {
  const source = native();
  source.custom_meta = { flag: true, detail: [1, "keep me"] };
  source.panels[0].shape = { type: "quad", points: [[40.123456, 50.987654], [440.456789, 60.555555], [430.333333, 651.432198], [50.222222, 640.111111]], custom_shape: "keep" };
  source.panels[0].custom_panel = "preserve";
  source.panels[0].figures = [{ id: "fig1", character_id: "external", pose: "lie", position: 0.5, facing: "left", editor: { version: 1, x: 95.123456, y: 160, size: 300, flip: true, style: "rough", view: "side", joints: { head: [42.123456, -16.333333] }, custom_rig: { value: "same" } }, other_figure: 9 }];
  const result = parse(source).page;
  assert.deepEqual(result.custom_meta, source.custom_meta);
  assert.deepEqual(result.panels[0].shape, source.panels[0].shape);
  assert.deepEqual(result.panels[0].figures, source.panels[0].figures);
  assert.equal(result.panels[0].custom_panel, "preserve");
});

test("Empty native pages, BOM, and one JSON fence are accepted without identifying unrelated JSON as a page", () => {
  const source = { ...native(), panels: [] };
  assert.equal(parse(`\uFEFF\n\`\`\`json\n${JSON.stringify(source)}\n\`\`\``).page.panels.length, 0);
  for (const unrelated of [{ format: "soda-storyboard-project-v1", pages: [] }, { format: "soda-storyboard-character-v1", id: "girl" }, { nodes: [], links: [], last_node_id: 4 }, { 1: { class_type: "KSampler", inputs: {} } }, [], null]) {
    assert.throws(() => parse(unrelated), /JSON 对象|未识别|不是 Soda/);
  }
  assert.throws(() => parse("{broken}"), /JSON 格式不正确/);
  assert.throws(() => parse(""), /先粘贴 JSON/);
});

test("Native canvas, geometry, duplicate ids, and parent references fail before creating any page", () => {
  for (const value of [0, -1, 8193, 123.5, "1024", true]) {
    assert.throws(() => parse({ ...native(), canvas_width: value }), /canvas_width/);
  }
  for (const shape of [{ type: "rect", x: -1, y: 0, w: 200, h: 200 }, { type: "rect", x: 0, y: 0, w: 0, h: 200 }, { type: "circle", cx: 50, cy: 50 }, { type: "quad", points: [[0, 0], [100, 0], [100, 100]] }]) {
    const source = native(); source.panels[0].shape = shape;
    assert.throws(() => parse(source), /超出|大于 0|rect 或 quad|4 个/);
  }
  assert.throws(() => parse('{"format":"soda-storyboard-page-v1","canvas_width":1e309,"canvas_height":10,"panels":[]}'), /有限数字/);
  const duplicate = native(); duplicate.panels.push(panel());
  assert.throws(() => parse(duplicate), /id.*重复/);
  const orphan = native(); orphan.texts = [{ id: "t1", text: "台词", panel_id: "missing", bbox: { type: "rect", x: 20, y: 20, w: 50, h: 70 } }];
  assert.throws(() => parse(orphan), /不存在的格子/);
  orphan.texts[0].panel_id = "p1"; orphan.texts[0].bbox.x = 1023;
  assert.throws(() => parse(orphan), /超出/);
});

test("Real station MOSS uses the explicit canvas and extracts quoted dialogue rather than the whole caption", () => {
  const result = parse(fixture("station/station-turn.moss.json"));
  assert.equal(result.format, "moss");
  assert.equal(result.needsCanvasSize, true);
  assert.equal(result.page.panels.length, 4);
  assert.equal(result.page.texts.length, 2);
  assert.equal(result.page.panel_gap, 0);
  assert.ok(result.page.panels.every(panel => panel.caption_en === ""), "editing imported descriptions must affect subsequent generation");
  assert.deepEqual(result.page.panels[0].shape, { type: "rect", x: 536, y: 48, w: 440, h: 500 });
  assert.deepEqual(result.page.texts.map(item => item.text), ["……是你？", "我正要走。"]);
  assert.ok(result.page.texts.every(item => item.style_hint.includes("Chinese text") && item.panel_id));
  assert.deepEqual(result.page.import_source.data, JSON.parse(fixture("station/station-turn.moss.json")));
});

test("Real pudding MOSS keeps its character region as an overlay, 5 panels, and all 7 explicit texts", () => {
  const result = parse(fixture("pudding/pudding.moss.json"));
  assert.equal(result.page.panels.length, 5);
  assert.equal(result.page.overlays.length, 1);
  assert.equal(result.page.overlays[0].character_id, "import_character_1");
  assert.equal(result.page.texts.length, 7);
  assert.ok(result.page.texts.some(item => item.text === "冰箱里的布丁\n是姐姐的宝贝" && item.bubble === "box"));
  assert.ok(result.page.texts.some(item => item.text === "是……是冰箱\n自己打开的！" && item.bubble === "shout"));
  assert.ok(result.page.texts.some(item => item.text === "吧唧" && item.kind === "sfx" && item.direction === "horizontal"));
  assert.deepEqual(collectImportedCharacterIds(result.page), ["import_character_1"]);
  assert.ok(result.warnings.some(message => message.includes("请映射")));
});

test("MOSS without coordinate flags warns and never infers the canvas from object extents", () => {
  const result = parseImportedPage(JSON.stringify({ summary: {}, items: [objectItem({ bbox: [-100, -100, 100, 100] })] }), { canvasWidth: 1200, canvasHeight: 2000 });
  assert.equal(result.page.canvas_width, 1200);
  assert.equal(result.page.canvas_height, 2000);
  assert.deepEqual(result.page.panels[0].shape, { type: "rect", x: 500, y: 900, w: 200, h: 200 });
  assert.ok(result.warnings.some(message => message.includes("bbox_coord_space")));
  assert.ok(result.warnings.some(message => message.includes("bbox_format")));
  assert.equal(result.needsCanvasSize, true);
  const explicit = parse({ ...moss([objectItem()]), canvas_width: 1024, canvas_height: 1536 });
  assert.equal(explicit.needsCanvasSize, false);
});

test("Explicit top-left xyxy and xywh rectangles preserve floating-point coordinates", () => {
  for (const [format, bbox] of [["xyxy", [20.123456, 30.654321, 120.777777, 230.888888]], ["xywh", [20.123456, 30.654321, 100.654321, 200.234567]]]) {
    const result = parse({ summary: {}, items: [objectItem({ bbox })], bbox_coord_space: "top_left_pixels", bbox_format: format });
    const box = result.page.panels[0].shape;
    assert.equal(box.x, bbox[0]); assert.equal(box.y, bbox[1]);
    assert.equal(box.w, format === "xyxy" ? bbox[2] - bbox[0] : bbox[2]);
    assert.equal(box.h, format === "xyxy" ? bbox[3] - bbox[1] : bbox[3]);
  }
});

test("MOSS rejects unknown coordinate conventions, malformed bounds, and unsupported labels with actionable errors", () => {
  assert.throws(() => parse({ ...moss([]), bbox_coord_space: "normalized_0_1" }), /不支持 bbox_coord_space/);
  assert.throws(() => parse({ ...moss([]), bbox_coord_space: "top_left_pixels", bbox_format: undefined }), /必须明确填写 bbox_format/);
  assert.throws(() => parse({ ...moss([]), bbox_format: "cxcywh" }), /不支持 bbox_format/);
  assert.throws(() => parse(moss([objectItem({ bbox: [-100, -100, -200, 100] })])), /宽高必须/);
  assert.throws(() => parse(moss([objectItem({ bbox: [-800, -450, -100, -50] })])), /超出.*画布/);
  assert.throws(() => parse(moss([objectItem({ label: "background" })])), /label.*不支持/);
});

test("Text imports prefer item.text, retain an intentional empty value, and warn instead of inventing missing prose", () => {
  const result = parse(moss([objectItem({ panel_id: "p" }),
    { label: "text", caption: 'Chinese text "wrong"', text: "真实台词", bbox: [-650, -400, -500, -300], panel_id: "p" },
    { label: "text", caption: 'Chinese text "not used"', text: "", bbox: [-650, -280, -500, -180] },
    { label: "text", caption: "A bubble with no recoverable actual text", bbox: [-450, -400, -300, -300] }
  ]));
  assert.deepEqual(result.page.texts.map(item => item.text), ["真实台词", "", ""]);
  assert.equal(result.page.texts[2].style_hint, "A bubble with no recoverable actual text");
  assert.ok(result.warnings.some(message => message.includes("空文字")));
});

test("Overlay metadata preserves ids, character references, and text parents regardless of item order", () => {
  const result = parse(moss([
    { label: "text", text_id: "speech", text: "先读这句", speaker_id: "actor", panel_id: "frame", caption: "speech", bbox: [-650, -400, -500, -300] },
    objectItem({ panel_id: "frame", character_ids: ["actor"] }),
    { label: "object", overlay_id: "portrait", character_id: "actor", panel_id: "frame", caption: "known overlay", bbox: [-600, -350, -200, -100] }
  ]));
  assert.equal(result.page.panels.length, 1);
  assert.equal(result.page.overlays[0].id, "portrait");
  assert.equal(result.page.overlays[0].panel_id, "frame");
  assert.equal(result.page.texts[0].panel_id, "frame");
  assert.deepEqual(collectImportedCharacterIds(result.page), ["actor"]);
});

test("Native missing bboxes and legacy items get editable boxes without losing explicit text or colliding ids", () => {
  const source = native();
  source.texts = [{ id: "p1-dialogue-1", text: "原有文字", panel_id: "p1", bbox: { type: "rect", x: 300, y: 70, w: 80, h: 150 } }, { id: "no-box", text: "自动排版", panel_id: "p1", bbox: null }];
  source.panels[0].dialogue = [{ speaker: "legacy-speaker", content: "迁移旁白", type: "narration", custom_dialogue: 7 }];
  const result = parse(source);
  assert.equal(result.page.texts.length, 3);
  assert.deepEqual(result.page.texts[0].bbox, source.texts[0].bbox);
  assert.ok(result.page.texts.every(item => item.bbox && item.bbox.w > 0 && item.bbox.h > 0));
  assert.equal(new Set(result.page.texts.map(item => item.id)).size, 3);
  const migrated = result.page.texts.find(item => item.text === "迁移旁白");
  assert.equal(migrated.kind, "narration"); assert.equal(migrated.bubble, "box");
  assert.equal(migrated.speaker_id, "legacy-speaker"); assert.equal(migrated.custom_dialogue, 7);
  assert.deepEqual(result.page.import_source.data, source);
});

test("Quad text auto-layout preserves exact original corners and warns that lettering needs review", () => {
  const source = native();
  source.panels[0].shape = { type: "quad", points: [[40.123456, 50.987654], [440.456789, 50.987654], [400.456789, 650.444444], [60.123456, 650.444444]] };
  source.panels[0].dialogue = ["旧版台词"];
  source.import_source = { retained: "original provenance" };
  const result = parse(source);
  assert.deepEqual(result.page.panels[0].shape, source.panels[0].shape);
  assert.deepEqual(result.page.import_source, source.import_source);
  assert.deepEqual(result.page.import_original_page, source);
  assert.ok(result.warnings.some(message => message.includes("四边形")));
});

test("64-bit seeds retain every digit in native metadata and the preserved MOSS source", () => {
  const nativeSource = JSON.stringify(native()).replace('"panels":', '"production":{"seed":3896687444318080379},"panels":');
  assert.equal(parse(nativeSource).page.production.seed, "3896687444318080379");
  const mossSource = JSON.stringify(moss([objectItem()])).replace('"summary":', '"seed":8925744111054236951,"summary":');
  assert.equal(parse(mossSource).page.import_source.data.seed, "8925744111054236951");
});

test("Character collection covers casts, independent figures, dialogue speakers, text speakers, and overlays once", () => {
  const page = parse(native()).page;
  page.panels[0].character_ids = ["cast", "shared"];
  page.panels[0].figures = [{ character_id: "figure", pose: "stand" }, { character_id: "shared", pose: "sit" }];
  page.panels[0].dialogue = [{ speaker_id: "dialogue", text: "hi" }, { speaker: "alias-speaker", text: "hello" }];
  page.texts = [{ id: "t", speaker_id: "text", text: "word" }];
  page.overlays = [{ id: "o", character_id: "overlay" }];
  assert.deepEqual(collectImportedCharacterIds(page), ["cast", "shared", "figure", "dialogue", "alias-speaker", "text", "overlay"]);
});

test("Explicit role mapping rewrites all references, skips only selected figures/overlays, and preserves joint metadata and original source", () => {
  const page = parse(native()).page;
  page.panels[0].character_ids = ["a", "b", "c"];
  page.panels[0].figures = [{ id: "a", character_id: "a", pose: "lie", editor: { view: "side", joints: { head: [42.123456, -16] }, custom: true } }, { id: "b", character_id: "b", pose: "run" }];
  page.panels[0].dialogue = [{ speaker_id: "b", text: "keep dialogue" }, { speaker: "a", content: "alias speaker" }];
  page.texts = [{ id: "t", speaker_id: "b", text: "keep prose" }];
  page.overlays = [{ id: "drop", character_id: "b" }, { id: "keep", character_id: "a", custom: "same" }];
  const before = structuredClone(page);
  const mapped = mapImportedCharacters(page, { a: "local", b: null, c: "local" });
  assert.deepEqual(mapped.panels[0].character_ids, ["local"]);
  assert.equal(mapped.panels[0].figures.length, 1);
  assert.equal(mapped.panels[0].figures[0].character_id, "local");
  assert.deepEqual(mapped.panels[0].figures[0].editor, before.panels[0].figures[0].editor);
  assert.equal(mapped.panels[0].dialogue[0].text, "keep dialogue");
  assert.equal(mapped.panels[0].dialogue[0].speaker_id, null);
  assert.equal(mapped.panels[0].dialogue[1].speaker, "local");
  assert.equal(mapped.texts[0].text, "keep prose"); assert.equal(mapped.texts[0].speaker_id, null);
  assert.deepEqual(mapped.overlays, [{ id: "keep", character_id: "local", custom: "same" }]);
  assert.deepEqual(mapped.import_original_page, before);
  assert.deepEqual(mapped.import_character_mapping, { a: "local", b: null, c: "local" });
  assert.deepEqual(page, before, "preview mapping must not mutate the unmodified import draft");
});

test("MOSS mapping keeps existing provenance and explicit skip removes the unresolved character without removing panels or text", () => {
  const page = parse(fixture("pudding/pudding.moss.json")).page;
  const source = structuredClone(page.import_source);
  const mapped = mapImportedCharacters(page, { import_character_1: null });
  assert.equal(mapped.panels.length, 5); assert.equal(mapped.texts.length, 7);
  assert.equal(mapped.overlays.length, 0);
  assert.deepEqual(mapped.import_source, source);
  assert.deepEqual(collectImportedCharacterIds(mapped), []);
});

test("Native advanced English captions stay intact and visibly warn that they take generation precedence", () => {
  const source = native();
  source.panels[0].caption_en = "A source-provided English scene caption";
  const result = parse(source);
  assert.equal(result.page.panels[0].caption_en, source.panels[0].caption_en);
  assert.ok(result.warnings.some(message => message.includes("1 格包含英文覆盖") && message.includes("修改主描述")));
});
