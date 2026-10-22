import { useEffect, useRef } from "react";
import Konva from "konva";
import { Arrow, Circle, Ellipse, Group, Image as KonvaImage, Line as KonvaLine, Rect, Shape, Text } from "react-konva";
import useImage from "use-image";
import { Bubble, Panel, SketchGeometry } from "../../types";
import {
  PANEL_EDGE_HANDLE_KEYS, PANEL_SHAPE_HANDLE_KEYS, Point,
  getPanelCanvasPoint, getPanelCenter, getPanelEdgeHandlePoint, getPanelShapeHandlePoint
} from "../../lib/panelGeometry";
import { drawPanelPath, getPanelImageLayout } from "../../lib/panelRender";
import { fitHorizontalFontSize, layoutVerticalText, translateVerticalForms, verticalColumns } from "../../lib/lettering";
import { layoutShoutText, shoutBubblePoints } from "../../lib/bubbleGeometry";

import { startPanelHandleDrag, updatePanelHandleDrag, type PanelHandle, type PanelHandleDrag } from "../../lib/panelHandleDrag";

const SKEW_HANDLE_RADIUS = 10;
const SKEW_HANDLE_HIT_RADIUS = 24;
const SKEW_HANDLE_COLOR = "#9a321f";
const MANGA_SKETCH_COLOR = "#3288a2";
export function PanelFillShape({ panel }: { panel: Panel }) {
  return (
    <Shape
      sceneFunc={(context, shape) => {
        context.beginPath();
        drawPanelPath(context, panel);
        context.closePath();
        context.fillStrokeShape(shape);
      }}
      fill="rgba(255, 255, 255, 0.01)" // Catch hit tests
    />
  );
}

export function PanelBorderShape({
  panel,
  selected,
  hasError
}: {
  panel: Panel;
  selected: boolean;
  hasError: boolean;
}) {
  const strokeColor = hasError ? "#9a321f" : selected ? "#9a321f" : "#171815";
  const strokeWidth = hasError ? 3 : selected ? 3 : 2;

  return (
    <Shape
      name="panel-border"
      sceneFunc={(context, shape) => {
        context.beginPath();
        drawPanelPath(context, panel);
        context.closePath();
        context.fillStrokeShape(shape);
      }}
      fillEnabled={false}
      stroke={strokeColor}
      strokeWidth={strokeWidth}
      dash={hasError ? [8, 4] : undefined}
      listening={false}
    />
  );
}

export function PanelImageLayer({ panel }: { panel: Panel }) {
  const imageUrl = panel.image?.original ?? "";
  const [image] = useImage(imageUrl, "anonymous");

  if (!image || !panel.image) {
    return null;
  }

  const imageLayout = getPanelImageLayout(panel, {
    width: image.width,
    height: image.height
  });
  if (!imageLayout) {
    return null;
  }

  return (
    <Group
      clipFunc={(context) => {
        context.beginPath();
        drawPanelPath(context, panel, panel.gap);
        context.closePath();
      }}
      listening={false}
    >
      <KonvaImage
        image={image}
        x={imageLayout.offsetX}
        y={imageLayout.offsetY}
        width={imageLayout.drawWidth}
        height={imageLayout.drawHeight}
        crop={imageLayout.cropRect}
        listening={false}
      />
    </Group>
  );
}

