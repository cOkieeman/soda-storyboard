import { v4 as uuidv4 } from "uuid";
import {
  Bubble,
  BubbleType,
  CanvasConfig,
  CanvasPreset,
  Panel,
  Project,
  ProjectPage,
  SodaPage,
  SodaPanel,
  SodaText
} from "../types";
import { DEFAULT_BUBBLE_TEXT_COLOR, normalizeHexColor } from "./colors";
import { normalizePanelRotation, normalizePanelShape, RECT_PANEL_SHAPE } from "./panelGeometry";

export const CANVAS_PRESETS: Record<CanvasPreset, { width: number; height: number; dpi: number }> = {
  A4: {
    width: 2480,
    height: 3508,
    dpi: 300
  },
  A3: {
    width: 3508,
    height: 4961,
    dpi: 300
  },
  custom: {
    width: 1024,
    height: 1536,
    dpi: 300
  }
};

export function createCanvasFromPreset(preset: CanvasPreset = "custom"): CanvasConfig {
  const picked = CANVAS_PRESETS[preset] || CANVAS_PRESETS.custom;
  return {
    width: picked.width,
    height: picked.height,
    preset,
    dpi: picked.dpi
  };
}

const DEFAULT_PANEL_STYLE: Pick<
  Panel,
  "borderColor" | "borderRadius" | "borderWidth" | "gap" | "rotation" | "shape"
> = {
  borderWidth: 2,
  borderColor: "#171815",
  borderRadius: 0,
  gap: 0,
  rotation: 0,
  shape: RECT_PANEL_SHAPE
};

export function createPanel(
  input: Pick<Panel, "x" | "y" | "width" | "height"> & Partial<Panel>
): Panel {
  const width = Math.max(24, input.width);
  const height = Math.max(24, input.height);
  const id = input.id ?? `p_${uuidv4().slice(0, 6)}`;
  const order = input.order ?? 1;

  const sodaData: SodaPanel = input.sodaData ?? {
    id,
    order,
    shape: {
      type: "rect",
      x: input.x,
      y: input.y,
      w: width,
      h: height
    },
    shot: "medium",
    angle: "eye",
    character_ids: [],
    description: "",
    caption_en: "",
    figures: []
  };

  return {
    id,
    order,
    x: input.x,
    y: input.y,
    width,
    height,
    rotation: normalizePanelRotation(input.rotation ?? DEFAULT_PANEL_STYLE.rotation),
    shape: normalizePanelShape(input.shape ?? DEFAULT_PANEL_STYLE.shape, width),
    borderColor: input.borderColor ?? DEFAULT_PANEL_STYLE.borderColor,
    borderRadius: input.borderRadius ?? DEFAULT_PANEL_STYLE.borderRadius,
    borderWidth: input.borderWidth ?? DEFAULT_PANEL_STYLE.borderWidth,
    gap: input.gap ?? DEFAULT_PANEL_STYLE.gap,
    image: input.image,
    parentId: input.parentId,
    sodaData
  };
}

export function createBubble(type: BubbleType = "rounded", input: Partial<Bubble> = {}): Bubble {
  const safeType = input.type ?? type;
  const defaultWidth = safeType === "circle" ? 140 : 120;
  const defaultHeight = safeType === "circle" ? 140 : 200;
  const safeX = typeof input.x === "number" && Number.isFinite(input.x) ? input.x : 100;
  const safeY = typeof input.y === "number" && Number.isFinite(input.y) ? input.y : 100;
  const safeWidth = typeof input.width === "number" && Number.isFinite(input.width) ? input.width : defaultWidth;
  const safeHeight = typeof input.height === "number" && Number.isFinite(input.height) ? input.height : defaultHeight;
  const safeFontSize = typeof input.fontSize === "number" && Number.isFinite(input.fontSize) ? input.fontSize : 24;
  const safeBorderWidth =
    typeof input.borderWidth === "number" && Number.isFinite(input.borderWidth) ? input.borderWidth : 2;

  const id = input.id ?? `t_${uuidv4().slice(0, 6)}`;

  const sodaData: SodaText = input.sodaData ?? {
    id,
    text: input.text ?? "台词文本",
    kind: "dialogue",
    panel_id: null,
    speaker_id: null,
    direction: input.direction === "horizontal" ? "horizontal" : "vertical",
    bubble: "speech",
    bbox: {
      type: "rect",
      x: safeX,
      y: safeY,
      w: safeWidth,
      h: safeHeight
    }
  };

  return {
    id,
    type: safeType,
    x: safeX,
    y: safeY,
    width: Math.max(30, safeWidth),
    height: Math.max(30, safeHeight),
    text: input.text ?? "台词文本",
    direction: input.direction === "horizontal" ? "horizontal" : "vertical",
    fontSize: Math.max(8, safeFontSize),
    fontFamily: input.fontFamily ?? "Consolas, 'Microsoft YaHei', sans-serif",
    textColor: normalizeHexColor(input.textColor, DEFAULT_BUBBLE_TEXT_COLOR),
    background: input.background ?? "#ffffff",
    borderColor: input.borderColor ?? "#171815",
    borderWidth: Math.max(0, safeBorderWidth),
    sodaData
  };
}

