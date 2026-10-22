import assert from "node:assert/strict";
import test from "node:test";
import { getPanelCanvasPoint, getPanelEdgeHandlePoint, getPanelLocalPoints, getPanelShapeHandlePoint } from "../src/lib/panelGeometry.ts";
import { startPanelHandleDrag, updatePanelHandleDrag } from "../src/lib/panelHandleDrag.ts";
import { projectPageToSodaPage, sodaPageToProjectPage } from "../src/lib/project.ts";
import { useEditorStore } from "../src/lib/store.ts";

const points = [[50, 80], [650, 110], [610, 440], [70, 470]];
const fixture = () => ({ id: "quad-page", canvas_width: 1000, canvas_height: 1400, panel_gap: 20, reading_direction: "rtl", texts: [], panels: [
  { id: "quad", order: 1, shape: { type: "quad", points: structuredClone(points) }, character_ids: [], figures: [], description: "倾斜画格", caption_en: "", custom_metadata: { retain: true } }
] });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `expected ${expected}, got ${actual}`);

test("An irregular quad is rendered and translated with all four original Y coordinates", () => {
  const source = fixture(), project = sodaPageToProjectPage(source), panel = project.panels[0];
  assert.deepEqual(getPanelLocalPoints(panel).map(point => [point.x + panel.x, point.y + panel.y]), points);
  panel.x += 10;
  const saved = projectPageToSodaPage(project, source, new Set(["quad"]));
  assert.deepEqual(saved.panels[0].shape.points, [[60, 80], [660, 110], [620, 440], [80, 470]]);
  assert.deepEqual(saved.panels[0].custom_metadata, { retain: true });
  assert.deepEqual(source.panels[0].shape.points, points);
  const loaded = sodaPageToProjectPage(saved);
  assert.deepEqual(projectPageToSodaPage(loaded, saved, new Set()).panels[0].shape.points, saved.panels[0].shape.points);
});

test("Nonuniform quad resizing applies one affine transform to every vertex", () => {
  const source = fixture(), project = sodaPageToProjectPage(source), panel = project.panels[0];
  panel.x = 60; panel.y = 90; panel.width *= 2; panel.height *= 0.5;
  const saved = projectPageToSodaPage(project, source, new Set(["quad"]));
  assert.deepEqual(saved.panels[0].shape.points, [[60, 90], [1260, 105], [1180, 270], [100, 285]]);
});

test("Irregular quad corner and edge handles retain sloped Y coordinates and stable gesture origins", () => {
  for (const rotation of [0, 30, -45]) for (const handle of [
    ...["topLeft", "topRight", "bottomRight", "bottomLeft"].map(key => ({ kind: "corner", key })),
    ...["top", "right", "bottom", "left"].map(key => ({ kind: "edge", key }))
  ]) {
    const source = fixture(), panel = { ...sodaPageToProjectPage(source).panels[0], rotation };
    const localPoint = handle.kind === "corner" ? getPanelShapeHandlePoint(panel, handle.key) : getPanelEdgeHandlePoint(panel, handle.key);
    const pointer = getPanelCanvasPoint(panel, localPoint), gesture = startPanelHandleDrag(panel, handle, pointer);
    assert.equal(updatePanelHandleDrag(gesture, pointer).changed, false);
    const nextPointer = getPanelCanvasPoint(panel, { x: localPoint.x + 12, y: localPoint.y + 16 });
    const result = updatePanelHandleDrag(gesture, nextPointer), after = { ...panel, ...result.patch };
    assert.equal(result.changed, true);
    assert.deepEqual(updatePanelHandleDrag(gesture, nextPointer), result);
    assert.deepEqual(after.shape.points.map(([, y]) => y), panel.shape.points.map(([, y]) => y));
    const expectedHandle = handle.kind === "corner" ? getPanelShapeHandlePoint(after, handle.key) : getPanelEdgeHandlePoint(after, handle.key);
    const expectedWorld = getPanelCanvasPoint(after, expectedHandle);
    near(result.point.x, expectedWorld.x); near(result.point.y, expectedWorld.y);
    if (handle.kind === "edge" && ["top", "bottom"].includes(handle.key)) {
      const expectedPointer = getPanelCanvasPoint(panel, { x: localPoint.x, y: localPoint.y + 16 });
      near(result.point.x, expectedPointer.x); near(result.point.y, expectedPointer.y);
    }
    assert.deepEqual(source.panels[0].shape.points, points);
  }
});

test("Dragging and resizing an irregular quad survives editor undo, redo and source export", () => {
  const previous = useEditorStore.getState(), source = fixture();
  useEditorStore.setState({ sodaPage: source, activePageId: source.id, project: { id: "test", name: "test", activePageId: source.id, pages: [sodaPageToProjectPage(source)] },
    dirtyPanelIds: new Set(), dirtyBubbleIds: new Set(), historyPast: [], historyFuture: [], historyGroup: null, characters: [], objectFlags: {}, selections: [], selection: null });
  try {
    useEditorStore.getState().updatePanel("quad", { x: 60, width: 1200, height: 195 });
    assert.deepEqual(useEditorStore.getState().getEditableSource().panels[0].shape.points, [[60, 80], [1260, 95], [1180, 260], [100, 275]]);
    useEditorStore.getState().undo();
    assert.deepEqual(useEditorStore.getState().getEditableSource().panels[0].shape.points, points);
    useEditorStore.getState().redo();
    assert.deepEqual(useEditorStore.getState().getEditableSource().panels[0].shape.points, [[60, 80], [1260, 95], [1180, 260], [100, 275]]);
  } finally { clearTimeout(useEditorStore.getState().autoSaveTimer); useEditorStore.setState(previous, true); }
});