// Sketch Primitives Layer with softer sketch blue & click-for-menu support
export function SketchGeometryPanelLayer({
  panel,
  sketchGeometry,
  onDragFigure,
  onClickFigure
}: {
  panel: Panel;
  sketchGeometry: SketchGeometry | null;
  onDragFigure: (charId: string, figIdx: number, newPos: [number, number]) => void;
  onClickFigure: (figIdx: number, charId: string, fig: any, clientPos: { x: number; y: number }) => void;
}) {
  if (!sketchGeometry) return null;
  const sketchPanel = sketchGeometry.panels?.find((sp) => sp.panel_id === panel.id);
  if (!sketchPanel || !sketchPanel.figures || sketchPanel.figures.length === 0) return null;

  return (
    <Group
      clipFunc={(context) => {
        context.beginPath();
        drawPanelPath(context, panel, panel.gap);
        context.closePath();
      }}
    >
      {sketchPanel.figures.map((figure, figIdx) => {
        const figColor = figure.color ? MANGA_SKETCH_COLOR : MANGA_SKETCH_COLOR;
        return (
          <Group key={`fig-${figIdx}-${figure.character_id}`}>
            {figure.primitives?.map((prim, primIdx) => {
              if (prim.type === "circle") {
                return (
                  <Circle
                    key={primIdx}
                    x={prim.cx - panel.x}
                    y={prim.cy - panel.y}
                    radius={prim.r}
                    stroke={figColor}
                    strokeWidth={2.2}
                    fill="rgba(50, 136, 162, 0.08)"
                    listening={false}
                  />
                );
              }
              if (prim.type === "line") {
                const flatPoints = prim.points.flatMap(([px, py]) => [px - panel.x, py - panel.y]);
                return (
                  <KonvaLine
                    key={primIdx}
                    points={flatPoints}
                    stroke={figColor}
                    strokeWidth={prim.width || 3}
                    lineCap="round"
                    lineJoin="round"
                    listening={false}
                  />
                );
              }
              if (prim.type === "polygon") {
                const flatPoints = prim.points.flatMap(([px, py]) => [px - panel.x, py - panel.y]);
                return (
                  <KonvaLine
                    key={primIdx}
                    points={flatPoints}
                    closed
                    fill={prim.fill || "rgba(50, 136, 162, 0.12)"}
                    stroke={figColor}
                    strokeWidth={2}
                    listening={false}
                  />
                );
              }
              return null;
            })}

            {/* Draggable & Clickable Figure Handle */}
            {figure.label_at && (
              <Group
                name="figure-tag"
                x={figure.label_at[0] - panel.x}
                y={figure.label_at[1] - panel.y}
                draggable
                onClick={(e) => {
                  e.cancelBubble = true;
                  const stage = e.target.getStage();
                  const pointer = stage?.getPointerPosition();
                  const scaleX = stage ? stage.scaleX() : 1;
                  const scaleY = stage ? stage.scaleY() : 1;
                  const px = pointer && stage ? pointer.x / scaleX : figure.label_at[0];
                  const py = pointer && stage ? pointer.y / scaleY : figure.label_at[1];
                  onClickFigure(figIdx, figure.character_id, figure, { x: px, y: py });
                }}
                onDragEnd={(e) => {
                  e.cancelBubble = true;
                  const newX = Math.round(panel.x + e.target.x());
                  const newY = Math.round(panel.y + e.target.y());
                  onDragFigure(figure.character_id, figIdx, [newX, newY]);
                }}
              >
                <Rect
                  width={Math.max(48, figure.label.length * 13 + 12)}
                  height={22}
                  fill={figColor}
                  cornerRadius={4}
                  stroke="#ffffff"
                  strokeWidth={1}
                />
                <Text
                  x={6}
                  y={4}
                  text={figure.label}
                  fill="#ffffff"
                  fontSize={12}
                  fontStyle="bold"
                  fontFamily="'Microsoft YaHei', sans-serif"
                />
              </Group>
            )}
          </Group>
        );
      })}
    </Group>
  );
}

