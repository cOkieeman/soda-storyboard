import assert from "node:assert/strict";
import test from "node:test";
import { JOINT_NAMES, FIGURE_POSE_PRESETS, ensureFigureEditor, figureJointToLocal, figureLocalToJoint, figureEditorBounds, generateRigPrimitives, cloneFigurePose, getFigureId } from "../src/lib/figureRig.ts";
import { generateFigureGeometry } from "../src/lib/sketchGeometry.ts";
import { editableFigureEditor } from "../src/lib/figures.ts";

const figure = { id: "figure-one", character_id: "girl", pose: "stand", position: "center", facing: "front", editor: { version: 1, x: 160, y: 270, size: 200, style: "box" } };
const panel = { width: 400, height: 600, shot: "full" };

function primitiveBounds(primitives) {
  const points = primitives.flatMap(p => p.type === "circle" ? [[p.cx - p.r, p.cy - p.r], [p.cx + p.r, p.cy + p.r]] : p.points);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}
function near(actual, expected, message = "point moved") {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-7, `${message}: ${value} !== ${expected[index]}`));
}

test("First legacy lying edits retain the long horizontal geometry instead of fitting only its height", () => {
  for (const shot of ["full", "medium"]) {
    const legacy = { character_id: "girl", pose: "lie", position: 0.3, facing: "front" };
    const projectPanel = { x: 40, y: 80, width: 920, height: 160, sodaData: { shot } };
    const sketch = generateFigureGeometry([920, 160], legacy, undefined, { shot, origin: [40, 80] });
    const editor = editableFigureEditor(legacy, projectPanel, sketch);
    const migrated = generateRigPrimitives(editor, [40, 80]);
    const before = primitiveBounds(sketch.primitives), after = primitiveBounds(migrated);
    assert.ok(Math.abs(after.left - before.left) < 0.01, `${shot}: left edge moved`);
    assert.ok(Math.abs(after.right - before.right) < 0.01, `${shot}: right edge moved`);
    assert.ok(Math.abs(after.top - before.top) < 0.01, `${shot}: top edge moved`);
    assert.ok(Math.abs(after.bottom - before.bottom) < 0.01, `${shot}: bottom edge moved`);
    near([migrated[0].cx, migrated[0].cy, migrated[0].r], [sketch.primitives[0].cx, sketch.primitives[0].cy, sketch.primitives[0].r]);
    assert.equal(legacy.editor, undefined);
  }
});

test("First legacy edits align to the displayed figure without migrating data on selection", () => {
  const legacy = { character_id: "girl", pose: "stand", position: 0.3, facing: "front" };
  const projectPanel = { x: 40, y: 80, width: 400, height: 600, sodaData: { shot: "full" } };
  const sketch = generateFigureGeometry([400, 600], legacy, undefined, { shot: "full", origin: [40, 80] });
  const editor = editableFigureEditor(legacy, projectPanel, sketch);
  const bounds = primitiveBounds(generateRigPrimitives(editor));
  const points = sketch.primitives.flatMap(p => p.type === "circle" ? [[p.cx - p.r, p.cy - p.r], [p.cx + p.r, p.cy + p.r]] : p.points);
  const centerX = (Math.min(...points.map(p => p[0])) + Math.max(...points.map(p => p[0]))) / 2 - 40;
  const bottomY = Math.max(...points.map(p => p[1])) - 80;
  assert.ok(Math.abs((bounds.left + bounds.right) / 2 - centerX) < 0.01);
  assert.ok(Math.abs(bounds.bottom - bottomY) < 0.01);
  assert.equal(legacy.editor, undefined);
});

