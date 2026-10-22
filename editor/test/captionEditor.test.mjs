import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InspectorPanel from "../src/components/InspectorPanel.tsx";
import { usesCustomCaption } from "../src/components/PanelCaptionPreview.tsx";
import { previewPanelCaptions } from "../src/lib/api.ts";
import { parseImportedPage } from "../src/lib/importPage.ts";
import { sodaPageToProjectPage } from "../src/lib/project.ts";
import { useEditorStore } from "../src/lib/store.ts";

const fixture = () => ({ format: "soda-storyboard-page-v1", id: "draft-page", canvas_width: 1024, canvas_height: 1536, panel_gap: 20, reading_direction: "rtl", description: "分镜页", texts: [], panels: [
  { id: "p1", order: 2, shape: { type: "rect", x: 40, y: 80, w: 600, h: 400 }, character_ids: ["alice"], figures: [{ character_id: "alice", pose: "stand", facing: "front", position: "center" }], description: "新的中文描述", caption_en: "Existing English caption" }
] });

test("Legacy imports retain English captions without implicitly enabling an override", () => {
  const source = fixture(), page = parseImportedPage(JSON.stringify(source), { canvasWidth: 1024, canvasHeight: 1536 }).page;
  assert.equal(page.panels[0].caption_en, "Existing English caption");
  assert.equal(Boolean(page.legacy_caption_en), false);
  assert.equal(Boolean(page.panels[0].use_custom_caption), false);
  assert.equal(usesCustomCaption(page.panels[0], page), false);
  assert.equal(usesCustomCaption({ ...page.panels[0], use_custom_caption: true }, page), true);
  assert.equal(usesCustomCaption(page.panels[0], { ...page, legacy_caption_en: true }), true);
  assert.equal(usesCustomCaption({ ...page.panels[0], caption_en: "  ", use_custom_caption: true }, page), false);
});

test("Caption preview sends the unsaved page and abort signal to the read-only compiler endpoint", async () => {
  const originalFetch = globalThis.fetch, page = fixture(), controller = new AbortController();
  let call;
  globalThis.fetch = async (url, options) => {
    call = { url, options };
    return new Response(JSON.stringify({ panels: [{ panel_id: "p1", caption: "新的中文描述，中景，平视", custom_override: false }] }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await previewPanelCaptions("page /中文", page, controller.signal);
    assert.equal(call.url, "/api/pages/page%20%2F%E4%B8%AD%E6%96%87/caption-preview");
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.signal, controller.signal);
    assert.deepEqual(JSON.parse(call.options.body), { page });
    assert.equal(result[0].caption, "新的中文描述，中景，平视");
  } finally { globalThis.fetch = originalFetch; }
});

test("Override and page compatibility settings survive history and source serialization", () => {
  const previous = useEditorStore.getState(), page = fixture();
  useEditorStore.setState({ sodaPage: page, activePageId: page.id, project: { id: "test", name: "test", activePageId: page.id, pages: [sodaPageToProjectPage(page)] },
    dirtyPanelIds: new Set(), dirtyBubbleIds: new Set(), historyPast: [], historyFuture: [], historyGroup: null, characters: [], objectFlags: {}, selections: [], selection: null });
  try {
    useEditorStore.getState().updateSodaPanel("p1", { use_custom_caption: true });
    assert.equal(useEditorStore.getState().getEditableSource().panels[0].use_custom_caption, true);
    useEditorStore.getState().setLegacyCaptionMode(true);
    assert.equal(useEditorStore.getState().getEditableSource().legacy_caption_en, true);
    useEditorStore.getState().undo();
    assert.equal(Boolean(useEditorStore.getState().getEditableSource().legacy_caption_en), false);
    assert.equal(useEditorStore.getState().getEditableSource().panels[0].use_custom_caption, true);
    useEditorStore.getState().redo();
    assert.equal(useEditorStore.getState().getEditableSource().legacy_caption_en, true);
    useEditorStore.getState().updateSodaPanel("p1", { use_custom_caption: false });
    assert.equal(useEditorStore.getState().getEditableSource().panels[0].use_custom_caption, false);
  } finally { clearTimeout(useEditorStore.getState().autoSaveTimer); useEditorStore.setState(previous, true); }
});

test("Inspectors expose a read-only caption preview, explicit override and readable figure title", () => {
  const previous = useEditorStore.getState(), page = fixture();
  // Server rendering reads Zustand's initial hydration snapshot, not its current client snapshot.
  const hydration = useEditorStore.getInitialState(), initialHydration = { ...hydration };
  const previousReact = globalThis.React; globalThis.React = React;
  const render = () => { Object.assign(hydration, useEditorStore.getState()); return renderToStaticMarkup(React.createElement(InspectorPanel)); };
  useEditorStore.setState({ sodaPage: page, characters: [{ id: "alice", display_name: "爱丽丝" }], characterDetails: {}, validationIssues: [],
    selection: { kind: "panel", id: "p1" }, selections: [{ kind: "panel", id: "p1" }], project: { ...previous.project, pages: [sodaPageToProjectPage(page)] } });
  try {
    const panel = render();
    assert.match(panel, /aria-label="最终提示词预览" readonly=""/);
    assert.match(panel, /使用自定义提示词/);
    assert.doesNotMatch(panel, /自定义提示词覆盖生效/);
    useEditorStore.setState({ sodaPage: { ...page, panels: [{ ...page.panels[0], use_custom_caption: true }] } });
    const overridden = render();
    assert.match(overridden, /自定义提示词覆盖生效/);
    assert.match(overridden, /覆盖本格场景提示词；人物位置与姿势仍按编辑器编译，手写内容应与人物保持一致/);
    assert.doesNotMatch(overridden, /覆盖本格自动拼接的画面描述、镜头和人物信息/);
    useEditorStore.setState({ selection: { kind: "figure", id: "legacy-figure-0", panelId: "p1" }, selections: [{ kind: "figure", id: "legacy-figure-0", panelId: "p1" }] });
    const figure = render();
    assert.match(figure, /爱丽丝 · 第 2 格/);
    assert.doesNotMatch(figure, />legacy-figure-0</);
    useEditorStore.setState({ selection: null, selections: [] });
    assert.match(render(), /保持旧版英文提示词覆盖行为/);
  } finally { globalThis.React = previousReact; Object.assign(hydration, initialHydration); useEditorStore.setState(previous, true); }
});