// Skew & Edge Push/Pull Handles
export function PanelSkewHandles({ panel, onDraftChange, onCommit, onCancel, onInteractionChange }: {
  panel: Panel;
  onDraftChange: (patch: Partial<Panel>) => void;
  onCommit: (patch: Partial<Panel>) => void;
  onCancel: () => void;
  onInteractionChange?: (active: boolean) => void;
}) {
  const interaction = useRef<{ node: Konva.Node; drag: PanelHandleDrag; last: ReturnType<typeof updatePanelHandleDrag> | null } | null>(null);
  const interactionCallback = useRef(onInteractionChange);
  const cancelCallback = useRef(onCancel);
  interactionCallback.current = onInteractionChange;
  cancelCallback.current = onCancel;
  useEffect(() => {
    const release = () => interactionCallback.current?.(false);
    const cancel = () => {
      const current = interaction.current;
      if (!current) return;
      interaction.current = null;
      if (current.node.isDragging()) current.node.stopDrag();
      cancelCallback.current();
      release();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || !interaction.current?.node.isDragging()) return;
      event.preventDefault(); event.stopPropagation(); cancel();
    };
    window.addEventListener("keydown", keyboard, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("mouseup", release);
    window.addEventListener("touchend", release);
    window.addEventListener("touchcancel", release);
    return () => {
      window.removeEventListener("mouseup", release);
      window.removeEventListener("touchend", release);
      window.removeEventListener("touchcancel", release);
      window.removeEventListener("keydown", keyboard, true);
      window.removeEventListener("blur", cancel);
      cancel(); release();
    };
  }, []);

  const pagePointer = (node: Konva.Node): Point | null => {
    const stage = node.getStage(), point = stage?.getPointerPosition();
    return stage && point ? stage.getAbsoluteTransform().copy().invert().point(point) : null;
  };
  const begin = (event: Konva.KonvaEventObject<Event>, handle: PanelHandle) => {
    event.cancelBubble = true;
    const pointer = pagePointer(event.target);
    if (!pointer) return;
    interaction.current = { node: event.target, drag: startPanelHandleDrag(panel, handle, pointer), last: null };
    interactionCallback.current?.(true);
  };
  const candidate = (node: Konva.Node) => {
    const current = interaction.current, pointer = pagePointer(node);
    if (!current || !pointer) return null;
    current.last = updatePanelHandleDrag(current.drag, pointer);
    return current.last;
  };
  const bounds = function(this: Konva.Node, position: Konva.Vector2d) {
    const next = candidate(this), stage = this.getStage();
    // Konva's bound function consumes absolute stage pixels, not page units.
    return next && stage ? stage.getAbsoluteTransform().point(next.point) : position;
  };
  const move = (event: Konva.KonvaEventObject<DragEvent>) => {
    event.cancelBubble = true;
    const next = candidate(event.target);
    if (next) onDraftChange(next.patch);
  };
  const finish = (event: Konva.KonvaEventObject<DragEvent>) => {
    event.cancelBubble = true;
    const last = interaction.current?.last;
    interaction.current = null;
    interactionCallback.current?.(false);
    // The preview already contains the final result; recalculating against
    // displayPanel on mouseup would apply top-edge resizing a second time.
    if (last?.changed) onCommit(last.patch);
    else onCancel();
  };
  const events = (handle: PanelHandle) => ({
    onMouseDown: (event: Konva.KonvaEventObject<MouseEvent>) => begin(event, handle),
    onTouchStart: (event: Konva.KonvaEventObject<TouchEvent>) => begin(event, handle),
    onDragStart: (event: Konva.KonvaEventObject<DragEvent>) => {
      event.cancelBubble = true;
      if (!interaction.current) begin(event, handle);
      interactionCallback.current?.(true);
    },
    onDragMove: move,
    onDragEnd: finish,
    dragBoundFunc: bounds
  });

  return <Group name="panel-skew-overlay">
    {PANEL_SHAPE_HANDLE_KEYS.map(key => {
      const point = getPanelCanvasPoint(panel, getPanelShapeHandlePoint(panel, key));
      return <Circle key={key} name="panel-skew-handle" id={`panel-corner-${panel.id}-${key}`}
        x={point.x} y={point.y} radius={SKEW_HANDLE_RADIUS} hitStrokeWidth={SKEW_HANDLE_HIT_RADIUS * 2}
        fill="#fbf6ec" stroke={SKEW_HANDLE_COLOR} strokeWidth={2.5} draggable {...events({ kind: "corner", key })} />;
    })}
    {PANEL_EDGE_HANDLE_KEYS.map(key => {
      const point = getPanelCanvasPoint(panel, getPanelEdgeHandlePoint(panel, key));
      return <Rect key={key} name="panel-edge-handle" id={`panel-edge-${panel.id}-${key}`}
        x={point.x} y={point.y} width={14} height={14} offsetX={7} offsetY={7} rotation={panel.rotation}
        cornerRadius={3} fill="#171815" stroke="#fbf6ec" strokeWidth={2} draggable {...events({ kind: "edge", key })} />;
    })}
  </Group>;
}