test("Legacy joints retain their displayed positions across poses, framing, mirroring and skirt hints", () => {
  const cases = [];
  for (const pose of Object.keys(FIGURE_POSE_PRESETS)) {
    for (const shot of ["full", "medium"]) {
      for (const facing of ["front", "left", "right", "back"]) cases.push({ pose, shot, facing, width: 545.4, height: 202.20588235294116 });
    }
  }
  for (const { pose, shot, facing, width, height } of cases) {
    const legacy = { character_id: "girl", pose, position: 0.3, facing, framing: shot === "medium" ? "waist" : "full" };
    const projectPanel = { x: 100, y: 100, width, height, sodaData: { shot } };
    const sketch = generateFigureGeometry([width, height], legacy, { id: "girl", display_name: "Girl", figure_hint: "skirt" }, { shot, origin: [100, 100] });
    const source = JSON.stringify({ legacy, sketch });
    const editor = editableFigureEditor(legacy, projectPanel, sketch);
    const normalized = ensureFigureEditor({ ...legacy, editor: JSON.parse(JSON.stringify(editor)) }, { width, height, shot });
    const before = generateRigPrimitives(editor, [100, 100]), after = generateRigPrimitives(normalized, [100, 100]);
    near([before[0].cx, before[0].cy, before[0].r], [sketch.primitives[0].cx, sketch.primitives[0].cy, sketch.primitives[0].r], `${pose}/${shot}/${facing} head`);
    assert.deepEqual(after, before, `${pose}/${shot}/${facing} changed after normalization`);
    const torsoIndex = sketch.primitives.findIndex(p => p.type === "line" && p.points.length === 5 && p.points[0][0] === p.points[4][0] && p.points[0][1] === p.points[4][1]);
    const oldLimbs = sketch.primitives.slice(torsoIndex + 2).filter(p => p.type === "line" && p.points.length >= 3 && p.points.length !== 5).slice(0, 4);
    const oldEnds = oldLimbs.flatMap(p => [p.points[1], p.points.at(-1)]);
    for (const joint of ["lElbow", "lHand", "rElbow", "rHand", "lKnee", "lFoot", "rKnee", "rFoot"]) {
      const local = figureJointToLocal(editor, joint), point = [local[0] + 100, local[1] + 100];
      assert.ok(oldEnds.some(([x, y]) => Math.hypot(x - point[0], y - point[1]) < 1e-7), `${pose}/${shot}/${facing} ${joint} detached`);
    }
    const moved = { ...editor, joints: { ...editor.joints, rHand: [editor.joints.rHand[0] + 2, editor.joints.rHand[1] + 1] } };
    for (const joint of JOINT_NAMES.filter(name => name !== "rHand")) near(figureJointToLocal(moved, joint), figureJointToLocal(editor, joint), `${pose} unrelated ${joint}`);
    assert.deepEqual(generateRigPrimitives(moved)[0], generateRigPrimitives(editor)[0], `${pose} head changed on hand drag`);
    assert.equal(JSON.stringify({ legacy, sketch }), source);
  }
});

test("Saved figure anchors, scales and joint edits define the same geometry after refresh", () => {
  const edited = { ...figure, editor: { ...figure.editor, joints: { rHand: [55, -30] }, break_frame: true } };
  const before = generateFigureGeometry([400, 600], edited, undefined, { shot: "full", origin: [10, 20] });
  const after = generateFigureGeometry([400, 600], JSON.parse(JSON.stringify(edited)), undefined, { shot: "full", origin: [10, 20] });
  assert.deepEqual(after, before);
  assert.equal(before.break_frame, true);
  assert.deepEqual(before.primitives[4].points.at(-1), [280, 230]);
});

test("Joint handles use an invertible panel-local transform including horizontal flips", () => {
  for (const flip of [false, true]) {
    const editor = ensureFigureEditor({ ...figure, editor: { ...figure.editor, flip } }, panel);
    const point = figureJointToLocal(editor, "rHand");
    assert.deepEqual(figureLocalToJoint(editor, point), editor.joints.rHand);
    const head = generateRigPrimitives(editor)[0];
    assert.deepEqual([head.cx, head.cy, head.r], [160, 87, 17]);
    const bounds = figureEditorBounds(editor);
    assert.ok(bounds.width > 0 && bounds.height > 0);
  }
});

test("Presets cover every pose, expose 11 handles, and cloning avoids shared joint mutations", () => {
  assert.equal(Object.keys(FIGURE_POSE_PRESETS).length, 14);
  for (const pose of Object.keys(FIGURE_POSE_PRESETS)) {
    assert.equal(Object.keys(cloneFigurePose(pose)).length, JOINT_NAMES.length);
    for (const style of ["stick", "box", "rough"]) {
      const editor = ensureFigureEditor({ ...figure, pose, editor: { ...figure.editor, style } }, panel);
      assert.ok(generateRigPrimitives(editor).length >= 7);
    }
  }
  cloneFigurePose("stand").head[0] = 99;
  assert.equal(cloneFigurePose("stand").head[0], 0);
  assert.deepEqual(cloneFigurePose("constructor"), cloneFigurePose("stand"));
  assert.deepEqual(cloneFigurePose("toString"), cloneFigurePose("stand"));
  assert.equal(ensureFigureEditor({ ...figure, pose: "constructor", position: "constructor", editor: {} }, panel).x, 200);
  assert.equal(getFigureId(figure, 0), "figure-one");
  assert.equal(getFigureId({ ...figure, id: undefined }, 2), "legacy-figure-2");
});

test("Malformed extensions are normalized without modifying source JSON", () => {
  for (const raw of [false, "bad", [], { joints: "bad" }, { x: NaN, y: Infinity, size: -20, joints: { head: [NaN, "bad"], hip: [] } }]) {
    const editor = ensureFigureEditor({ ...figure, editor: raw }, panel);
    assert.ok(Number.isFinite(editor.x) && Number.isFinite(editor.y));
    assert.ok(editor.size >= 8);
    assert.ok(JOINT_NAMES.every((name) => editor.joints[name].every(Number.isFinite)));
  }
  const before = JSON.stringify(figure);
  ensureFigureEditor(figure, panel).joints.head[0] = 9;
  assert.equal(JSON.stringify(figure), before);
});
