/**
 * Client-side Stick Figure Geometry Generator.
 * Provides 100% deterministic visual parity with backend figures.py (soda_storyboard.figures)
 * for immediate, zero-latency canvas updates during figure editing, pose/facing switching,
 * figure addition, and overlay character display.
 */

import type {
  CharacterSummary,
  Figure,
  Primitive,
  SketchFigure,
  SketchGeometry,
  SketchPanel,
  SodaOverlay,
  SodaPage
} from "../types";

export const POSES = [
  "stand",
  "walk",
  "run",
  "sit",
  "crouch",
  "wave",
  "point",
  "arms_up",
  "hands_clasped",
  "hand_on_chin",
  "lie",
  "back_view"
] as const;

export const FRAMINGS: Record<string, string> = {
  extreme_long: "full",
  long: "full",
  full: "full",
  medium: "waist",
  close_up: "bust",
  extreme_close_up: "face"
};

export const POSITIONS: Record<string, number> = {
  left: 0.23,
  center: 0.5,
  right: 0.77
};

export function figureFraming(figure: Figure, shot: string): string {
  return figure.framing || FRAMINGS[shot] || "waist";
}

/**
 * Generate stick figure geometry for a single figure in a panel or overlay rectangle.
 */
export function generateFigureGeometry(
  size: [number, number],
  figure: Figure,
  character: CharacterSummary | undefined,
  options: {
    shot?: string;
    color?: string;
    origin?: [number, number];
  } = {}
): SketchFigure {
  const [width, height] = size;
  const shot = options.shot || "medium";
  const color = options.color || "#00a8c4";
  const [ox, oy] = options.origin || [0, 0];

  const primitives: Primitive[] = [];

  const framing = figureFraming(figure, shot);
  const visibleMap: Record<string, number> = { full: 1, waist: 0.59, bust: 0.43, face: 0.23 };
  const visible = visibleMap[framing] || 1;
  const unit = Math.min((height * 0.84) / visible, width * 2.8);

  let positionVal = 0.5;
  if (typeof figure.position === "string") {
    positionVal = POSITIONS[figure.position] ?? 0.5;
  } else if (typeof figure.position === "number") {
    positionVal = figure.position;
  }

  const cx = width * positionVal;
  const top = height * 0.16;
  const pose = POSES.includes(figure.pose as any) ? figure.pose : "stand";
  const mirror = figure.facing === "left" ? -1 : 1;

  function point(x: number, y: number): [number, number] {
    if (pose === "lie") {
      return [
        width * 0.12 + y * width * 0.76,
        height * 0.52 + x * height * 0.7
      ];
    }
    return [cx + x * unit * mirror, top + y * unit];
  }

  const stroke = Math.max(3, Math.round(Math.min(width, height) * 0.015));
  const thinStroke = Math.max(2, Math.floor(stroke / 2));

  function addLine(points: [number, number][], thin = false) {
    primitives.push({
      type: "line",
      points: points.map(([x, y]) => point(x, y)),
      width: thin ? thinStroke : stroke
    });
  }

  // Head and directional cross
  const [hx, hy] = point(0, 0.10);
  const radius = Math.min(unit * 0.085, width * 0.24);

  primitives.push({
    type: "circle",
    cx: hx,
    cy: hy,
    r: radius,
    width: stroke,
    fill: null
  });

  const back = figure.facing === "back" || pose === "back_view";
  const faceOffset = figure.facing === "front" || figure.facing === "back" ? 0 : radius * 0.45 * mirror;

  // Head cross
  primitives.push({
    type: "line",
    points: [[hx - radius * 0.9, hy], [hx + radius * 0.9, hy]],
    width: thinStroke
  });
  primitives.push({
    type: "line",
    points: [[hx + faceOffset, hy - radius * 0.9], [hx + faceOffset, hy + radius * 0.9]],
    width: thinStroke
  });

  if (back) {
    const arcPoints: [number, number][] = [];
    const rx = radius * 0.7;
    const ry = radius * 0.75;
    const cy = hy - radius * 0.05;
    for (let i = 0; i <= 24; i++) {
      const angle = ((185 + ((355 - 185) * i) / 24) * Math.PI) / 180;
      arcPoints.push([hx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
    }
    primitives.push({
      type: "line",
      points: arcPoints,
      width: stroke
    });
  } else if (figure.facing === "left" || figure.facing === "right") {
    const noseX = hx + radius * mirror;
    primitives.push({
      type: "line",
      points: [
        [noseX, hy],
        [noseX + radius * 0.27 * mirror, hy + radius * 0.2]
      ],
      width: stroke
    });
  } else {
    // Front facing eyes
    for (const dx of [-0.35, 0.35]) {
      primitives.push({
        type: "circle",
        cx: hx + radius * dx,
        cy: hy - 1,
        r: 2,
        width: 0,
        fill: color
      });
    }
  }

  // Torso
  const torso: [number, number][] =
    pose === "crouch"
      ? [
          [-0.10, 0.27],
          [0.06, 0.22],
          [0.16, 0.44],
          [0.02, 0.49],
          [-0.10, 0.27]
        ]
      : [
          [-0.085, 0.22],
          [0.085, 0.22],
          [0.07, 0.49],
          [-0.07, 0.49],
          [-0.085, 0.22]
        ];
  addLine(torso);
  addLine([[0, 0.18], [0, 0.22]]);

  // Arms
  const armsMap: Record<string, [number, number][][]> = {
    wave: [
      [[-0.085, 0.23], [-0.18, 0.36], [-0.19, 0.52]],
      [[0.085, 0.23], [0.20, 0.28], [0.19, 0.04]]
    ],
    point: [
      [[-0.085, 0.23], [-0.16, 0.40], [-0.14, 0.54]],
      [[0.085, 0.23], [0.23, 0.24], [0.38, 0.22]]
    ],
    arms_up: [
      [[-0.085, 0.23], [-0.19, 0.13], [-0.24, 0.01]],
      [[0.085, 0.23], [0.19, 0.13], [0.24, 0.01]]
    ],
    hands_clasped: [
      [[-0.085, 0.23], [-0.16, 0.44], [0, 0.54]],
      [[0.085, 0.23], [0.16, 0.44], [0, 0.54]]
    ],
    hand_on_chin: [
      [[-0.085, 0.23], [-0.17, 0.40], [-0.14, 0.53]],
      [[0.085, 0.23], [0.20, 0.31], [0.13, 0.19], [0.02, 0.19]]
    ],
    run: [
      [[-0.085, 0.23], [-0.23, 0.38], [-0.31, 0.24]],
      [[0.085, 0.23], [0.24, 0.12], [0.32, 0.23]]
    ]
  };
  const arms = armsMap[pose] || [
    [[-0.085, 0.23], [-0.14, 0.39], [-0.17, 0.56]],
    [[0.085, 0.23], [0.14, 0.39], [0.17, 0.56]]
  ];
  for (const arm of arms) {
    addLine(arm);
  }

  // Legs
  const legsMap: Record<string, [number, number][][]> = {
    walk: [
      [[-0.04, 0.49], [-0.13, 0.70], [-0.24, 0.94]],
      [[0.04, 0.49], [0.12, 0.74], [0.25, 0.86]]
    ],
    run: [
      [[-0.04, 0.49], [-0.23, 0.69], [-0.35, 0.60]],
      [[0.04, 0.49], [0.24, 0.73], [0.30, 0.96]]
    ],
    sit: [
      [[-0.04, 0.49], [-0.24, 0.58], [-0.23, 0.86]],
      [[0.04, 0.49], [0.23, 0.58], [0.24, 0.86]]
    ],
    crouch: [
      [[0.03, 0.48], [-0.17, 0.62], [0.04, 0.75]],
      [[0.10, 0.46], [0.27, 0.62], [0.13, 0.75]]
    ]
  };
  const legs = legsMap[pose] || [
    [[-0.04, 0.49], [-0.07, 0.72], [-0.10, 0.96]],
    [[0.04, 0.49], [0.07, 0.72], [0.10, 0.96]]
  ];

  // Skirt hint
  if (character?.figure_hint === "skirt") {
    addLine([
      [-0.07, 0.42],
      [0.07, 0.42],
      [0.15, 0.65],
      [-0.15, 0.65],
      [-0.07, 0.42]
    ]);
  }

  for (const leg of legs) {
    addLine(leg);
  }

  if (pose === "sit") {
    addLine([[-0.27, 0.59], [0.27, 0.59], [0.27, 0.88]], true);
  }

  // Apply origin offset to coordinates
  for (const item of primitives) {
    if (item.type === "circle") {
      item.cx += ox;
      item.cy += oy;
    } else {
      item.points = item.points.map(([px, py]) => [px + ox, py + oy]);
    }
  }

  const name = character?.display_name || figure.character_id;
  return {
    character_id: figure.character_id,
    label: name,
    color,
    primitives,
    label_at: [ox + cx, oy + Math.max(2, height * 0.02)]
  };
}

/**
 * Generate full SketchGeometry for a SodaPage using local state.
 */
export function generatePageSketchGeometry(
  sodaPage: SodaPage,
  characters: CharacterSummary[]
): SketchGeometry {
  const charMap = new Map<string, CharacterSummary>();
  for (const c of characters) {
    charMap.set(c.id, c);
  }

  const panels: SketchPanel[] = sodaPage.panels.map((panel) => {
    let x = 0;
    let y = 0;
    let w = 100;
    let h = 100;
    let clip: [number, number][] = [];

    if (panel.shape.type === "rect") {
      x = panel.shape.x;
      y = panel.shape.y;
      w = panel.shape.w;
      h = panel.shape.h;
      clip = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h]
      ];
    } else if (panel.shape.type === "quad" && panel.shape.points) {
      clip = panel.shape.points;
      const xs = clip.map((p) => p[0]);
      const ys = clip.map((p) => p[1]);
      x = Math.min(...xs);
      y = Math.min(...ys);
      w = Math.max(...xs) - x;
      h = Math.max(...ys) - y;
    }

    // Determine figures to render
    let figureList: Figure[] = [];
    if (panel.figures && panel.figures.length > 0) {
      figureList = panel.figures;
    } else if (panel.character_ids && panel.character_ids.length > 0) {
      const count = panel.character_ids.length;
      figureList = panel.character_ids.map((cid, i) => {
        const isRtl = sodaPage.reading_direction === "rtl";
        const pos = isRtl ? 1 - (i + 0.5) / count : (i + 0.5) / count;
        return {
          character_id: cid,
          pose: "stand",
          position: pos,
          facing: "front",
          framing: null
        };
      });
    }

    const generatedFigures: SketchFigure[] = figureList.map((fig, idx) => {
      const char = charMap.get(fig.character_id);
      const generated = generateFigureGeometry([w, h], fig, char, {
        shot: panel.shot || "medium",
        color: "#00a8c4",
        origin: [x, y]
      });

      // Offset subsequent label badges slightly so they do not overlap
      if (idx > 0 && generated.label_at) {
        generated.label_at = [generated.label_at[0], generated.label_at[1] + idx * 28];
      }

      return generated;
    });

    return {
      panel_id: panel.id,
      clip,
      figures: generatedFigures
    };
  });

  return {
    version: (sodaPage as any).version || "local",
    canvas: [sodaPage.canvas_width, sodaPage.canvas_height],
    panels
  };
}

/**
 * Generate figure geometry for an overlay (跨格/出格图层).
 */
export function generateOverlayFigure(
  overlay: SodaOverlay,
  characters: CharacterSummary[]
): SketchFigure {
  const char = characters.find((c) => c.id === overlay.character_id);
  const rect = overlay.rect || { x: 50, y: 50, w: 200, h: 200 };
  const w = rect.w;
  const h = rect.h;
  const x = rect.x;
  const y = rect.y;

  // By default, moss overlays have an energetic 'arms_up' pose
  const figure: Figure = {
    character_id: overlay.character_id,
    pose: overlay.mode === "moss" ? "arms_up" : "stand",
    position: "center",
    facing: "front",
    framing: "full"
  };

  return generateFigureGeometry([w, h], figure, char, {
    shot: "full",
    color: "#00a8c4",
    origin: [x, y]
  });
}