// Smart Snapping & Guides Helper
type SnapResult = {
  x: number;
  y: number;
  guideX: number | null;
  guideY: number | null;
};

export function calculateSnap(
  dragId: string,
  proposedX: number,
  proposedY: number,
  width: number,
  height: number,
  targets: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  canvasWidth: number,
  canvasHeight: number,
  threshold = 6
): SnapResult {
  let snappedX = proposedX;
  let snappedY = proposedY;
  let guideX: number | null = null;
  let guideY: number | null = null;

  const dragCenterX = proposedX + width / 2;
  const dragRightX = proposedX + width;
  const dragCenterY = proposedY + height / 2;
  const dragBottomY = proposedY + height;

  const xTargets: number[] = [0, canvasWidth / 2, canvasWidth, canvasWidth * 0.05, canvasWidth * 0.95];
  const yTargets: number[] = [0, canvasHeight / 2, canvasHeight, canvasHeight * 0.05, canvasHeight * 0.95];

  targets.forEach((t) => {
    if (t.id === dragId) return;
    xTargets.push(t.x, t.x + t.width / 2, t.x + t.width);
    yTargets.push(t.y, t.y + t.height / 2, t.y + t.height);
  });

  let minDiffX = threshold + 1;
  for (const tx of xTargets) {
    if (Math.abs(proposedX - tx) < minDiffX) {
      minDiffX = Math.abs(proposedX - tx);
      snappedX = tx;
      guideX = tx;
    }
    if (Math.abs(dragCenterX - tx) < minDiffX) {
      minDiffX = Math.abs(dragCenterX - tx);
      snappedX = tx - width / 2;
      guideX = tx;
    }
    if (Math.abs(dragRightX - tx) < minDiffX) {
      minDiffX = Math.abs(dragRightX - tx);
      snappedX = tx - width;
      guideX = tx;
    }
  }

  let minDiffY = threshold + 1;
  for (const ty of yTargets) {
    if (Math.abs(proposedY - ty) < minDiffY) {
      minDiffY = Math.abs(proposedY - ty);
      snappedY = ty;
      guideY = ty;
    }
    if (Math.abs(dragCenterY - ty) < minDiffY) {
      minDiffY = Math.abs(dragCenterY - ty);
      snappedY = ty - height / 2;
      guideY = ty;
    }
    if (Math.abs(dragBottomY - ty) < minDiffY) {
      minDiffY = Math.abs(dragBottomY - ty);
      snappedY = ty - height;
      guideY = ty;
    }
  }

  return { x: Math.round(snappedX), y: Math.round(snappedY), guideX, guideY };
}

export function SnapGuidesOverlay({
  guideX,
  guideY,
  canvasWidth,
  canvasHeight
}: {
  guideX: number | null;
  guideY: number | null;
  canvasWidth: number;
  canvasHeight: number;
}) {
  if (guideX === null && guideY === null) return null;
  return (
    <Group listening={false}>
      {guideX !== null && (
        <KonvaLine
          points={[guideX, 0, guideX, canvasHeight]}
          stroke="#d93829"
          strokeWidth={1.5}
          dash={[6, 4]}
        />
      )}
      {guideY !== null && (
        <KonvaLine
          points={[0, guideY, canvasWidth, guideY]}
          stroke="#d93829"
          strokeWidth={1.5}
          dash={[6, 4]}
        />
      )}
    </Group>
  );
}

