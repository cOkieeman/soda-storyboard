import type { Figure, FigureEditor, FigureJointName, FigurePose, Primitive } from "../types";

export const JOINT_NAMES: FigureJointName[] = [
  "head", "neck", "hip", "lElbow", "lHand", "rElbow", "rHand", "lKnee", "lFoot", "rKnee", "rFoot"
];
export const JOINT_LABELS: Record<FigureJointName, string> = {
  head: "头部", neck: "颈部", hip: "腰部", lElbow: "左肘", lHand: "左手", rElbow: "右肘", rHand: "右手",
  lKnee: "左膝", lFoot: "左脚", rKnee: "右膝", rFoot: "右脚"
};
type Point = [number, number];
type Joints = FigureEditor["joints"];
const STAND: Joints = {
  head: [0, -91.5], neck: [0, -78], hip: [0, -51],
  lElbow: [-14, -61], lHand: [-17, -44], rElbow: [14, -61], rHand: [17, -44],
  lKnee: [-7, -28], lFoot: [-10, 0], rKnee: [7, -28], rFoot: [10, 0]
};
const preset = (updates: Partial<Joints> = {}): Joints => ({ ...STAND, ...updates });

/** Original geometry presets: two-person presets describe one side; mirror its partner. */
export const FIGURE_POSE_PRESETS: Record<FigurePose, Joints> = {
  stand: preset(), back_view: preset(),
  walk: preset({ lKnee: [-13, -30], lFoot: [-24, -6], rKnee: [12, -26], rFoot: [25, -14] }),
  run: preset({ lElbow: [-23, -62], lHand: [-31, -76], rElbow: [24, -88], rHand: [32, -77],
    lKnee: [-23, -31], lFoot: [-35, -40], rKnee: [24, -27], rFoot: [30, -4] }),
  sit: preset({ lKnee: [-24, -42], lFoot: [-23, -14], rKnee: [23, -42], rFoot: [24, -14] }),
  crouch: preset({ head: [-3, -72], neck: [-2, -58], hip: [9, -35],
    lElbow: [-17, -43], lHand: [-7, -25], rElbow: [23, -45], rHand: [25, -26],
    lKnee: [-17, -18], lFoot: [4, 0], rKnee: [27, -18], rFoot: [13, 0] }),
  wave: preset({ rElbow: [20, -72], rHand: [19, -96] }),
  point: preset({ rElbow: [23, -76], rHand: [38, -78] }),
  arms_up: preset({ lElbow: [-19, -87], lHand: [-24, -99], rElbow: [19, -87], rHand: [24, -99] }),
  hands_clasped: preset({ lElbow: [-16, -56], lHand: [0, -46], rElbow: [16, -56], rHand: [0, -46] }),
  hand_on_chin: preset({ rElbow: [20, -69], rHand: [2, -81] }),
  lie: {
    head: [42, -16], neck: [29, -13], hip: [1, -13],
    lElbow: [29, -4], lHand: [43, -3], rElbow: [23, 2], rHand: [38, 1],
    lKnee: [-20, -7], lFoot: [-45, -10], rKnee: [-18, 1], rFoot: [-40, -2]
  },
  handshake: preset({ rElbow: [21, -64], rHand: [33, -58] }),
  hug: preset({ lElbow: [14, -69], lHand: [34, -73], rElbow: [24, -61], rHand: [36, -62] })
};

const safeNumber = (value: unknown, fallback: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, typeof value === "number" && Number.isFinite(value) ? value : fallback));

export function cloneFigurePose(pose: string): Joints {
  const source = Object.prototype.hasOwnProperty.call(FIGURE_POSE_PRESETS, pose)
    ? FIGURE_POSE_PRESETS[pose as FigurePose] : FIGURE_POSE_PRESETS.stand;
  return Object.fromEntries(JOINT_NAMES.map((name) => [name, [...source[name]]])) as Joints;
}

export function getFigureId(figure: Figure, index: number): string {
  return figure.id || `legacy-figure-${index}`;
}

/** Normalize extension JSON without mutating it or implicitly migrating saved pages. */
export function ensureFigureEditor(figure: Figure, panel: { width: number; height: number; shot?: string }): FigureEditor {
  const width = safeNumber(panel.width, 300, 1, 100000);
  const height = safeNumber(panel.height, 400, 1, 100000);
  const framing = figure.framing || ({ extreme_long: "full", long: "full", full: "full", medium: "waist", close_up: "bust", extreme_close_up: "face" } as Record<string, string>)[panel.shot || "medium"] || "waist";
  const visible = ({ full: 1, waist: 0.59, bust: 0.43, face: 0.23 } as Record<string, number>)[framing] || 1;
  const size = Math.min(height * 0.84 / visible, width * 2.8);
  const positionMap: Record<string, number> = { left: 0.23, center: 0.5, right: 0.77 };
  const position = typeof figure.position === "number" ? safeNumber(figure.position, 0.5, -10, 10)
    : Object.prototype.hasOwnProperty.call(positionMap, figure.position) ? positionMap[figure.position] : 0.5;
  const raw = figure.editor && typeof figure.editor === "object" ? figure.editor : {} as Partial<FigureEditor>;
  const joints = cloneFigurePose(figure.pose);
  for (const name of JOINT_NAMES) {
    const value = raw.joints?.[name];
    if (Array.isArray(value) && value.length === 2) {
      joints[name] = [safeNumber(value[0], joints[name][0], -300, 300), safeNumber(value[1], joints[name][1], -300, 300)];
    }
  }
  return {
    version: 1,
    x: safeNumber(raw.x, width * position, -100000, 100000),
    y: safeNumber(raw.y, height * 0.16 + size, -100000, 100000),
    size: safeNumber(raw.size, size, 8, 20000),
    flip: typeof raw.flip === "boolean" ? raw.flip : figure.facing === "left",
    style: raw.style === "stick" || raw.style === "rough" || raw.style === "box" ? raw.style : "box",
    view: raw.view === "side" ? "side" : "front",
    break_frame: typeof raw.break_frame === "boolean" ? raw.break_frame : false,
    joints
  };
}

