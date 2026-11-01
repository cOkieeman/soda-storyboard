import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useEditorStore } from "../src/lib/store.ts";
import { sodaPageToProjectPage } from "../src/lib/project.ts";
import InspectorPanel from "../src/components/InspectorPanel.tsx";

const page = () => ({ format: "soda-storyboard-page-v1", id: "grab", canvas_width: 1024, canvas_height: 1536, reading_direction: "rtl", panel_gap: 24, description: "", texts: [], objects: [],
  panels: [{ id: "p1", order: 1, shape: { type: "rect", x: 0, y: 0, w: 1024, h: 1536 }, shot: "medium", angle: "eye", character_ids: ["toki"], description: "", dialogue: [], sfx: [], figures: [{ id: "fig-a", character_id: "toki", pose: "stand", position: "center", facing: "front" }] }] });

test("Part boxes keep their owner, stay on the canvas and show owner and part in the inspector", () => {
  const previous = useEditorStore.getState(), hydration = useEditorStore.getInitialState(), saved = { ...hydration }, priorReact = globalThis.React, source = page();
  globalThis.React = React;
  useEditorStore.setState({ sodaPage: source, activePageId: source.id, project: { id: "test", name: "test", activePageId: source.id, pages: [sodaPageToProjectPage(source)] }, dirtyPanelIds: new Set(), dirtyBubbleIds: new Set(), historyPast: [], historyFuture: [], historyGroup: null, pages: [], characters: [{ id: "toki", display_name: "时", has_lora: false }], characterDetails: {}, validationIssues: [], objectFlags: {}, selection: null, selections: [] });
  try {
    useEditorStore.getState().addPartBox("p1", "fig-a", { x: 1000, y: -40, w: 120, h: 120 });
    const [box] = useEditorStore.getState().getEditableSource().objects;
    assert.equal(box.owner, "fig-a");
    assert.equal(box.panel_id, "p1");
    assert.equal(box.label, "character");
    assert.deepEqual(box.rect, { type: "rect", x: 904, y: 0, w: 120, h: 120 });
    assert.deepEqual(useEditorStore.getState().selection, { kind: "object", id: box.id });
    useEditorStore.getState().updateObjectBox(box.id, { part: "右手", caption: "抓住对方袖口" });
    Object.assign(hydration, useEditorStore.getState());
    const html = renderToStaticMarkup(React.createElement(InspectorPanel));
    assert.match(html, /局部框/);
    assert.match(html, /所属人物/);
    assert.match(html, /value="右手"/);
    useEditorStore.getState().undo();
    assert.equal(useEditorStore.getState().getEditableSource().objects[0].part, "");
  } finally { clearTimeout(useEditorStore.getState().autoSaveTimer); Object.assign(hydration, saved); useEditorStore.setState(previous, true); globalThis.React = priorReact; }
});