export function getBubbleTailHandlePos(bubble: Bubble): { x: number; y: number } {
  if (!bubble.tailTip) {
    return { x: bubble.width / 2, y: bubble.height + 25 };
  }
  if (bubble.sodaData?.bubble === "shout") {
    const base = shoutBubblePoints(bubble.width, bubble.height, bubble.borderWidth);
    const points = shoutBubblePoints(bubble.width, bubble.height, bubble.borderWidth, bubble.tailTip);
    const moved = points.find(([x, y], index) => x !== base[index][0] || y !== base[index][1]);
    return moved ? { x: moved[0], y: moved[1] } : { x: bubble.tailTip[0], y: bubble.tailTip[1] };
  }
  if (bubble.sodaData?.bubble === "thought") {
    const cx = bubble.width / 2;
    const cy = bubble.height / 2;
    const rx = Math.max(12, bubble.width / 2 - 4);
    const ry = Math.max(12, bubble.height / 2 - 4);
    const tx = bubble.tailTip[0];
    const ty = bubble.tailTip[1];
    const startAngle = Math.atan2(ty - cy, tx - cx);
    const startX = cx + rx * Math.cos(startAngle);
    const startY = cy + ry * Math.sin(startAngle);
    const rawDist = Math.hypot(tx - startX, ty - startY);
    const clampedDist = Math.min(65, Math.max(18, rawDist));
    return {
      x: startX + Math.cos(startAngle) * clampedDist,
      y: startY + Math.sin(startAngle) * clampedDist
    };
  }
  return { x: bubble.tailTip[0], y: bubble.tailTip[1] };
}

