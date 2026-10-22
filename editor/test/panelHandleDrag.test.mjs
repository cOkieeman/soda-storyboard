import assert from "node:assert/strict";
import test from "node:test";
import { getPanelCanvasPoint, getPanelLocalPoint } from "../src/lib/panelGeometry.ts";
import { startPanelHandleDrag, updatePanelHandleDrag } from "../src/lib/panelHandleDrag.ts";

const corners = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
const edges = ["top", "right", "bottom", "left"];
const handles = [...corners.map(key => ({ kind: "corner", key })), ...edges.map(key => ({ kind: "edge", key }))];
const rotations = [0, 30, 90, -45];
const clone = value => JSON.parse(JSON.stringify(value));
const near = (actual, expected, message = "coordinate") => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: expected ${expected}, received ${actual}`);
const nearPoint = (actual, expected, message = "point") => { near(actual.x, expected.x, `${message}.x`); near(actual.y, expected.y, `${message}.y`); };
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
function fixture(rotation = 0) {
  return {
    id: "panel-drag", order: 1, x: 300.125, y: 250.75, width: 500.5, height: 350.25, rotation,
    shape: { topLeft: 0.1, topRight: 0.9, bottomRight: 1.1, bottomLeft: -0.1 },
    borderWidth: 2, borderColor: "#171815", borderRadius: 0, gap: 12,
    sodaData: { id: "panel-drag", custom_metadata: { retain: true } }
  };
}
function vector(panel, point) {
  const radians = panel.rotation * Math.PI / 180;
  return { x: point.x * Math.cos(radians) - point.y * Math.sin(radians), y: point.x * Math.sin(radians) + point.y * Math.cos(radians) };
}
function world(panel, point) {
  const delta = vector(panel, { x: point.x - panel.width / 2, y: point.y - panel.height / 2 });
  return { x: panel.x + panel.width / 2 + delta.x, y: panel.y + panel.height / 2 + delta.y };
}
function localHandle(panel, handle) {
  const shape = panel.shape, width = panel.width, height = panel.height;
  if (handle.kind === "corner") return { x: shape[handle.key] * width, y: handle.key.startsWith("top") ? 0 : height };
  if (handle.key === "top") return { x: (shape.topLeft + shape.topRight) * width / 2, y: 0 };
  if (handle.key === "bottom") return { x: (shape.bottomLeft + shape.bottomRight) * width / 2, y: height };
  if (handle.key === "left") return { x: (shape.topLeft + shape.bottomLeft) * width / 2, y: height / 2 };
  return { x: (shape.topRight + shape.bottomRight) * width / 2, y: height / 2 };
}
function nearGeometry(actual, expected, label) {
  for (const key of ["x", "y", "width", "height"]) near(actual[key], expected[key], `${label}.${key}`);
  for (const key of corners) near(actual.shape[key], expected.shape[key], `${label}.shape.${key}`);
}

test("Panel local conversion inverts translated and rotated page coordinates", () => {
  const panel = { ...fixture(90), x: 100, y: 200, width: 300, height: 400 };
  nearPoint(getPanelCanvasPoint(panel, { x: 0, y: 0 }), { x: 450, y: 250 }, "known rotated origin");
  nearPoint(getPanelLocalPoint(panel, { x: 450, y: 250 }), { x: 0, y: 0 }, "known inverse origin");
  for (const rotation of rotations) for (const local of [{ x: 0, y: 0 }, { x: -30.25, y: 415.625 }, { x: 207.125, y: -18.75 }]) {
    const current = fixture(rotation);
    nearPoint(getPanelLocalPoint(current, world(current, local)), local, `rotation ${rotation}`);
  }
});

test("All eight handles preserve off-center grab offsets and follow the permitted local delta after rotation", () => {
  for (const rotation of rotations) for (const handle of handles) {
    const panel = fixture(rotation), before = clone(panel), anchor = localHandle(panel, handle);
    const grab = world(panel, add(anchor, { x: 4.25, y: -3.125 }));
    const localDelta = { x: 18.5, y: 19.25 };
    const result = updatePanelHandleDrag(startPanelHandleDrag(panel, handle, grab), add(grab, vector(panel, localDelta)));
    const horizontal = handle.kind === "corner" || handle.key === "left" || handle.key === "right";
    const permitted = horizontal ? { x: localDelta.x, y: 0 } : { x: 0, y: localDelta.y };
    const label = `${rotation} ${handle.kind} ${handle.key}`;
    nearPoint(result.point, world(panel, add(anchor, permitted)), label);
    assert.equal(result.changed, true, label);
    const after = { ...panel, ...result.patch };
    nearPoint(world(after, localHandle(after, handle)), result.point, `${label} updated anchor`);
    assert.deepEqual(panel, before, `${label} must not mutate the original page`);
    if (horizontal) {
      for (const key of ["x", "y", "width", "height"]) near(after[key], panel[key], `${label}.${key}`);
      const changed = handle.kind === "corner" ? [handle.key] : handle.key === "left" ? ["topLeft", "bottomLeft"] : ["topRight", "bottomRight"];
      for (const key of corners) near(after.shape[key], panel.shape[key] + (changed.includes(key) ? localDelta.x / panel.width : 0), `${label}.shape.${key}`);
    } else near(after.height, panel.height + (handle.key === "top" ? -localDelta.y : localDelta.y), `${label}.height`);
  }
});

test("An unchanged pointer or movement along a constrained axis does not create an edit", () => {
  for (const rotation of rotations) for (const handle of handles) {
    const panel = fixture(rotation), anchor = localHandle(panel, handle), grab = world(panel, add(anchor, { x: -5, y: 3 }));
    const gesture = startPanelHandleDrag(panel, handle, grab);
    for (const movement of [{ x: 0, y: 0 }, handle.kind === "corner" || handle.key === "left" || handle.key === "right" ? { x: 0, y: 28 } : { x: 28, y: 0 }]) {
      const result = updatePanelHandleDrag(gesture, add(grab, vector(panel, movement)));
      assert.equal(result.changed, false, `${rotation} ${handle.kind} ${handle.key}`);
      nearGeometry({ ...panel, ...result.patch }, panel, "unchanged panel");
      nearPoint(result.point, world(panel, anchor), "unchanged handle");
    }
  }
});

test("Repeated top-edge updates, intermediate frames and mouse-up use one immutable starting baseline", () => {
  for (const rotation of rotations) {
    const panel = fixture(rotation), handle = { kind: "edge", key: "top" }, anchor = localHandle(panel, handle);
    const grab = world(panel, add(anchor, { x: 3, y: 5 }));
    const gesture = startPanelHandleDrag(panel, handle, grab), target = add(grab, vector(panel, { x: 0, y: 35.125 }));
    const expected = updatePanelHandleDrag(gesture, target);
    near(({ ...panel, ...expected.patch }).height, panel.height - 35.125, "single final height");
    for (let step = 1; step <= 12; step++) updatePanelHandleDrag(gesture, add(grab, vector(panel, { x: 0, y: step * 35.125 / 12 })));
    for (let frame = 0; frame < 10; frame++) {
      const result = updatePanelHandleDrag(gesture, target);
      nearGeometry({ ...panel, ...result.patch }, { ...panel, ...expected.patch }, "stationary pointer");
      nearPoint(result.point, expected.point, "stationary anchor");
      assert.equal(result.changed, true);
    }
    const copy = fixture(rotation), pointer = world(copy, localHandle(copy, { kind: "corner", key: "topLeft" }));
    const snapshot = startPanelHandleDrag(copy, { kind: "corner", key: "topLeft" }, pointer);
    const endpoint = add(pointer, vector(copy, { x: 17.75, y: 0 }));
    const first = updatePanelHandleDrag(snapshot, endpoint);
    copy.x += 999; copy.y -= 100; copy.width *= 2; copy.shape.topRight = 1.7; pointer.x += 800;
    assert.deepEqual(updatePanelHandleDrag(snapshot, endpoint), first, "draft/source or pointer mutation must not change the captured gesture");
  }
});

test("Top and bottom resizing keeps opposite world endpoints fixed and clamps height to 24", () => {
  for (const rotation of rotations) for (const key of ["top", "bottom"]) {
    const panel = fixture(rotation), handle = { kind: "edge", key }, grab = world(panel, localHandle(panel, handle));
    const gesture = startPanelHandleDrag(panel, handle, grab);
    for (const amount of [40.375, 10000]) {
      const deltaY = key === "top" ? amount : -amount;
      const result = updatePanelHandleDrag(gesture, add(grab, vector(panel, { x: 18, y: deltaY })));
      const after = { ...panel, ...result.patch };
      near(after.height, Math.max(24, panel.height - amount), "clamped height");
      near(after.width, panel.width, "preserved width");
      for (const corner of key === "top" ? ["bottomLeft", "bottomRight"] : ["topLeft", "topRight"]) {
        const cornerHandle = { kind: "corner", key: corner };
        nearPoint(world(after, localHandle(after, cornerHandle)), world(panel, localHandle(panel, cornerHandle)), `${rotation} ${key} fixed ${corner}`);
      }
      nearPoint(result.point, world(after, localHandle(after, handle)), "clamped handle follows resulting edge");
    }
  }
});

test("Corner crossing preserves the opposite corner, a 24-unit edge span and shape bounds", () => {
  for (const rotation of rotations) for (const key of corners) {
    const panel = { ...fixture(rotation), shape: { topLeft: 0, topRight: 1, bottomRight: 1, bottomLeft: 0 } };
    const handle = { kind: "corner", key }, anchor = localHandle(panel, handle), grab = world(panel, anchor);
    const gesture = startPanelHandleDrag(panel, handle, grab), isLeft = key.endsWith("Left");
    const result = updatePanelHandleDrag(gesture, add(grab, vector(panel, { x: isLeft ? 10000 : -10000, y: 35 })));
    const after = { ...panel, ...result.patch }, isTop = key.startsWith("top");
    const startKey = isTop ? "topLeft" : "bottomLeft", endKey = isTop ? "topRight" : "bottomRight";
    near((after.shape[endKey] - after.shape[startKey]) * panel.width, 24, `${rotation} ${key} minimum span`);
    for (const other of corners.filter(other => other !== key)) near(after.shape[other], panel.shape[other], `unchanged ${other}`);
    nearPoint(result.point, world(after, localHandle(after, handle)), "crossing clamp point");
    const outside = updatePanelHandleDrag(gesture, add(grab, vector(panel, { x: isLeft ? -10000 : 10000, y: 0 })));
    near(({ ...panel, ...outside.patch }).shape[key], isLeft ? -1 : 2, `${key} outer bound`);
  }
});
