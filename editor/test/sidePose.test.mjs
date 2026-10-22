import assert from "node:assert/strict";
import test from "node:test";
import { cloneFigurePose, ensureFigureEditor, figureEditorBounds, generateRigPrimitives, withFigurePose } from "../src/lib/figureRig.ts";
import { applyFigurePoseInPanel } from "../src/lib/figures.ts";

const panel = { width: 545.4, height: 202.2 };
const figure = { character_id: "girl", pose: "stand", facing: "left", position: 0.5, editor: { version: 1, x: 270, y: 120, size: 140, style: "box", flip: true } };

test("The lying preset bends the arms and staggers bent legs instead of rotating a standing figure", () => {
  const pose = cloneFigurePose("lie");
  assert.ok(Math.abs(pose.lFoot[1] - pose.rFoot[1]) < 12, "feet should overlap in side projection");
  assert.ok(pose.rElbow[0] < pose.neck[0] && pose.rHand[0] > pose.rElbow[0], "near arm folds in front of the chest");
  assert.ok(pose.rKnee[1] > pose.rFoot[1], "near knee is slightly bent");
  const editor = withFigurePose(ensureFigureEditor(figure, panel), "lie");
  assert.equal(editor.view, "side");
  const side = generateRigPrimitives(editor), front = generateRigPrimitives({ ...editor, view: "front" });
  const span = torso => Math.hypot(torso.points[0][0] - torso.points[1][0], torso.points[0][1] - torso.points[1][1]);
  assert.ok(span(side[2]) < span(front[2]) / 2, "shoulders must be narrow in side projection");
  assert.ok(side[3].width < side[5].width, "far limbs are lighter than near limbs");
});

test("Applying a side lying pose keeps size and places it around the visible person", () => {
  const cropped = ensureFigureEditor({ ...figure, editor: { ...figure.editor, y: 340, size: 340 } }, panel);
  const before = figureEditorBounds(cropped);
  const next = applyFigurePoseInPanel(cropped, "lie", panel), after = figureEditorBounds(next);
  assert.equal(next.size, cropped.size);
  const visibleCenterY = (Math.max(0, Math.min(panel.height, before.y)) + Math.max(0, Math.min(panel.height, before.y + before.height))) / 2;
  assert.ok(Math.abs(after.y + after.height / 2 - visibleCenterY) < 1e-8);
  assert.ok(after.y < panel.height && after.y + after.height > 0, "pose must not disappear below the panel");
});

test("Saved side view survives JSON normalization while legacy and custom joints remain unchanged until reapplied", () => {
  const old = ensureFigureEditor({ ...figure, pose: "lie", editor: { ...figure.editor, joints: { rHand: [77, -9] } } }, panel);
  assert.equal(old.view, "front");
  assert.deepEqual(old.joints.rHand, [77, -9]);
  const next = applyFigurePoseInPanel(old, "lie", panel);
  const saved = JSON.parse(JSON.stringify(next));
  assert.deepEqual(ensureFigureEditor({ ...figure, pose: "lie", editor: saved }, panel), next);
  assert.deepEqual(old.joints.rHand, [77, -9]);
  assert.equal(withFigurePose(next, "stand").view, "front");
});