// Manga Speech Bubble with authentic shapes (Speech with tail, Thought Cloud, Shout Burst, Narration Box)
export function BubbleShape({ bubble }: { bubble: Bubble }) {
  const isBox = bubble.sodaData?.bubble === "box";
  const isNone = bubble.sodaData?.bubble === "none";
  const isThought = bubble.sodaData?.bubble === "thought";
  const isShout = bubble.sodaData?.bubble === "shout";

  if (isNone) {
    return <Rect width={bubble.width} height={bubble.height} fill="rgba(255,255,255,0.01)" />;
  }

  if (isBox) {
    return (
      <Rect
        width={bubble.width}
        height={bubble.height}
        fill={bubble.background}
        stroke={bubble.borderColor}
        strokeWidth={bubble.borderWidth}
      />
    );
  }

  const W = bubble.width;
  const H = bubble.height;
  const cx = W / 2;
  const cy = H / 2;

  // 1. AUTHENTIC MANGA THOUGHT CLOUD BUBBLE (思考气泡 / 云状气泡)
  if (isThought) {
    const rx = Math.max(12, W / 2 - 4);
    const ry = Math.max(12, H / 2 - 4);
    const numArcs = 10;
    const bump = Math.min(12, Math.max(6, Math.min(W, H) * 0.14));

    // Trailing thought circles
    let c1X = cx - 6;
    let c1Y = H + 8;
    let c2X = cx - 12;
    let c2Y = H + 18;

    if (bubble.tailTip) {
      const tx = bubble.tailTip[0];
      const ty = bubble.tailTip[1];
      const startAngle = Math.atan2(ty - cy, tx - cx);
      const startX = cx + rx * Math.cos(startAngle);
      const startY = cy + ry * Math.sin(startAngle);

      // Clamp max distance of trailing thought bubbles so they don't drift 300px away!
      const rawDist = Math.hypot(tx - startX, ty - startY);
      const clampedDist = Math.min(65, Math.max(18, rawDist));
      const endX = startX + Math.cos(startAngle) * clampedDist;
      const endY = startY + Math.sin(startAngle) * clampedDist;

      c1X = startX + (endX - startX) * 0.45;
      c1Y = startY + (endY - startY) * 0.45;
      c2X = endX;
      c2Y = endY;
    }

    return (
      <Group>
        <Shape
          sceneFunc={(context, shape) => {
            context.beginPath();
            for (let i = 0; i < numArcs; i++) {
              const a1 = (i * 2 * Math.PI) / numArcs;
              const a2 = ((i + 1) * 2 * Math.PI) / numArcs;
              const aMid = (a1 + a2) / 2;

              const x1 = cx + rx * Math.cos(a1);
              const y1 = cy + ry * Math.sin(a1);
              const x2 = cx + rx * Math.cos(a2);
              const y2 = cy + ry * Math.sin(a2);

              const cpX = cx + (rx + bump) * Math.cos(aMid);
              const cpY = cy + (ry + bump) * Math.sin(aMid);

              if (i === 0) {
                context.moveTo(x1, y1);
              }
              context.quadraticCurveTo(cpX, cpY, x2, y2);
            }
            context.closePath();
            context.fillStrokeShape(shape);
          }}
          fill={bubble.background}
          stroke={bubble.borderColor}
          strokeWidth={bubble.borderWidth}
        />
        {/* Trailing thought circles */}
        <Circle
          x={c1X}
          y={c1Y}
          radius={6}
          fill={bubble.background}
          stroke={bubble.borderColor}
          strokeWidth={bubble.borderWidth}
        />
        <Circle
          x={c2X}
          y={c2Y}
          radius={3.5}
          fill={bubble.background}
          stroke={bubble.borderColor}
          strokeWidth={bubble.borderWidth}
        />
      </Group>
    );
  }

  // 2. AUTHENTIC MANGA SHOUT BURST BUBBLE (呐喊气泡 / 爆炸气泡)
  if (isShout) {
    const points = shoutBubblePoints(W, H, bubble.borderWidth, bubble.tailTip);
    return (
      <Shape
        sceneFunc={(context, shape) => {
          context.beginPath();
          points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
          context.closePath();
          context.fillStrokeShape(shape);
        }}
        fill={bubble.background}
        stroke={bubble.borderColor}
        strokeWidth={bubble.borderWidth}
        lineJoin="round"
      />
    );
  }

  // 3. AUTHENTIC DIALOGUE SPEECH BUBBLE (标准对话气泡，带平滑引线)
  const R = bubble.type === "circle" ? Math.min(W, H) / 2 : Math.min(22, Math.min(W, H) / 2);

  if (!bubble.tailTip) {
    return (
      <Rect
        width={W}
        height={H}
        fill={bubble.background}
        stroke={bubble.borderColor}
        strokeWidth={bubble.borderWidth}
        cornerRadius={R}
      />
    );
  }

  const tx = bubble.tailTip[0];
  const ty = bubble.tailTip[1];

  const distBottom = ty - H;
  const distTop = -ty;
  const distRight = tx - W;
  const distLeft = -tx;

  let side: "bottom" | "top" | "left" | "right" = "bottom";
  const maxDist = Math.max(distBottom, distTop, distRight, distLeft);
  if (maxDist === distBottom) side = "bottom";
  else if (maxDist === distTop) side = "top";
  else if (maxDist === distRight) side = "right";
  else side = "left";

  const rootW = Math.min(22, Math.max(12, W * 0.25));
  const rootH = Math.min(22, Math.max(12, H * 0.25));

  return (
    <Shape
      sceneFunc={(context, shape) => {
        context.beginPath();

        if (side === "top") {
          const bx = Math.max(R + rootW / 2, Math.min(W - R - rootW / 2, tx));
          context.moveTo(R, 0);
          context.lineTo(bx - rootW / 2, 0);
          context.lineTo(tx, ty);
          context.lineTo(bx + rootW / 2, 0);
          context.lineTo(W - R, 0);
          context.arcTo(W, 0, W, R, R);
          context.lineTo(W, H - R);
          context.arcTo(W, H, W - R, H, R);
          context.lineTo(R, H);
          context.arcTo(0, H, 0, H - R, R);
          context.lineTo(0, R);
          context.arcTo(0, 0, R, 0, R);
        } else if (side === "bottom") {
          const bx = Math.max(R + rootW / 2, Math.min(W - R - rootW / 2, tx));
          context.moveTo(R, 0);
          context.lineTo(W - R, 0);
          context.arcTo(W, 0, W, R, R);
          context.lineTo(W, H - R);
          context.arcTo(W, H, W - R, H, R);
          context.lineTo(bx + rootW / 2, H);
          context.lineTo(tx, ty);
          context.lineTo(bx - rootW / 2, H);
          context.lineTo(R, H);
          context.arcTo(0, H, 0, H - R, R);
          context.lineTo(0, R);
          context.arcTo(0, 0, R, 0, R);
        } else if (side === "left") {
          const by = Math.max(R + rootH / 2, Math.min(H - R - rootH / 2, ty));
          context.moveTo(R, 0);
          context.lineTo(W - R, 0);
          context.arcTo(W, 0, W, R, R);
          context.lineTo(W, H - R);
          context.arcTo(W, H, W - R, H, R);
          context.lineTo(R, H);
          context.arcTo(0, H, 0, H - R, R);
          context.lineTo(0, by + rootH / 2);
          context.lineTo(tx, ty);
          context.lineTo(0, by - rootH / 2);
          context.lineTo(0, R);
          context.arcTo(0, 0, R, 0, R);
        } else {
          // right
          const by = Math.max(R + rootH / 2, Math.min(H - R - rootH / 2, ty));
          context.moveTo(R, 0);
          context.lineTo(W - R, 0);
          context.arcTo(W, 0, W, R, R);
          context.lineTo(W, by - rootH / 2);
          context.lineTo(tx, ty);
          context.lineTo(W, by + rootH / 2);
          context.lineTo(W, H - R);
          context.arcTo(W, H, W - R, H, R);
          context.lineTo(R, H);
          context.arcTo(0, H, 0, H - R, R);
          context.lineTo(0, R);
          context.arcTo(0, 0, R, 0, R);
        }

        context.closePath();
        context.fillStrokeShape(shape);
      }}
      fill={bubble.background}
      stroke={bubble.borderColor}
      strokeWidth={bubble.borderWidth}
    />
  );
}