export function withFigurePose(editor: FigureEditor, pose: string): FigureEditor {
  return { ...editor, view: pose === "lie" ? "side" : "front", joints: cloneFigurePose(pose) };
}

export function figureJointToLocal(editor: FigureEditor, joint: FigureJointName | Point): Point {
  const [x, y] = typeof joint === "string" ? editor.joints[joint] : joint;
  return [editor.x + x * editor.size / 100 * (editor.flip ? -1 : 1), editor.y + y * editor.size / 100];
}

export function figureLocalToJoint(editor: FigureEditor, point: Point): Point {
  return [(point[0] - editor.x) * 100 / editor.size * (editor.flip ? -1 : 1), (point[1] - editor.y) * 100 / editor.size];
}

export function generateRigPrimitives(editor: FigureEditor, origin: Point = [0, 0]): Primitive[] {
  const result: Primitive[] = [];
  const scale = editor.size / 100;
  const stroke = Math.max(2, Math.floor(editor.size * 0.012 + 0.5));
  const thin = Math.max(1, Math.floor(stroke / 2));
  const at = (point: Point): Point => {
    const local = figureJointToLocal(editor, point);
    return [local[0] + origin[0], local[1] + origin[1]];
  };
  const line = (points: Point[], width = stroke) => result.push({ type: "line", points: points.map(at), width });
  const { head, neck, hip, lElbow, lHand, rElbow, rHand, lKnee, lFoot, rKnee, rFoot } = editor.joints;
  const length = Math.hypot(hip[0] - neck[0], hip[1] - neck[1]) || 1;
  const across: Point = [(hip[1] - neck[1]) / length, -(hip[0] - neck[0]) / length];
  const offset = (point: Point, amount: number): Point => [point[0] + across[0] * amount, point[1] + across[1] * amount];
  const side = editor.view === "side";
  const shoulderWidth = side ? 3.2 : 8.5, hipWidth = side ? 2.8 : 7;
  const leftShoulder = offset(neck, -shoulderWidth), rightShoulder = offset(neck, shoulderWidth);
  const leftHip = offset(hip, -hipWidth), rightHip = offset(hip, hipWidth);
  const [hx, hy] = at(head);
  const radius = 8.5 * scale;
  result.push({ type: "circle", cx: hx, cy: hy, r: radius, width: stroke, fill: null });
  const toNeck: Point = [neck[0] - head[0], neck[1] - head[1]];
  const headDistance = Math.hypot(...toNeck) || 1;
  line([[head[0] + toNeck[0] / headDistance * 8.5, head[1] + toNeck[1] / headDistance * 8.5], neck]);
  if (editor.style === "stick") {
    line([neck, hip]);
    line([leftShoulder, rightShoulder]);
  } else {
    result.push({ type: "polygon", points: [leftShoulder, rightShoulder, rightHip, leftHip].map(at), fill: null, width: stroke });
  }
  if (side) {
    line([leftShoulder, lElbow, lHand], thin);
    line([leftHip, lKnee, lFoot], thin);
    line([rightShoulder, rElbow, rHand]);
    line([rightHip, rKnee, rFoot]);
    const axis: Point = [(hip[0] - neck[0]) / length, (hip[1] - neck[1]) / length];
    const face = (along: number, cross: number): Point => [head[0] + axis[0] * along + across[0] * cross, head[1] + axis[1] * along + across[1] * cross];
    line([face(-3, 7.8), face(0, 10.5), face(2, 7.8)], thin);
    line([face(-4, 4), face(-1, 4)], thin);
  } else {
    line([leftShoulder, lElbow, lHand]);
    line([rightShoulder, rElbow, rHand]);
    line([leftHip, lKnee, lFoot]);
    line([rightHip, rKnee, rFoot]);
  }
  if (editor.style === "rough") {
    if (!side) {
      line([[head[0] - 7.5, head[1]], [head[0] + 7.5, head[1]]], thin);
      line([[head[0], head[1] - 7.5], [head[0], head[1] + 7.5]], thin);
    }
    for (const joint of [lElbow, rElbow, lKnee, rKnee]) {
      const [cx, cy] = at(joint);
      result.push({ type: "circle", cx, cy, r: 1.7 * scale, width: thin, fill: null });
    }
  }
  return result;
}

export function figureEditorBounds(editor: FigureEditor): { x: number; y: number; width: number; height: number } {
  const points: Point[] = [];
  for (const primitive of generateRigPrimitives(editor)) {
    const pad = (primitive.width || 0) / 2;
    if (primitive.type === "circle") {
      points.push([primitive.cx - primitive.r - pad, primitive.cy - primitive.r - pad], [primitive.cx + primitive.r + pad, primitive.cy + primitive.r + pad]);
    } else {
      for (const [x, y] of primitive.points) points.push([x - pad, y - pad], [x + pad, y + pad]);
    }
  }
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