export function createEmptyProject(name = "未命名分镜"): Project {
  const pageId = "page_1";
  const canvas: CanvasConfig = {
    width: 1024,
    height: 1536,
    preset: "custom",
    dpi: 300
  };

  return {
    id: "project_1",
    name,
    pages: [
      {
        id: pageId,
        name: "第 1 页",
        canvas,
        panels: [],
        bubbles: []
      }
    ],
    activePageId: pageId
  };
}

// Convert a SodaPage to an OpenKoma ProjectPage
export function sodaPageToProjectPage(soda: SodaPage): ProjectPage {
  const canvas: CanvasConfig = {
    width: soda.canvas_width || 1024,
    height: soda.canvas_height || 1536,
    preset: "custom",
    dpi: 300
  };

  const panels: Panel[] = (soda.panels || []).map((p) => {
    let x = 0;
    let y = 0;
    let width = 200;
    let height = 200;
    let shape = { ...RECT_PANEL_SHAPE };

    if (p.shape.type === "rect") {
      x = p.shape.x;
      y = p.shape.y;
      width = Math.max(24, p.shape.w);
      height = Math.max(24, p.shape.h);
      shape = { topLeft: 0, topRight: 1, bottomRight: 1, bottomLeft: 0 };
    } else if (p.shape.type === "quad" && Array.isArray(p.shape.points) && p.shape.points.length === 4) {
      const [p0, p1, p2, p3] = p.shape.points;
      const minX = Math.min(p0[0], p1[0], p2[0], p3[0]);
      const minY = Math.min(p0[1], p1[1], p2[1], p3[1]);
      const maxX = Math.max(p0[0], p1[0], p2[0], p3[0]);
      const maxY = Math.max(p0[1], p1[1], p2[1], p3[1]);

      x = minX;
      y = minY;
      width = Math.max(24, maxX - minX);
      height = Math.max(24, maxY - minY);

      shape = {
        topLeft: (p0[0] - x) / width,
        topRight: (p1[0] - x) / width,
        bottomRight: (p2[0] - x) / width,
        bottomLeft: (p3[0] - x) / width
      };
    }

    return {
      id: p.id,
      order: p.order,
      x,
      y,
      width,
      height,
      rotation: 0,
      shape: normalizePanelShape(shape, width),
      borderWidth: 2,
      borderColor: "#171815",
      borderRadius: 0,
      gap: soda.panel_gap || 20,
      sodaData: p
    };
  });

  const bubbles: Bubble[] = (soda.texts || []).map((t) => {
    let x = 40;
    let y = 40;
    let width = 100;
    let height = 220;

    if (t.bbox) {
      x = t.bbox.x;
      y = t.bbox.y;
      width = Math.max(30, t.bbox.w);
      height = Math.max(30, t.bbox.h);
    }

    const type: BubbleType = t.bubble === "box" || t.bubble === "none" ? "rect" : "rounded";
    const direction = t.direction === "horizontal" ? "horizontal" : "vertical";

    return {
      id: t.id,
      type,
      x,
      y,
      width,
      height,
      text: t.text || "",
      direction,
      fontSize: 20,
      fontFamily: "Consolas, 'Microsoft YaHei', sans-serif",
      textColor: "#171815",
      background: t.bubble === "none" ? "rgba(255,255,255,0)" : "#ffffff",
      borderColor: t.bubble === "none" ? "transparent" : "#171815",
      borderWidth: t.bubble === "none" ? 0 : 2,
      sodaData: t
    };
  });

  return {
    id: soda.id,
    name: soda.id,
    canvas,
    panels,
    bubbles
  };
}