// Vertical text layout matching lettering.py
export function BubbleText({ bubble }: { bubble: Bubble }) {
  if (bubble.sodaData?.bubble === "shout") {
    const layout = layoutShoutText(bubble.width, bubble.height, bubble.text || "", bubble.direction, bubble.fontSize || 20);
    const props = {
      fontFamily: bubble.fontFamily || "Consolas, 'Microsoft YaHei', sans-serif",
      fill: bubble.textColor || "#171815", align: "center", verticalAlign: "middle", listening: false
    } as const;
    return (
      <Group listening={false}>
        {bubble.direction === "vertical" ? layout.columns.map((column, colIndex) => column.map((glyph, row) => (
          <Text
            key={`${colIndex}-${row}`}
            {...props}
            x={layout.contentX + (layout.columns.length - 1 - colIndex) * layout.cellWidth}
            y={layout.contentY + row * layout.cellHeight}
            width={layout.cellWidth}
            height={layout.cellHeight}
            text={glyph}
            fontSize={Math.min(layout.fontSize, layout.cellWidth / Math.max(1, glyph.length * 0.65))}
            wrap="none"
          />
        ))) : layout.lines.map((line, row) => (
          <Text
            key={row}
            {...props}
            x={layout.area.x}
            y={layout.contentY + row * layout.cellHeight}
            width={layout.area.width}
            height={layout.cellHeight}
            text={line}
            fontSize={layout.fontSize}
            wrap="none"
          />
        ))}
      </Group>
    );
  }
  if (bubble.direction === "vertical") {
    const layout = layoutVerticalText(bubble.width, bubble.height, bubble.text || "", bubble.fontSize || 20);
    return (
      <Group listening={false}>
        {layout.columns.map((tokens, column) => tokens.map((glyph, row) => (
            <Text
              key={`${column}-${row}`}
              x={layout.startX - column * layout.columnWidth}
              y={layout.startY + row * layout.cellHeight}
              width={layout.columnWidth}
              height={layout.cellHeight}
              text={glyph}
              align="center"
              verticalAlign="middle"
              wrap="none"
              fontSize={Math.min(layout.fontSize, layout.columnWidth / Math.max(1, glyph.length * 0.65))}
              fontFamily={bubble.fontFamily || "Consolas, 'Microsoft YaHei', sans-serif"}
              fill={bubble.textColor || "#171815"}
            />
        )))}
      </Group>
    );
  }

  const padX = bubble.sodaData?.bubble === "thought" ? 14 : 8;
  const padY = bubble.sodaData?.bubble === "thought" ? 12 : 8;
  return (
    <Text
      x={padX}
      y={padY}
      width={Math.max(10, bubble.width - padX * 2)}
      height={Math.max(10, bubble.height - padY * 2)}
      text={bubble.text}
      align="center"
      verticalAlign="middle"
      fontSize={fitHorizontalFontSize(Math.max(1, bubble.width - padX * 2), Math.max(1, bubble.height - padY * 2), bubble.text || "", bubble.fontSize || 20)}
      fontFamily={bubble.fontFamily || "Consolas, 'Microsoft YaHei', sans-serif"}
      fill={bubble.textColor || "#171815"}
      lineHeight={1.25}
      wrap="char"
      listening={false}
    />
  );
}

