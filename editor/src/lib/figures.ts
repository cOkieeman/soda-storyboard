import type { Figure, FigureEditor, FigureJointName, Panel, Primitive, ReadingDirection, SketchFigure, SodaPanel } from "../types";
import { ensureFigureEditor, figureEditorBounds, figureLocalToJoint, withFigurePose } from "./figureRig";

type Point = [number, number];
type FigurePanel = Pick<Panel, "x" | "y" | "width" | "height" | "sodaData">;
const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const closedLine = (primitive: Primitive): primitive is Extract<Primitive, { type: "line" }> => primitive.type === "line"
  && primitive.points.length >= 5
  && primitive.points[0][0] === primitive.points[primitive.points.length - 1][0]
  && primitive.points[0][1] === primitive.points[primitive.points.length - 1][1];

/** Keep a horizontal replacement near the visible person, including cropped legacy figures. */
export function applyFigurePoseInPanel(editor: FigureEditor, pose: string, panel: Pick<Panel, "width" | "height">): FigureEditor {
  const next = withFigurePose(editor, pose);
  if (pose !== "lie") return next;
  const before = figureEditorBounds(editor), after = figureEditorBounds(next);
  const clamp = (value: number, maximum: number) => Math.max(0, Math.min(maximum, value));
  const centerX = (clamp(before.x, panel.width) + clamp(before.x + before.width, panel.width)) / 2;
  const centerY = (clamp(before.y, panel.height) + clamp(before.y + before.height, panel.height)) / 2;
  return { ...next, x: next.x + centerX - (after.x + after.width / 2), y: next.y + centerY - (after.y + after.height / 2) };
}

/** Recover the displayed skeleton, including the non-uniform horizontal mapping used by old lying figures. */
function legacyJointEditor(initial: FigureEditor, figure: Figure, panel: FigurePanel, sketch: SketchFigure): FigureEditor | null {
  const head = sketch.primitives[0];
  const torsoIndex = sketch.primitives.findIndex(closedLine);
  const torso = sketch.primitives[torsoIndex];
  const neck = sketch.primitives[torsoIndex + 1];
  if (head?.type !== "circle" || !Number.isFinite(head.r) || head.r <= 0 || torsoIndex < 0
    || !torso || !closedLine(torso) || neck?.type !== "line" || neck.points.length !== 2) return null;
  // Directional face details precede the torso. An optional skirt is closed, and the chair follows both legs.
  const limbs = sketch.primitives.slice(torsoIndex + 2).filter((primitive): primitive is Extract<Primitive, { type: "line" }> =>
    primitive.type === "line" && primitive.points.length >= 3 && !closedLine(primitive));
  if (limbs.length < 4) return null;
  const shoulder = midpoint(torso.points[0], torso.points[1]);
  const hip = midpoint(torso.points[2], torso.points[3]);
  const torsoDirection: Point = [hip[0] - neck.points[1][0], hip[1] - neck.points[1][1]];
  const firstSide: Point = [torso.points[0][0] - shoulder[0], torso.points[0][1] - shoulder[1]];
  const firstIsLeft = (torsoDirection[0] * firstSide[1] - torsoDirection[1] * firstSide[0]) * (initial.flip ? -1 : 1) >= 0;
  const [leftArm, rightArm] = firstIsLeft ? limbs : [limbs[1], limbs[0]];
  const [leftLeg, rightLeg] = firstIsLeft ? limbs.slice(2) : [limbs[3], limbs[2]];
  const points: Record<FigureJointName, Point> = {
    head: [head.cx, head.cy], neck: neck.points[1], hip,
    lElbow: leftArm.points[1], lHand: leftArm.points[leftArm.points.length - 1],
    rElbow: rightArm.points[1], rHand: rightArm.points[rightArm.points.length - 1],
    lKnee: leftLeg.points[1], lFoot: leftLeg.points[leftLeg.points.length - 1],
    rKnee: rightLeg.points[1], rFoot: rightLeg.points[rightLeg.points.length - 1]
  };
  if (Object.values(points).some((point) => !point.every(Number.isFinite))) return null;
  const feet = midpoint(points.lFoot, points.rFoot);
  const xs = Object.values(points).map(([x]) => x);
  // A centered horizontal anchor keeps wide lying bodies inside the existing joint coordinate limits.
  const anchor: Point = [figure.pose === "lie" ? (Math.min(...xs) + Math.max(...xs)) / 2 : feet[0], feet[1]];
  const maxDistance = Math.max(...Object.values(points).flatMap(([x, y]) => [Math.abs(x - anchor[0]), Math.abs(y - anchor[1])]));
  const editor = { ...initial, x: anchor[0] - panel.x, y: anchor[1] - panel.y, size: Math.max(8, head.r / 0.085, maxDistance / 3) };
  return { ...editor, joints: Object.fromEntries(Object.entries(points).map(([name, [x, y]]) =>
    [name, figureLocalToJoint(editor, [x - panel.x, y - panel.y])])) as FigureEditor["joints"] };
}

/** Use the same legacy alignment for canvas handles, inspector edits and keyboard movement. */
export function editableFigureEditor(figure: Figure, panel: FigurePanel, sketch?: SketchFigure): FigureEditor {
  const initial = ensureFigureEditor(figure, { width: panel.width, height: panel.height, shot: panel.sodaData?.shot });
  if (figure.editor || !sketch?.primitives.length) return initial;
  const recovered = legacyJointEditor(initial, figure, panel, sketch);
  if (recovered) return recovered;
  const points = sketch.primitives.flatMap((primitive): [number, number][] => primitive.type === "circle"
    ? [[primitive.cx - primitive.r, primitive.cy - primitive.r], [primitive.cx + primitive.r, primitive.cy + primitive.r]]
    : primitive.points);
  if (!points.length) return initial;
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const current = figureEditorBounds(initial);
  if (current.height < 1) return initial;
  const sized = { ...initial, size: initial.size * (bottom - top) / current.height };
  const bounds = figureEditorBounds(sized);
  return { ...sized,
    x: sized.x + left - panel.x + (right - left) / 2 - (bounds.x + bounds.width / 2),
    y: sized.y + bottom - panel.y - (bounds.y + bounds.height)
  };
}

/** Read the implicit cast used by early pages without modifying their source data. */
export function resolvedFigures(
  panel: Pick<SodaPanel, "figures" | "character_ids">,
  readingDirection: ReadingDirection = "rtl"
): Figure[] {
  if (panel.figures?.length) return panel.figures;
  const characterIds = panel.character_ids || [];
  return characterIds.map((characterId, index) => ({
    character_id: characterId,
    pose: "stand",
    position: readingDirection === "rtl" ? 1 - (index + 0.5) / characterIds.length : (index + 0.5) / characterIds.length,
    facing: "front",
    framing: null
  }));
}
