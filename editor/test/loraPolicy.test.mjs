import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InspectorPanel from "../src/components/InspectorPanel.tsx";
import { sodaPageToProjectPage } from "../src/lib/project.ts";
import { useEditorStore } from "../src/lib/store.ts";

const pageFixture = () => ({ format: "soda-storyboard-page-v1", id: "lora-page", canvas_width: 1024, canvas_height: 1536,
  panel_gap: 20, reading_direction: "rtl", description: "屋顶", texts: [], panels: [
    { id: "p1", order: 1, shape: { type: "rect", x: 40, y: 40, w: 940, h: 600 }, character_ids: ["alice", "whale"], description: "她们在屋顶聊天" }
  ] });

test("page LoRA selection survives serialization, undo, redo, and returning to automatic", () => {
  const previous = useEditorStore.getState(), page = pageFixture();
  useEditorStore.setState({ sodaPage: page, activePageId: page.id,
    project: { id: "test", name: "test", activePageId: page.id, pages: [sodaPageToProjectPage(page)] },
    dirtyPanelIds: new Set(), dirtyBubbleIds: new Set(), historyPast: [], historyFuture: [], historyGroup: null,
    characters: [], objectFlags: {}, selections: [], selection: null });
  try {
    useEditorStore.getState().setPageLoraCharacter("alice");
    assert.equal(useEditorStore.getState().getEditableSource().lora_character, "alice");
    useEditorStore.getState().setPageLoraCharacter("none");
    assert.equal(useEditorStore.getState().getEditableSource().lora_character, "none");
    useEditorStore.getState().undo();
    assert.equal(useEditorStore.getState().getEditableSource().lora_character, "alice");
    useEditorStore.getState().redo();
    assert.equal(useEditorStore.getState().getEditableSource().lora_character, "none");
    useEditorStore.getState().setPageLoraCharacter(undefined);
    assert.equal(Object.hasOwn(useEditorStore.getState().getEditableSource(), "lora_character"), false);
  } finally { clearTimeout(useEditorStore.getState().autoSaveTimer); useEditorStore.setState(previous, true); }
});

test("page inspector offers automatic, none and only characters with LoRA, and displays LoRA information separately", () => {
  const previous = useEditorStore.getState(), page = pageFixture();
  const hydration = useEditorStore.getInitialState(), initialHydration = { ...hydration };
  const previousReact = globalThis.React; globalThis.React = React;
  useEditorStore.setState({ sodaPage: { ...page, lora_character: "none" }, characters: [
    { id: "alice", display_name: "爱丽丝", has_lora: true },
    { id: "whale", display_name: "鲸鱼娘", has_lora: true },
    { id: "guest", display_name: "客人", has_lora: false }
  ], characterDetails: { alice: { lora: { path: "alice.safetensors" } }, whale: { lora: { path: "whale.safetensors" } } },
  validationIssues: [{ severity: "info", code: "page_lora_info", message: "本页不使用 LoRA" }],
  selection: null, selections: [], project: { ...previous.project, pages: [sodaPageToProjectPage(page)] } });
  try {
    Object.assign(hydration, useEditorStore.getState());
    const html = renderToStaticMarkup(React.createElement(InspectorPanel));
    assert.match(html, /aria-label="本页 LoRA 角色"/);
    assert.match(html, /<option value="auto">自动<\/option>/);
    assert.match(html, /<option value="none" selected="">不使用<\/option>/);
    assert.match(html, /<option value="alice">爱丽丝<\/option>/);
    assert.match(html, /<option value="whale">鲸鱼娘<\/option>/);
    assert.doesNotMatch(html, /<option value="guest">/);
    assert.match(html, /data-severity="info"/);
    assert.match(html, /1 条说明/);
    assert.match(html, /本页不使用 LoRA/);
    assert.doesNotMatch(html, /条提醒|不同 LoRA|可能互相影响/);
  } finally { globalThis.React = previousReact; Object.assign(hydration, initialHydration); useEditorStore.setState(previous, true); }
});