// Background comparison layer for sketch draft
export function SketchLayerImage({
  pageId,
  version,
  canvasWidth,
  canvasHeight,
  opacity
}: {
  pageId: string;
  version: string;
  canvasWidth: number;
  canvasHeight: number;
  opacity: number;
}) {
  const url = `/api/pages/${encodeURIComponent(pageId)}/preview.png?style=sketch&scale=1&v=${encodeURIComponent(version)}`;
  const [image] = useImage(url, "anonymous");

  if (!image) return null;

  return (
    <KonvaImage
      image={image}
      x={0}
      y={0}
      width={canvasWidth}
      height={canvasHeight}
      opacity={opacity}
      listening={false}
    />
  );
}

// Background layer component for selected render result
export function RenderLayerImage({
  renderUrl,
  canvasWidth,
  canvasHeight,
  opacity
}: {
  renderUrl: string;
  canvasWidth: number;
  canvasHeight: number;
  opacity: number;
}) {
  const [image] = useImage(renderUrl, "anonymous");

  if (!image) return null;

  return (
    <KonvaImage
      image={image}
      x={0}
      y={0}
      width={canvasWidth}
      height={canvasHeight}
      opacity={opacity}
      listening={false}
    />
  );
}

// Manga Live Area & Bleed Guides Overlay
export function LiveAreaOverlay({ width, height }: { width: number; height: number }) {
  const marginX = width * 0.05;
  const marginY = height * 0.04;
  return (
    <Group listening={false}>
      <Rect
        x={marginX}
        y={marginY}
        width={width - marginX * 2}
        height={height - marginY * 2}
        stroke="rgba(50, 136, 162, 0.45)"
        strokeWidth={1.5}
        dash={[8, 6]}
      />
      <Text
        x={marginX + 6}
        y={marginY + 6}
        text="版心内框 / 安全区 (Live Area)"
        fill="rgba(50, 136, 162, 0.8)"
        fontSize={12}
        fontStyle="bold"
        fontFamily="sans-serif"
      />
    </Group>
  );
}

// Manga Reading Flow Lines Overlay with Arrowheads
export function ReadingFlowOverlay({ panels }: { panels: Panel[] }) {
  const sorted = [...panels].sort((a, b) => a.order - b.order);
  if (sorted.length < 2) return null;

  return (
    <Group listening={false}>
      {sorted.map((panel, idx) => {
        if (idx === sorted.length - 1) return null;
        const nextPanel = sorted[idx + 1];
        const c1 = getPanelCenter(panel);
        const c2 = getPanelCenter(nextPanel);

        return (
          <Group key={`flow-${panel.id}-${nextPanel.id}`}>
            <Arrow
              points={[c1.x, c1.y, c2.x, c2.y]}
              stroke="#9a321f"
              fill="#9a321f"
              strokeWidth={3}
              dash={[10, 6]}
              pointerLength={14}
              pointerWidth={12}
              opacity={0.8}
            />
          </Group>
        );
      })}
    </Group>
  );
}