// Convert OpenKoma ProjectPage back to SodaPage preserving unknown fields
export function projectPageToSodaPage(page: ProjectPage, baseSodaPage: SodaPage): SodaPage {
  // Deep clone base page to keep all original metadata, tags, overlays, etc.
  const cloned: SodaPage = JSON.parse(JSON.stringify(baseSodaPage));

  cloned.canvas_width = page.canvas.width;
  cloned.canvas_height = page.canvas.height;

  // Sync panels
  cloned.panels = page.panels.map((p) => {
    const existing = cloned.panels.find((item) => item.id === p.id) || p.sodaData || {
      id: p.id,
      order: p.order,
      shot: "medium",
      angle: "eye",
      character_ids: [],
      description: "",
      caption_en: "",
      figures: []
    };

    const isRect =
      Math.abs(p.shape.topLeft - 0) < 0.005 &&
      Math.abs(p.shape.topRight - 1) < 0.005 &&
      Math.abs(p.shape.bottomRight - 1) < 0.005 &&
      Math.abs(p.shape.bottomLeft - 0) < 0.005;

    let shape;
    if (isRect) {
      shape = {
        type: "rect" as const,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        w: Math.round(p.width * 10) / 10,
        h: Math.round(p.height * 10) / 10
      };
    } else {
      shape = {
        type: "quad" as const,
        points: [
          [Math.round((p.x + p.width * p.shape.topLeft) * 10) / 10, Math.round(p.y * 10) / 10],
          [Math.round((p.x + p.width * p.shape.topRight) * 10) / 10, Math.round(p.y * 10) / 10],
          [Math.round((p.x + p.width * p.shape.bottomRight) * 10) / 10, Math.round((p.y + p.height) * 10) / 10],
          [Math.round((p.x + p.width * p.shape.bottomLeft) * 10) / 10, Math.round((p.y + p.height) * 10) / 10]
        ] as [
          [number, number],
          [number, number],
          [number, number],
          [number, number]
        ]
      };
    }

    return {
      ...existing,
      id: p.id,
      order: p.order,
      shape
    };
  });

  // Sync texts
  cloned.texts = page.bubbles.map((b) => {
    const existing = cloned.texts.find((item) => item.id === b.id) || b.sodaData || {
      id: b.id,
      kind: "dialogue",
      panel_id: null,
      speaker_id: null,
      bubble: "speech"
    };

    return {
      ...existing,
      id: b.id,
      text: b.text,
      direction: b.direction,
      bbox: {
        type: "rect" as const,
        x: Math.round(b.x * 10) / 10,
        y: Math.round(b.y * 10) / 10,
        w: Math.round(b.width * 10) / 10,
        h: Math.round(b.height * 10) / 10
      }
    };
  });

  return cloned;
}

export function splitGridPanels(
  panels: Panel[],
  rows: number,
  cols: number,
  canvas: CanvasConfig,
  gap = 20
): Panel[] {
  const safeRows = Math.max(1, Math.min(8, rows));
  const safeCols = Math.max(1, Math.min(8, cols));
  const availableWidth = canvas.width - gap * (safeCols + 1);
  const availableHeight = canvas.height - gap * (safeRows + 1);
  const panelWidth = Math.floor(availableWidth / safeCols);
  const panelHeight = Math.floor(availableHeight / safeRows);

  const result: Panel[] = [];
  let order = 1;

  // In RTL, column indices go from right to left (cols - 1 down to 0)
  for (let r = 0; r < safeRows; r++) {
    for (let c = safeCols - 1; c >= 0; c--) {
      const x = gap + c * (panelWidth + gap);
      const y = gap + r * (panelHeight + gap);
      result.push(
        createPanel({
          id: `p${order}`,
          order,
          x,
          y,
          width: panelWidth,
          height: panelHeight,
          gap
        })
      );
      order++;
    }
  }

  return result;
}
