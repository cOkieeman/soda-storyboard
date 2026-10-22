import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useEditorStore } from "../src/lib/store.ts";
import { sodaPageToProjectPage, projectPageToSodaPage } from "../src/lib/project.ts";
import { deletePageSelections, selectionBounds } from "../src/lib/batchEditing.ts";
import PageSidebar from "../src/components/PageSidebar.tsx";
import InspectorPanel from "../src/components/InspectorPanel.tsx";
import { importExternalStoryboard } from "../src/lib/api.ts";

const source = () => ({ format: "soda-storyboard-page-v1", id: "live", canvas_mode: "single", canvas_width: 1024, canvas_height: 1536, reading_direction: "rtl", panel_gap: 0, description: "直播间", panels: [], texts: [], objects: [{ id: "lamp", caption: "A paper lantern", label: "object", panel_id: null, rect: { type: "rect", x: 100, y: 200, w: 80, h: 150 } }], moss_import: { entries: [{ kind: "passthrough", item: { label: "unknown", private: 17 } }] } });

test("Free-canvas object edits survive move, resize, undo, source export and deletion", () => {
  const previous = useEditorStore.getState(), page = source();
  useEditorStore.setState({ sodaPage: page, activePageId: page.id, project: { id: "test", name: "test", activePageId: page.id, pages: [sodaPageToProjectPage(page)] }, dirtyPanelIds: new Set(), dirtyBubbleIds: new Set(), historyPast: [], historyFuture: [], historyGroup: null, characters: [], objectFlags: {}, selection: { kind: "object", id: "lamp" }, selections: [{ kind: "object", id: "lamp" }] });
  try {
    useEditorStore.getState().moveSelection(10, 20);
    assert.deepEqual(useEditorStore.getState().getEditableSource().objects[0].rect, { type: "rect", x: 110, y: 220, w: 80, h: 150 });
    useEditorStore.getState().updateObjectBox("lamp", { caption: "A red lantern", rect: { type: "rect", x: 110, y: 220, w: 160, h: 200 } });
    const edited = useEditorStore.getState().getEditableSource();
    assert.equal(edited.objects[0].caption, "A red lantern");
    assert.equal(edited.objects[0].rect.w, 160);
    assert.deepEqual(edited.moss_import, page.moss_import);
    assert.deepEqual(selectionBounds(sodaPageToProjectPage(edited), edited, { kind: "object", id: "lamp" }), { x: 110, y: 220, width: 160, height: 200 });
    useEditorStore.getState().undo();
    assert.equal(useEditorStore.getState().getEditableSource().objects[0].rect.w, 80);
    useEditorStore.getState().redo();
    assert.equal(useEditorStore.getState().getEditableSource().objects[0].caption, "A red lantern");
    useEditorStore.getState().addTextPreset("speech_vertical");
    assert.equal(useEditorStore.getState().getEditableSource().texts[0].panel_id, null);
    assert.deepEqual(deletePageSelections(edited, [{ kind: "object", id: "lamp" }]).objects, []);
  } finally { clearTimeout(useEditorStore.getState().autoSaveTimer); useEditorStore.setState(previous, true); }
});

test("Object inspector has description/geometry and free-canvas instructions contain no first-panel prompt", () => {
  const previous = useEditorStore.getState(), hydration = useEditorStore.getInitialState(), saved = { ...hydration }, priorReact = globalThis.React;
  globalThis.React = React;
  const page = source();
  useEditorStore.setState({ sodaPage: page, activePageId: page.id, pages: [], project: { ...previous.project, pages: [sodaPageToProjectPage(page)] }, selection: { kind: "object", id: "lamp" }, selections: [{ kind: "object", id: "lamp" }], characters: [], characterDetails: {}, validationIssues: [] });
  const render = () => { Object.assign(hydration, useEditorStore.getState()); return renderToStaticMarkup(React.createElement(InspectorPanel)); };
  try {
    assert.match(render(), /物件框描述/);
    assert.match(render(), /物件框 w/);
    useEditorStore.setState({ selection: null, selections: [] });
    const html = render();
    assert.match(html, /单画布/);
    assert.doesNotMatch(html, /先建立第一个格子/);
    const sidebar = renderToStaticMarkup(React.createElement(PageSidebar));
    assert.match(sidebar, /A paper lantern/);
    assert.doesNotMatch(sidebar, /建立第一个格子|建立第一格/);
  } finally { globalThis.React = priorReact; Object.assign(hydration, saved); useEditorStore.setState(previous, true); }
});

test("External import UI calls the shared Python importer and retains its understanding report", async () => {
  const originalFetch = globalThis.fetch;
  let call;
  globalThis.fetch = async (url, options) => { call = { url, options }; return new Response(JSON.stringify({ page: source(), report: { guesses: ["推断画布"], warnings: [], unrecognized_items: [] } }), { headers: { "Content-Type": "application/json" } }); };
  try {
    const result = await importExternalStoryboard("| 画面 |\n| --- |\n| 一盏灯 |");
    assert.equal(call.url, "/api/import");
    assert.equal(JSON.parse(call.options.body).source.startsWith("| 画面"), true);
    assert.equal(result.page.canvas_mode, "single");
    assert.equal(result.report.guesses[0], "推断画布");
  } finally { globalThis.fetch = originalFetch; }
});


test("Untouched imported text does not acquire an explicit null tail during editor roundtrips", () => {
  const page = source();
  page.texts = [{id:"t1",text:"你好",kind:"dialogue",direction:"vertical",bubble:"none",panel_id:null,speaker_id:null,bbox:{type:"rect",x:100,y:200,w:60,h:120},style_hint:"Original style"}];
  const canvas = sodaPageToProjectPage(page);
  const saved = projectPageToSodaPage(canvas, page, new Set(), new Set());
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(saved)).texts[0], "tail_tip"), false);
});
