import { Fragment, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import Konva from "konva";
import {
  Arrow,
  Circle,
  Ellipse,
  Group,
  Image as KonvaImage,
  Layer,
  Line as KonvaLine,
  Rect,
  Shape,
  Stage,
  Text,
  Transformer
} from "react-konva";
import useImage from "use-image";
import { Bubble, Figure, Panel, SketchGeometry, SodaOverlay, SodaPage } from "../types";
import {
  PANEL_EDGE_HANDLE_KEYS,
  PANEL_SHAPE_HANDLE_KEYS,
  PanelEdgeKey,
  PanelShapeKey,
  Point,
  getPanelCanvasPoint,
  getPanelCenter,
  getPanelEdgeHandlePoint,
  getPanelRenderTransform,
  getPanelShapeHandlePoint,
  normalizePanelRotation,
  normalizePanelShape,
  updatePanelEdgeHandle,
  updatePanelShapeHandle
} from "../lib/panelGeometry";
import { drawPanelPath, getPanelImageLayout } from "../lib/panelRender";
import { getActivePage, useEditorStore } from "../lib/store";
import { translateVerticalForms, verticalColumns } from "../lib/lettering";
import { generateOverlayFigure } from "../lib/sketchGeometry";

export type CanvasEditorHandle = {
  exportPng: () => Promise<void>;
  exportPdf: () => Promise<void>;
};

const BUBBLE_TRANSFORMER_ANCHORS: string[] = ["top-center", "middle-left", "middle-right", "bottom-center"];
const SKEW_HANDLE_RADIUS = 10;
const SKEW_HANDLE_HIT_RADIUS = 24;
const SKEW_HANDLE_COLOR = "#9a321f";
const TRANSFORMER_ANCHOR_SIZE = 14;

// Softer manga pencil/sketch blue (Item 2 refinement)
const MANGA_SKETCH_COLOR = "#3288a2";

function clampZoom(value: number) {
  return Math.min(2.5, Math.max(0.15, value));
}

function PanelFillShape({ panel }: { panel: Panel }) {
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

function PanelBorderShape({
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

function PanelImageLayer({ panel }: { panel: Panel }) {
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
function SketchGeometryPanelLayer({
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
function PanelSkewHandles({
  panel,
  onDraftChange,
  onCommit
}: {
  panel: Panel;
  onDraftChange: (patch: Partial<Panel>) => void;
  onCommit: (patch: Partial<Panel>) => void;
}) {
  const shape = normalizePanelShape(panel.shape, panel.width);

  const getLocalPointer = (node: Konva.Node): Point | null => {
    const parent = node.getParent();
    const stage = node.getStage();
    const pointer = stage?.getPointerPosition();
    if (!parent || !pointer) {
      return null;
    }
    return parent.getAbsoluteTransform().copy().invert().point(pointer);
  };

  const createBoundFunc =
    (key: PanelShapeKey) =>
    function dragBoundFunc(this: Konva.Node, position: Konva.Vector2d) {
      const localPoint = getLocalPointer(this);
      if (!localPoint) {
        return position;
      }

      const nextShape = updatePanelShapeHandle(shape, key, panel.width, localPoint.x);
      const nextLocalPoint = getPanelShapeHandlePoint({ width: panel.width, height: panel.height, shape: nextShape }, key);

      return getPanelCanvasPoint(panel, nextLocalPoint);
    };

  return (
    <Group name="panel-skew-overlay">
      {/* 4 Corner Skew Handles */}
      {PANEL_SHAPE_HANDLE_KEYS.map((key) => {
        const point = getPanelShapeHandlePoint({ width: panel.width, height: panel.height, shape }, key);

        return (
          <Circle
            key={key}
            name="panel-skew-handle"
            x={panel.x + point.x}
            y={panel.y + point.y}
            radius={SKEW_HANDLE_RADIUS}
            hitStrokeWidth={SKEW_HANDLE_HIT_RADIUS * 2}
            fill="#fbf6ec"
            stroke={SKEW_HANDLE_COLOR}
            strokeWidth={2.5}
            draggable
            dragBoundFunc={createBoundFunc(key)}
            onDragMove={(event: any) => {
              event.cancelBubble = true;
              const localPointer = getLocalPointer(event.target);
              if (!localPointer) return;
              onDraftChange({
                shape: updatePanelShapeHandle(shape, key, panel.width, localPointer.x)
              });
            }}
            onDragEnd={(event: any) => {
              event.cancelBubble = true;
              const localPointer = getLocalPointer(event.target);
              if (!localPointer) return;
              onCommit({
                shape: updatePanelShapeHandle(shape, key, panel.width, localPointer.x)
              });
            }}
          />
        );
      })}

      {/* 4 Edge Midpoint Handles */}
      {PANEL_EDGE_HANDLE_KEYS.map((key) => {
        const point = getPanelEdgeHandlePoint({ width: panel.width, height: panel.height, shape }, key);

        return (
          <Rect
            key={`edge-${key}`}
            name="panel-edge-handle"
            x={panel.x + point.x - 7}
            y={panel.y + point.y - 7}
            width={14}
            height={14}
            cornerRadius={3}
            fill="#171815"
            stroke="#fbf6ec"
            strokeWidth={2}
            draggable
            onDragMove={(event: any) => {
              event.cancelBubble = true;
              const localPointer = getLocalPointer(event.target);
              if (!localPointer) return;
              const updated = updatePanelEdgeHandle(panel, key, localPointer);
              onDraftChange(updated);
            }}
            onDragEnd={(event: any) => {
              event.cancelBubble = true;
              const localPointer = getLocalPointer(event.target);
              if (!localPointer) return;
              const updated = updatePanelEdgeHandle(panel, key, localPointer);
              onCommit(updated);
            }}
          />
        );
      })}
    </Group>
  );
}

// Smart Snapping & Guides Helper
type SnapResult = {
  x: number;
  y: number;
  guideX: number | null;
  guideY: number | null;
};

function calculateSnap(
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

function SnapGuidesOverlay({
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

function getBubbleTailHandlePos(bubble: Bubble): { x: number; y: number } {
  if (!bubble.tailTip) {
    return { x: bubble.width / 2, y: bubble.height + 25 };
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
function BubbleShape({ bubble }: { bubble: Bubble }) {
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
    const numSpikes = 14;
    const outerRx = W / 2 + 5;
    const outerRy = H / 2 + 5;
    const innerRx = Math.max(10, W / 2 - 12);
    const innerRy = Math.max(10, H / 2 - 12);

    let tailSpikeIndex = -1;
    if (bubble.tailTip) {
      const tailAngle = Math.atan2(bubble.tailTip[1] - cy, bubble.tailTip[0] - cx);
      let normTail = tailAngle < 0 ? tailAngle + 2 * Math.PI : tailAngle;
      let minDiff = Infinity;
      for (let i = 0; i < numSpikes; i++) {
        const a = (i * 2 * Math.PI) / numSpikes;
        let d = Math.abs(normTail - a);
        if (d > Math.PI) d = 2 * Math.PI - d;
        if (d < minDiff) {
          minDiff = d;
          tailSpikeIndex = i;
        }
      }
    }

    return (
      <Shape
        sceneFunc={(context, shape) => {
          context.beginPath();
          for (let i = 0; i < numSpikes; i++) {
            const outerAngle = (i * 2 * Math.PI) / numSpikes;
            let tipX = cx + outerRx * Math.cos(outerAngle);
            let tipY = cy + outerRy * Math.sin(outerAngle);

            if (i === tailSpikeIndex && bubble.tailTip) {
              tipX = bubble.tailTip[0];
              tipY = bubble.tailTip[1];
            }

            if (i === 0) {
              context.moveTo(tipX, tipY);
            } else {
              context.lineTo(tipX, tipY);
            }

            const innerAngle = outerAngle + Math.PI / numSpikes;
            const valleyX = cx + innerRx * Math.cos(innerAngle);
            const valleyY = cy + innerRy * Math.sin(innerAngle);
            context.lineTo(valleyX, valleyY);
          }
          context.closePath();
          context.fillStrokeShape(shape);
        }}
        fill={bubble.background}
        stroke={bubble.borderColor}
        strokeWidth={2.5}
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
function BubbleText({ bubble }: { bubble: Bubble }) {
  if (bubble.direction === "vertical") {
    const rawText = bubble.text || "";
    const fontSize = bubble.fontSize || 20;
    const maxCharsPerCol = Math.max(2, Math.floor((bubble.height - 24) / (fontSize * 1.25)));
    const cols = verticalColumns(rawText, maxCharsPerCol);
    const colCount = Math.max(1, cols.length);
    const colWidth = Math.max(18, Math.min(36, Math.floor((bubble.width - 20) / colCount)));
    const startX = Math.max(8, bubble.width - 12 - colWidth);

    return (
      <Group listening={false}>
        {cols.map((colTokens, colIdx) => {
          const colX = startX - colIdx * colWidth;
          const colY = 12;
          const colText = colTokens.join("\n");

          return (
            <Text
              key={colIdx}
              x={colX}
              y={colY}
              width={colWidth}
              text={colText}
              align="center"
              fontSize={fontSize}
              fontFamily={bubble.fontFamily || "Consolas, 'Microsoft YaHei', sans-serif"}
              fill={bubble.textColor || "#171815"}
              lineHeight={1.22}
            />
          );
        })}
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
      fontSize={bubble.fontSize || 17}
      fontFamily={bubble.fontFamily || "Consolas, 'Microsoft YaHei', sans-serif"}
      fill={bubble.textColor || "#171815"}
      lineHeight={1.25}
      wrap="char"
      listening={false}
    />
  );
}

// Background comparison layer for sketch draft
function SketchLayerImage({
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
function RenderLayerImage({
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
function LiveAreaOverlay({ width, height }: { width: number; height: number }) {
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
function ReadingFlowOverlay({ panels }: { panels: Panel[] }) {
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

const CanvasEditor = forwardRef<CanvasEditorHandle>(function CanvasEditor(_props, ref) {
  const activePage = useEditorStore((state) => getActivePage(state.project));
  const sodaProject = useEditorStore((state) => state.sodaProject);
  const sodaPage = useEditorStore((state) => state.sodaPage);
  const currentVersion = useEditorStore((state) => state.currentVersion);
  const selection = useEditorStore((state) => state.selection);
  const layerSettings = useEditorStore((state) => state.layerSettings);
  const selectedRenderUrl = useEditorStore((state) => state.selectedRenderUrl);
  const validationIssues = useEditorStore((state) => state.validationIssues);
  const sketchGeometry = useEditorStore((state) => state.sketchGeometry);
  const characters = useEditorStore((state) => state.characters);

  const selectItem = useEditorStore((state) => state.selectItem);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const updatePanel = useEditorStore((state) => state.updatePanel);
  const updateSodaPanel = useEditorStore((state) => state.updateSodaPanel);
  const updateBubble = useEditorStore((state) => state.updateBubble);
  const updateSodaText = useEditorStore((state) => state.updateSodaText);
  const updateSodaOverlay = useEditorStore((state) => state.updateSodaOverlay);
  const addFigureToPanel = useEditorStore((state) => state.addFigureToPanel);
  const updateFigureInPanel = useEditorStore((state) => state.updateFigureInPanel);
  const removeFigureFromPanel = useEditorStore((state) => state.removeFigureFromPanel);
  const splitPanelHorizontal = useEditorStore((state) => state.splitPanelHorizontal);
  const splitPanelVertical = useEditorStore((state) => state.splitPanelVertical);
  const addTextToPanel = useEditorStore((state) => state.addTextToPanel);
  const setNotice = useEditorStore((state) => state.setNotice);
  const openLayoutModal = useEditorStore((state) => state.openLayoutModal);
  const openPreviewModal = useEditorStore((state) => state.openPreviewModal);
  const openCommandPalette = useEditorStore((state) => state.openCommandPalette);

  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const [zoom, setZoom] = useState(0.44);
  const [panelDraft, setPanelDraft] = useState<{ panelId: string; patch: Partial<Panel> } | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });

  // Context Menu state
  type ContextMenuData = {
    x: number;
    y: number;
    target:
      | { kind: "panel"; id: string }
      | { kind: "bubble"; id: string }
      | { kind: "canvas" };
  };
  const [contextMenu, setContextMenu] = useState<ContextMenuData | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (contextMenuRef.current && contextMenuRef.current.contains(e.target as Node)) {
        return;
      }
      setContextMenu(null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  // Canvas Pan & Gesture Navigation (Item 1 suggestion)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number }>({
    x: 0,
    y: 0,
    panX: 0,
    panY: 0
  });

  // Guide toggles
  const [showLiveArea, setShowLiveArea] = useState<boolean>(false);
  const [showReadingFlow, setShowReadingFlow] = useState<boolean>(false);

  // In-Place Inline Textarea Edit state (Item 2 suggestion)
  const [editingBubble, setEditingBubble] = useState<{
    id: string;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // In-Place Inline Panel Description Edit state
  const [editingPanelDesc, setEditingPanelDesc] = useState<{
    id: string;
    order: number;
    description: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Stick Figure Quick Popover Menu state
  const [activeFigureMenu, setActiveFigureMenu] = useState<{
    panelId: string;
    figureIndex: number;
    charId: string;
    x: number;
    y: number;
  } | null>(null);

  // Global Space key listeners for Pan
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable;
      if (e.code === "Space" && !isInput && !e.repeat) {
        e.preventDefault();
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setIsSpacePressed(false);
        setIsPanning(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Auto-fit zoom on mount or page change
  const autoFitZoom = () => {
    if (activePage.canvas.width && activePage.canvas.height) {
      const containerHeight = window.innerHeight - 200;
      const containerWidth = window.innerWidth - 620;
      const fitZoom = Math.min(
        0.75,
        Math.max(0.3, Math.min(containerHeight / activePage.canvas.height, containerWidth / activePage.canvas.width) * 0.95)
      );
      setZoom(Math.round(fitZoom * 100) / 100);
      setPan({ x: 0, y: 0 });
    }
  };

  useEffect(() => {
    autoFitZoom();
  }, [activePage.id]);

  const selectedNodeId = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === "panel") return `panel-${selection.id}`;
    if (selection.kind === "text" || selection.kind === "bubble") return `bubble-${selection.id}`;
    if (selection.kind === "overlay") return `overlay-${selection.id}`;
    return null;
  }, [selection]);

  const selectedPanel = useMemo(() => {
    if (selection?.kind !== "panel") return null;
    return activePage.panels.find((p) => p.id === selection.id) || null;
  }, [selection, activePage.panels]);

  // Attach transformer to selected node
  useEffect(() => {
    if (!transformerRef.current || !stageRef.current) return;

    if (!selectedNodeId) {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
      return;
    }

    const node = stageRef.current.findOne(`#${selectedNodeId}`);
    if (!node) {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
      return;
    }

    transformerRef.current.nodes([node]);
    transformerRef.current.getLayer()?.batchDraw();
  }, [selectedNodeId, activePage.id, activePage.panels, activePage.bubbles, sodaPage?.overlays]);

  useImperativeHandle(
    ref,
    () => ({
      exportPng: async () => {
        const stage = stageRef.current;
        if (!stage) return;
        const dataUrl = stage.toDataURL({ pixelRatio: 2 });
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `${activePage.id || "page"}.png`;
        a.click();
      },
      exportPdf: async () => {}
    }),
    [activePage.id]
  );

  const handleMouseDown = (event: any) => {
    const target = event.target;
    const onPanel = Boolean(target?.findAncestor?.(".panel-node", true));
    const onBubble = Boolean(target?.findAncestor?.(".bubble-node", true));
    const onOverlay = Boolean(target?.findAncestor?.(".overlay-node", true));
    const onTransformer = Boolean(target?.findAncestor?.(".selection-transformer", true));
    const onSkewHandle = Boolean(
      target?.findAncestor?.(".panel-skew-handle", true) ||
      target?.findAncestor?.(".panel-edge-handle", true) ||
      target?.findAncestor?.(".panel-skew-overlay", true)
    );

    if (onPanel || onBubble || onOverlay || onTransformer || onSkewHandle) {
      return;
    }

    selectItem(null);
    setActiveFigureMenu(null);
  };

  const adjustZoom = (delta: number) => {
    setZoom((current) => clampZoom(current + delta));
  };

  const canvasWidth = activePage.canvas.width || 1024;
  const canvasHeight = activePage.canvas.height || 1536;

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-[var(--paper-wash)] select-none">
      {/* Zoom and Scale Controls Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] bg-[var(--paper-surface)] px-4 py-2 font-mono text-[13px]">
        <div className="flex items-center gap-3">
          <span className="font-bold text-[var(--ink)]">
            画布 {canvasWidth} × {canvasHeight}
          </span>
          <span className="text-[var(--rule)]">|</span>
          <span className="text-[var(--ink-light)]">
            {sodaPage?.reading_direction === "rtl" ? "日漫顺序: 右上 ➔ 左下" : "左 ➔ 右"}
          </span>
          <span className="text-[var(--rule)]">|</span>
          {/* Guide toggles */}
          <label className="flex items-center gap-1 cursor-pointer text-xs font-sans text-[var(--ink)]">
            <input
              type="checkbox"
              checked={showLiveArea}
              onChange={(e) => setShowLiveArea(e.target.checked)}
              className="accent-[var(--signal)]"
            />
            <span>版心线</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer text-xs font-sans text-[var(--ink)]">
            <input
              type="checkbox"
              checked={showReadingFlow}
              onChange={(e) => setShowReadingFlow(e.target.checked)}
              className="accent-[var(--signal)]"
            />
            <span>视线流</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--ink-light)] font-sans mr-2">
            按住空格+拖拽平移，滚轮缩放
          </span>
          <button
            type="button"
            className="ui-btn ui-btn-sm text-[13px]"
            onClick={() => adjustZoom(-0.05)}
            title="缩小"
          >
            -
          </button>
          <span className="w-12 text-center text-[13px] font-bold text-[var(--ink)]">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="ui-btn ui-btn-sm text-[13px]"
            onClick={() => adjustZoom(0.05)}
            title="放大"
          >
            +
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-sm text-[13px]"
            onClick={autoFitZoom}
            title="适应屏幕并居中"
          >
            适应
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-sm text-[13px]"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            title="原始尺寸 100%"
          >
            100%
          </button>
        </div>
      </div>

      {/* Canvas Workspace with Pan & Smooth Wheel Zoom */}
      <div
        className="flex flex-1 min-h-0 items-center justify-center overflow-hidden p-8 select-none relative"
        style={{
          cursor: isPanning ? "grabbing" : isSpacePressed ? "grab" : "default"
        }}
        onMouseDown={(e) => {
          if (isSpacePressed || e.button === 1) {
            e.preventDefault();
            setIsPanning(true);
            panStartRef.current = {
              x: e.clientX,
              y: e.clientY,
              panX: pan.x,
              panY: pan.y
            };
          }
        }}
        onMouseMove={(e) => {
          if (isPanning) {
            e.preventDefault();
            setPan({
              x: panStartRef.current.panX + (e.clientX - panStartRef.current.x),
              y: panStartRef.current.panY + (e.clientY - panStartRef.current.y)
            });
          }
        }}
        onMouseUp={() => setIsPanning(false)}
        onWheel={(e) => {
          e.preventDefault();
          const scaleFactor = 1.08;
          const isZoomIn = e.deltaY < 0;
          const newZoom = clampZoom(isZoomIn ? zoom * scaleFactor : zoom / scaleFactor);
          setZoom(Math.round(newZoom * 1000) / 1000);
        }}
      >
        <div
          className="canvas-page-paper relative transition-transform duration-75 ease-out shadow-2xl"
          style={{
            width: Math.ceil(canvasWidth * zoom),
            height: Math.ceil(canvasHeight * zoom),
            transform: `translate(${pan.x}px, ${pan.y}px)`
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("application/soda-character-id")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            const charId = e.dataTransfer.getData("application/soda-character-id");
            if (!charId) return;
            e.preventDefault();

            const rect = e.currentTarget.getBoundingClientRect();
            const canvasX = (e.clientX - rect.left) / zoom;
            const canvasY = (e.clientY - rect.top) / zoom;

            const targetPanel = activePage.panels.find((p) => {
              return (
                canvasX >= p.x &&
                canvasX <= p.x + p.width &&
                canvasY >= p.y &&
                canvasY <= p.y + p.height
              );
            });

            if (targetPanel) {
              const relX = Number(
                Math.max(0.1, Math.min(0.9, (canvasX - targetPanel.x) / targetPanel.width)).toFixed(2)
              );
              addFigureToPanel(targetPanel.id, {
                character_id: charId,
                position: relX,
                facing: "front",
                pose: "stand"
              });
              const currentChars = targetPanel.sodaData?.character_ids || [];
              if (!currentChars.includes(charId)) {
                updateSodaPanel(targetPanel.id, {
                  character_ids: [...currentChars, charId]
                });
              }
              selectItem({ kind: "panel", id: targetPanel.id });
              setNotice(`已将角色 [${charId}] 放置于格 #${targetPanel.order}`);
            }
          }}
        >
          {/* Floating mini-toolbar beside selected panel */}
          {selectedPanel && (
            <div
              className="absolute z-30 flex flex-col gap-1 rounded bg-[#171815] p-1.5 shadow-2xl text-white font-sans text-xs select-none border border-neutral-700"
              style={{
                left: Math.min(
                  canvasWidth * zoom - 90,
                  Math.max(8, (selectedPanel.x + selectedPanel.width) * zoom + 8)
                ),
                top: Math.max(8, selectedPanel.y * zoom)
              }}
            >
              <button
                type="button"
                className="flex items-center gap-1.5 px-2.5 py-1 hover:bg-[#333] rounded text-[13px] font-semibold text-left text-white"
                onClick={() => {
                  const defaultCharId = sodaProject?.characters?.[0]?.id || "char";
                  addFigureToPanel(selectedPanel.id, {
                    character_id: defaultCharId,
                    position: "center",
                    facing: "front",
                    pose: "stand"
                  });
                }}
                title="在当前格添加人物"
              >
                <span>+</span> 人物
              </button>
              <button
                type="button"
                className="flex items-center gap-1.5 px-2.5 py-1 hover:bg-[#333] rounded text-[13px] font-semibold text-left text-white"
                onClick={() => addTextToPanel(selectedPanel.id)}
                title="在当前格添加台词"
              >
                <span>+</span> 文字
              </button>
              <div className="h-[1px] bg-neutral-700 my-0.5" />
              <button
                type="button"
                className="flex items-center gap-1.5 px-2.5 py-1 hover:bg-[#333] rounded text-[13px] font-semibold text-left text-white"
                onClick={() => splitPanelHorizontal(selectedPanel.id)}
                title="水平切为上下两格"
              >
                横切
              </button>
              <button
                type="button"
                className="flex items-center gap-1.5 px-2.5 py-1 hover:bg-[#333] rounded text-[13px] font-semibold text-left text-white"
                onClick={() => splitPanelVertical(selectedPanel.id)}
                title="垂直切为左右两格"
              >
                竖切
              </button>
              <div className="h-[1px] bg-neutral-700 my-0.5" />
              <button
                type="button"
                className="flex items-center gap-1.5 px-2.5 py-1 hover:bg-red-950 text-red-400 rounded text-[13px] font-semibold text-left"
                onClick={() => deleteSelection()}
                title="删除此分镜格"
              >
                删除
              </button>
            </div>
          )}

          {/* In-Place Textarea for Double-Click Bubble Editing */}
          {editingBubble && (
            <div
              className="absolute z-50 bg-white shadow-2xl border-2 border-[var(--signal)] rounded p-2"
              style={{
                left: editingBubble.x * zoom,
                top: editingBubble.y * zoom,
                width: Math.max(140, editingBubble.width * zoom),
                minHeight: Math.max(90, editingBubble.height * zoom)
              }}
            >
              <div className="text-xs font-bold text-[var(--signal)] mb-1 flex justify-between">
                <span>编辑台词</span>
                <span className="text-[11px] text-neutral-400 font-normal">Esc 取消</span>
              </div>
              <textarea
                autoFocus
                defaultValue={editingBubble.text}
                rows={4}
                className="w-full resize-none border border-neutral-300 rounded p-1.5 text-sm font-sans outline-none focus:border-[var(--signal)]"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setEditingBubble(null);
                  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    updateSodaText(editingBubble.id, { text: e.currentTarget.value });
                    setEditingBubble(null);
                  }
                }}
                onBlur={(e) => {
                  updateSodaText(editingBubble.id, { text: e.target.value });
                  setEditingBubble(null);
                }}
              />
              <div className="flex justify-between items-center mt-1 text-[11px] text-[var(--ink-light)]">
                <span>Ctrl+Enter 保存</span>
              </div>
            </div>
          )}

          {/* In-Place Popover for Double-Click Panel Description Editing */}
          {editingPanelDesc && (
            <div
              className="absolute z-50 bg-[#171815] text-[#fbf6ec] shadow-2xl border border-neutral-600 rounded p-3"
              style={{
                left: Math.max(10, Math.min(canvasWidth * zoom - 300, (editingPanelDesc.x + 20) * zoom)),
                top: Math.max(10, Math.min(canvasHeight * zoom - 160, (editingPanelDesc.y + 20) * zoom)),
                width: 280
              }}
            >
              <div className="flex justify-between items-center mb-1.5 text-xs font-bold text-amber-400">
                <span>格 #{editingPanelDesc.order} 画面描述</span>
                <button
                  type="button"
                  onClick={() => setEditingPanelDesc(null)}
                  className="text-neutral-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
              <textarea
                autoFocus
                defaultValue={editingPanelDesc.description}
                rows={3}
                className="w-full bg-[#242521] text-white border border-neutral-700 rounded p-2 text-xs outline-none focus:border-amber-400 resize-none font-sans"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setEditingPanelDesc(null);
                  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    updateSodaPanel(editingPanelDesc.id, { description: e.currentTarget.value });
                    setEditingPanelDesc(null);
                  }
                }}
                onBlur={(e) => {
                  updateSodaPanel(editingPanelDesc.id, { description: e.target.value });
                }}
              />
              <div className="flex justify-between items-center mt-2 text-[11px] text-neutral-400">
                <span>Ctrl+Enter 保存</span>
                <button
                  type="button"
                  className="px-2.5 py-0.5 bg-amber-400 hover:bg-amber-500 text-black font-bold text-xs rounded"
                  onClick={(e) => {
                    const ta = e.currentTarget.parentElement?.previousElementSibling as HTMLTextAreaElement;
                    if (ta) updateSodaPanel(editingPanelDesc.id, { description: ta.value });
                    setEditingPanelDesc(null);
                  }}
                >
                  完成
                </button>
              </div>
            </div>
          )}

          {/* Stick Figure Quick Popover Menu */}
          {activeFigureMenu && (
            <div
              className="absolute z-50 bg-[#171815] text-white rounded shadow-2xl border border-neutral-700 p-2 text-xs space-y-2 select-none"
              style={{
                left: Math.min(canvasWidth * zoom - 190, Math.max(10, activeFigureMenu.x * zoom)),
                top: Math.max(10, activeFigureMenu.y * zoom - 90)
              }}
            >
              <div className="flex items-center justify-between border-b border-neutral-700 pb-1">
                <span className="font-bold text-amber-400">人物: {activeFigureMenu.charId}</span>
                <button
                  type="button"
                  onClick={() => setActiveFigureMenu(null)}
                  className="text-neutral-400 hover:text-white px-1"
                >
                  ✕
                </button>
              </div>
              <div>
                <span className="text-[10px] text-neutral-400 block mb-1">朝向</span>
                <div className="flex gap-1">
                  {(["front", "left", "right", "back"] as const).map((facing) => (
                    <button
                      key={facing}
                      type="button"
                      onClick={() => {
                        updateFigureInPanel(activeFigureMenu.panelId, activeFigureMenu.figureIndex, { facing });
                        setActiveFigureMenu(null);
                      }}
                      className="px-1.5 py-0.5 bg-[#333] hover:bg-neutral-600 rounded text-[11px]"
                    >
                      {facing === "front" ? "正" : facing === "left" ? "左" : facing === "right" ? "右" : "背"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-[10px] text-neutral-400 block mb-1">景框</span>
                <div className="flex gap-1">
                  {([
                    { label: "全", val: "full" },
                    { label: "半", val: "waist" },
                    { label: "胸", val: "bust" },
                    { label: "脸", val: "face" }
                  ] as const).map((item) => (
                    <button
                      key={item.val}
                      type="button"
                      onClick={() => {
                        updateFigureInPanel(activeFigureMenu.panelId, activeFigureMenu.figureIndex, { framing: item.val });
                        setActiveFigureMenu(null);
                      }}
                      className="px-1.5 py-0.5 bg-[#333] hover:bg-neutral-600 rounded text-[11px]"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <Stage
            ref={stageRef}
            width={Math.ceil(canvasWidth * zoom)}
            height={Math.ceil(canvasHeight * zoom)}
            scaleX={zoom}
            scaleY={zoom}
            onMouseDown={handleMouseDown}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              setContextMenu({
                x: e.evt.clientX,
                y: e.evt.clientY,
                target: { kind: "canvas" }
              });
            }}
          >
            <Layer>
              {/* White Background Canvas */}
              <Rect
                name="canvas-bg"
                x={0}
                y={0}
                width={canvasWidth}
                height={canvasHeight}
                fill="#ffffff"
              />

              {/* Live Area Reference Guide */}
              {showLiveArea && <LiveAreaOverlay width={canvasWidth} height={canvasHeight} />}

              {/* Layer 1: Render result bottom layer */}
              {layerSettings.showRender && selectedRenderUrl && (
                <RenderLayerImage
                  renderUrl={selectedRenderUrl}
                  canvasWidth={canvasWidth}
                  canvasHeight={canvasHeight}
                  opacity={layerSettings.renderOpacity}
                />
              )}

              {/* Layer 2: Sketch preview draft comparison layer */}
              {layerSettings.showSketch && activePage.id && (
                <SketchLayerImage
                  pageId={activePage.id}
                  version={currentVersion}
                  canvasWidth={canvasWidth}
                  canvasHeight={canvasHeight}
                  opacity={layerSettings.sketchOpacity}
                />
              )}

              {/* Layer 3: Panels */}
              {activePage.panels.map((panel) => {
                const selected = selection?.kind === "panel" && selection.id === panel.id;
                const hasError = validationIssues.some(
                  (v) => v.panel_id === panel.id
                );

                const displayPanel =
                  panelDraft?.panelId === panel.id
                    ? {
                        ...panel,
                        ...panelDraft.patch,
                        shape: panelDraft.patch.shape ?? panel.shape
                      }
                    : panel;
                const transform = getPanelRenderTransform(displayPanel);

                return (
                  <Fragment key={panel.id}>
                    <Group
                      id={`panel-${panel.id}`}
                      name="panel-node"
                      x={transform.x}
                      y={transform.y}
                      width={displayPanel.width}
                      height={displayPanel.height}
                      offsetX={transform.offsetX}
                      offsetY={transform.offsetY}
                      rotation={transform.rotation}
                      draggable={!isSpacePressed}
                      onClick={(event) => {
                        event.cancelBubble = true;
                        selectItem({ kind: "panel", id: panel.id });
                      }}
                      onTap={(event) => {
                        event.cancelBubble = true;
                        selectItem({ kind: "panel", id: panel.id });
                      }}
                      onContextMenu={(event) => {
                        event.evt.preventDefault();
                        event.cancelBubble = true;
                        selectItem({ kind: "panel", id: panel.id });
                        setContextMenu({
                          x: event.evt.clientX,
                          y: event.evt.clientY,
                          target: { kind: "panel", id: panel.id }
                        });
                      }}
                      onDblClick={(event) => {
                        event.cancelBubble = true;
                        setEditingPanelDesc({
                          id: panel.id,
                          order: displayPanel.order,
                          description: displayPanel.sodaData?.description || "",
                          x: displayPanel.x,
                          y: displayPanel.y,
                          width: displayPanel.width,
                          height: displayPanel.height
                        });
                      }}
                      onDragMove={(event) => {
                        const panelTargets = activePage.panels
                          .filter((p) => p.id !== panel.id)
                          .map((p) => ({ id: p.id, x: p.x, y: p.y, width: p.width, height: p.height }));
                        const snap = calculateSnap(
                          panel.id,
                          event.target.x() - displayPanel.width / 2,
                          event.target.y() - displayPanel.height / 2,
                          displayPanel.width,
                          displayPanel.height,
                          panelTargets,
                          canvasWidth,
                          canvasHeight
                        );
                        if (snap.guideX !== null) event.target.x(snap.x + displayPanel.width / 2);
                        if (snap.guideY !== null) event.target.y(snap.y + displayPanel.height / 2);
                        setSnapGuides({ x: snap.guideX, y: snap.guideY });
                      }}
                      onDragEnd={(event) => {
                        setSnapGuides({ x: null, y: null });
                        updatePanel(panel.id, {
                          x: event.target.x() - displayPanel.width / 2,
                          y: event.target.y() - displayPanel.height / 2
                        });
                      }}
                    >
                      <PanelFillShape panel={displayPanel} />
                      <PanelImageLayer panel={displayPanel} />

                      {/* Sketch Geometry Primitives inside panel */}
                      <SketchGeometryPanelLayer
                        panel={displayPanel}
                        sketchGeometry={sketchGeometry}
                        onDragFigure={(_charId, figIdx, newPos) => {
                          const relX = Number(
                            Math.max(0, Math.min(1, (newPos[0] - displayPanel.x) / displayPanel.width)).toFixed(2)
                          );
                          updateFigureInPanel(panel.id, figIdx, { position: relX });
                        }}
                        onClickFigure={(figIdx, charId, _fig, clientPos) => {
                          setActiveFigureMenu({
                            panelId: panel.id,
                            figureIndex: figIdx,
                            charId,
                            x: clientPos.x,
                            y: clientPos.y
                          });
                        }}
                      />

                      <PanelBorderShape panel={displayPanel} selected={selected} hasError={hasError} />

                      {/* Reading Order Badge on top-right */}
                      <Group x={displayPanel.width - 36} y={4} listening={false}>
                        <Rect
                          width={32}
                          height={22}
                          fill={selected ? "#9a321f" : hasError ? "#d93829" : "#171815"}
                          cornerRadius={2}
                        />
                        <Text
                          x={0}
                          y={3}
                          width={32}
                          text={`#${displayPanel.order}`}
                          align="center"
                          fill="#fbf6ec"
                          fontSize={14}
                          fontStyle="bold"
                          fontFamily="Consolas, monospace"
                        />
                      </Group>

                      {/* Panel Description Preview at bottom */}
                      {displayPanel.sodaData?.description && (
                        <Group x={8} y={displayPanel.height - 26} listening={false}>
                          <Rect
                            width={Math.min(displayPanel.width - 16, displayPanel.sodaData.description.length * 13 + 12)}
                            height={20}
                            fill="rgba(23, 24, 21, 0.85)"
                            cornerRadius={2}
                          />
                          <Text
                            x={6}
                            y={3}
                            text={
                              displayPanel.sodaData.description.length > 25
                                ? `${displayPanel.sodaData.description.slice(0, 24)}…`
                                : displayPanel.sodaData.description
                            }
                            fill="#fbf6ec"
                            fontSize={12}
                            fontFamily="'Microsoft YaHei', sans-serif"
                          />
                        </Group>
                      )}
                    </Group>

                    {/* Skew Corner & Edge Midpoint Drag Handles */}
                    {selected && (
                      <PanelSkewHandles
                        panel={displayPanel}
                        onDraftChange={(patch) => {
                          setPanelDraft({
                            panelId: panel.id,
                            patch
                          });
                        }}
                        onCommit={(patch) => {
                          setPanelDraft(null);
                          updatePanel(panel.id, patch);
                        }}
                      />
                    )}
                  </Fragment>
                );
              })}

              {/* Reading Flow Overlay */}
              {showReadingFlow && <ReadingFlowOverlay panels={activePage.panels} />}

              {/* Smart Snapping Alignment Guides */}
              <SnapGuidesOverlay
                guideX={snapGuides.x}
                guideY={snapGuides.y}
                canvasWidth={canvasWidth}
                canvasHeight={canvasHeight}
              />

              {/* Layer 4: Overlays (跨格人物框) */}
              {(sodaPage?.overlays || []).map((overlay) => {
                const selected = selection?.kind === "overlay" && selection.id === overlay.id;
                const rect = overlay.rect || { x: 50, y: 50, w: 200, h: 200 };
                const overlayFigure = overlay.character_id
                  ? generateOverlayFigure(overlay, characters as any)
                  : null;

                return (
                  <Group
                    key={overlay.id}
                    id={`overlay-${overlay.id}`}
                    name="overlay-node"
                    x={rect.x}
                    y={rect.y}
                    width={rect.w}
                    height={rect.h}
                    draggable={!isSpacePressed}
                    onClick={(event) => {
                      event.cancelBubble = true;
                      selectItem({ kind: "overlay", id: overlay.id });
                    }}
                    onDragEnd={(event) => {
                      updateSodaOverlay(overlay.id, {
                        rect: {
                          type: "rect",
                          x: Math.round(event.target.x()),
                          y: Math.round(event.target.y()),
                          w: rect.w,
                          h: rect.h
                        }
                      });
                    }}
                  >
                    <Rect
                      width={rect.w}
                      height={rect.h}
                      stroke="#9a321f"
                      strokeWidth={2}
                      dash={[6, 4]}
                      fill={selected ? "rgba(154, 50, 31, 0.12)" : "rgba(154, 50, 31, 0.04)"}
                    />
                    {/* Render overlay stick figure so middle character is clearly visible */}
                    {overlayFigure && (
                      <Group listening={false}>
                        {overlayFigure.primitives.map((prim, primIdx) => {
                          if (prim.type === "circle") {
                            return (
                              <Circle
                                key={primIdx}
                                x={prim.cx - rect.x}
                                y={prim.cy - rect.y}
                                radius={prim.r}
                                stroke="#9a321f"
                                strokeWidth={2.2}
                                fill="rgba(154, 50, 31, 0.08)"
                              />
                            );
                          }
                          if (prim.type === "line") {
                            const flatPoints = prim.points.flatMap(([px, py]) => [px - rect.x, py - rect.y]);
                            return (
                              <KonvaLine
                                key={primIdx}
                                points={flatPoints}
                                stroke="#9a321f"
                                strokeWidth={prim.width || 3}
                                lineCap="round"
                                lineJoin="round"
                              />
                            );
                          }
                          return null;
                        })}
                      </Group>
                    )}
                    {/* Badge */}
                    <Group x={4} y={4} listening={false}>
                      <Rect width={110} height={20} fill="#9a321f" cornerRadius={2} />
                      <Text
                        x={4}
                        y={3}
                        text={`跨格: ${overlay.character_id}`}
                        fill="#ffffff"
                        fontSize={12}
                        fontStyle="bold"
                        fontFamily="Consolas, monospace"
                      />
                    </Group>
                  </Group>
                );
              })}

              {/* Layer 5: Text Bubbles */}
              {activePage.bubbles.map((bubble) => {
                const selected =
                  (selection?.kind === "text" || selection?.kind === "bubble") &&
                  selection.id === bubble.id;
                const hasError = validationIssues.some(
                  (v) => v.field === "texts" || (v as any).text_id === bubble.id
                );

                return (
                  <Fragment key={bubble.id}>
                    <Group
                      id={`bubble-${bubble.id}`}
                      name="bubble-node"
                      x={bubble.x}
                      y={bubble.y}
                      width={bubble.width}
                      height={bubble.height}
                      draggable={!isSpacePressed}
                      onClick={(event) => {
                        event.cancelBubble = true;
                        selectItem({ kind: "text", id: bubble.id });
                      }}
                      onContextMenu={(event) => {
                        event.evt.preventDefault();
                        event.cancelBubble = true;
                        selectItem({ kind: "text", id: bubble.id });
                        setContextMenu({
                          x: event.evt.clientX,
                          y: event.evt.clientY,
                          target: { kind: "bubble", id: bubble.id }
                        });
                      }}
                      onDblClick={(event) => {
                        event.cancelBubble = true;
                        setEditingBubble({
                          id: bubble.id,
                          text: bubble.text,
                          x: bubble.x,
                          y: bubble.y,
                          width: bubble.width,
                          height: bubble.height
                        });
                      }}
                      onDragMove={(event) => {
                        const bubbleTargets = activePage.bubbles
                          .filter((b) => b.id !== bubble.id)
                          .map((b) => ({ id: b.id, x: b.x, y: b.y, width: b.width, height: b.height }));
                        const snap = calculateSnap(
                          bubble.id,
                          event.target.x(),
                          event.target.y(),
                          bubble.width,
                          bubble.height,
                          bubbleTargets,
                          canvasWidth,
                          canvasHeight
                        );
                        if (snap.guideX !== null) event.target.x(snap.x);
                        if (snap.guideY !== null) event.target.y(snap.y);
                        setSnapGuides({ x: snap.guideX, y: snap.guideY });
                      }}
                      onDragEnd={(event) => {
                        setSnapGuides({ x: null, y: null });
                        const newX = Math.round(event.target.x());
                        const newY = Math.round(event.target.y());
                        updateBubble(bubble.id, {
                          x: newX,
                          y: newY
                        });
                      }}
                      onTransformEnd={(event) => {
                        const node = event.target;
                        const nextWidth = Math.max(30, Math.round(node.width() * node.scaleX()));
                        const nextHeight = Math.max(30, Math.round(node.height() * node.scaleY()));
                        const nextX = Math.round(node.x());
                        const nextY = Math.round(node.y());
                        node.scaleX(1);
                        node.scaleY(1);

                        let nextTailTip = bubble.tailTip;
                        if (bubble.tailTip && bubble.width > 0 && bubble.height > 0) {
                          const scaleX = nextWidth / bubble.width;
                          const scaleY = nextHeight / bubble.height;
                          nextTailTip = [
                            Math.round(bubble.tailTip[0] * scaleX),
                            Math.round(bubble.tailTip[1] * scaleY)
                          ];
                        }

                        updateBubble(bubble.id, {
                          x: nextX,
                          y: nextY,
                          width: nextWidth,
                          height: nextHeight,
                          tailTip: nextTailTip
                        });
                        updateSodaText(bubble.id, {
                          tail_tip: nextTailTip
                        });
                      }}
                    >
                      <BubbleShape bubble={bubble} />
                      <BubbleText bubble={bubble} />
                      {selected && (
                        <Rect
                          width={bubble.width}
                          height={bubble.height}
                          stroke="#9a321f"
                          strokeWidth={2}
                          dash={[6, 3]}
                          listening={false}
                        />
                      )}
                      {hasError && (
                        <Rect
                          width={bubble.width}
                          height={bubble.height}
                          stroke="#d93829"
                          strokeWidth={3}
                          dash={[6, 3]}
                          listening={false}
                        />
                      )}
                    </Group>

                    {/* Draggable Tail Tip Handle (outside bubble group to keep transformer bounding box clean) */}
                    {selected &&
                      bubble.tailTip &&
                      bubble.sodaData?.bubble !== "box" &&
                      bubble.sodaData?.bubble !== "none" && (() => {
                        const hPos = getBubbleTailHandlePos(bubble);
                        return (
                          <Group
                            x={bubble.x + hPos.x}
                            y={bubble.y + hPos.y}
                            draggable={!isSpacePressed}
                            onDragStart={(event) => {
                              event.cancelBubble = true;
                            }}
                            onDragEnd={(event) => {
                              event.cancelBubble = true;
                              const newTx = Math.round(event.target.x() - bubble.x);
                              const newTy = Math.round(event.target.y() - bubble.y);
                              updateBubble(bubble.id, {
                                tailTip: [newTx, newTy]
                              });
                              updateSodaText(bubble.id, {
                                tail_tip: [newTx, newTy]
                              });
                            }}
                          >
                            <Circle
                              radius={7}
                              fill="#9a321f"
                              stroke="#ffffff"
                              strokeWidth={2}
                            />
                          </Group>
                        );
                      })()}
                  </Fragment>
                );
              })}

              {/* Transformer for Resizing text & bubbles */}
              <Transformer
                ref={transformerRef}
                name="selection-transformer"
                rotateEnabled={false}
                resizeEnabled={selection?.kind === "text" || selection?.kind === "bubble"}
                flipEnabled={false}
                enabledAnchors={
                  selection?.kind === "text" || selection?.kind === "bubble"
                    ? BUBBLE_TRANSFORMER_ANCHORS
                    : []
                }
                anchorSize={TRANSFORMER_ANCHOR_SIZE}
                keepRatio={false}
                borderStroke="#9a321f"
                anchorStroke="#9a321f"
                anchorFill="#fbf6ec"
              />
            </Layer>
          </Stage>
        </div>
      </div>

      {/* Native Desktop-Grade Right-Click Context Menu */}
      {contextMenu && (() => {
        const target = contextMenu.target;
        return (
          <div
            ref={contextMenuRef}
            className="fixed z-50 min-w-[210px] bg-[#171815] text-[#fbf6ec] border border-neutral-700 shadow-2xl rounded p-1.5 text-xs font-sans select-none"
            style={{
              left: Math.min(window.innerWidth - 220, Math.max(10, contextMenu.x)),
              top: Math.min(window.innerHeight - 320, Math.max(10, contextMenu.y))
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {target.kind === "panel" && (() => {
              const panelId = target.id;
              const panel = activePage.panels.find((p) => p.id === panelId);
              return (
                <>
                  <div className="px-2.5 py-1 text-[11px] font-mono text-[var(--signal)] font-bold border-b border-neutral-800 mb-1">
                    分镜格 #{panel?.order || ""}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const defaultCharId = sodaProject?.characters?.[0]?.id || "char";
                      addFigureToPanel(panelId, {
                        character_id: defaultCharId,
                        position: "center",
                        facing: "front",
                        pose: "stand"
                      });
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-[#333] hover:text-white rounded text-left"
                  >
                    <span>👤 添加人物</span>
                    <span className="text-[10px] text-neutral-400 font-mono">+人物</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      addTextToPanel(panelId);
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-[#333] hover:text-white rounded text-left"
                  >
                    <span>💬 添加台词</span>
                    <span className="text-[10px] text-neutral-400 font-mono">+文字</span>
                  </button>
                  <div className="h-[1px] bg-neutral-800 my-1" />
                  <button
                    type="button"
                    onClick={() => {
                      splitPanelHorizontal(panelId);
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-[#333] hover:text-white rounded text-left"
                  >
                    <span>✂ 水平切分 (上下两格)</span>
                    <span className="text-[10px] text-neutral-400 font-mono">横切</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      splitPanelVertical(panelId);
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-[#333] hover:text-white rounded text-left"
                  >
                    <span>✂ 垂直切分 (左右两格)</span>
                    <span className="text-[10px] text-neutral-400 font-mono">竖切</span>
                  </button>
                  <div className="h-[1px] bg-neutral-800 my-1" />
                  <button
                    type="button"
                    onClick={() => {
                      deleteSelection();
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-red-950 text-red-400 rounded text-left"
                  >
                    <span>🗑 删除此分镜格</span>
                    <span className="text-[10px] text-red-400 font-mono">Del</span>
                  </button>
                </>
              );
            })()}

            {target.kind === "bubble" && (() => {
              const bubbleId = target.id;
              const b = activePage.bubbles.find((item) => item.id === bubbleId);
              return (
                <>
                  <div className="px-2.5 py-1 text-[11px] font-mono text-[var(--signal)] font-bold border-b border-neutral-800 mb-1">
                    台词气泡
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (b) {
                        setEditingBubble({
                          id: b.id,
                          text: b.text,
                          x: b.x,
                          y: b.y,
                          width: b.width,
                          height: b.height
                        });
                      }
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-[#333] hover:text-white rounded text-left"
                  >
                    <span>✏️ 编辑台词文本</span>
                    <span className="text-[10px] text-neutral-400 font-mono">双击</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (b) {
                        const newDir = b.direction === "vertical" ? "horizontal" : "vertical";
                        let nextW = b.width;
                        let nextH = b.height;
                        if (newDir === "horizontal" && b.height > b.width * 1.2) {
                          nextW = Math.max(130, Math.min(260, Math.round(b.height * 0.7)));
                          nextH = Math.max(65, Math.min(130, Math.round(b.width * 0.9)));
                        } else if (newDir === "vertical" && b.width > b.height * 1.2) {
                          nextW = Math.max(65, Math.min(130, Math.round(b.height * 0.9)));
                          nextH = Math.max(140, Math.min(320, Math.round(b.width * 0.7)));
                        }
                        updateSodaText(b.id, {
                          direction: newDir,
                          bbox: { type: "rect", x: b.x, y: b.y, w: nextW, h: nextH }
                        });
                        updateBubble(b.id, {
                          direction: newDir,
                          width: nextW,
                          height: nextH
                        });
                      }
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-[#333] hover:text-white rounded text-left"
                  >
                    <span>🔄 切换横排 / 竖排</span>
                    <span className="text-[10px] text-neutral-400 font-mono">{b?.direction === "vertical" ? "竖排" : "横排"}</span>
                  </button>

                  {/* Tail tip toggle button */}
                  {b && (
                    <button
                      type="button"
                      onClick={() => {
                        if (b.tailTip) {
                          updateBubble(b.id, { tailTip: undefined });
                          updateSodaText(b.id, { tail_tip: undefined });
                        } else {
                          const defaultTx = Math.round(b.width / 2);
                          const defaultTy = Math.round(b.height + 28);
                          updateBubble(b.id, { tailTip: [defaultTx, defaultTy] });
                          updateSodaText(b.id, { tail_tip: [defaultTx, defaultTy] });
                        }
                        setContextMenu(null);
                      }}
                      className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-[#333] hover:text-white rounded text-left"
                    >
                      <span>{b.tailTip ? "✕ 移除引线" : "💬 添加引线"}</span>
                      <span className="text-[10px] text-neutral-400 font-mono">{b.tailTip ? "已开启" : "无引线"}</span>
                    </button>
                  )}

                  <div className="h-[1px] bg-neutral-800 my-1" />
                  <button
                    type="button"
                    onClick={() => {
                      updateSodaText(bubbleId, { bubble: "speech" });
                      updateBubble(bubbleId, { sodaData: { ...(b?.sodaData as any), bubble: "speech" } });
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-[#333] hover:text-white rounded text-left"
                  >
                    <span>💬 对话气泡 (圆角)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      updateSodaText(bubbleId, { bubble: "shout" });
                      updateBubble(bubbleId, { sodaData: { ...(b?.sodaData as any), bubble: "shout" } });
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-[#333] hover:text-white rounded text-left"
                  >
                    <span>💥 呐喊气泡 (重音)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      updateSodaText(bubbleId, { bubble: "thought" });
                      updateBubble(bubbleId, { sodaData: { ...(b?.sodaData as any), bubble: "thought" } });
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-[#333] hover:text-white rounded text-left"
                  >
                    <span>💭 思考气泡 (云泡)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      updateSodaText(bubbleId, { bubble: "box" });
                      updateBubble(bubbleId, { sodaData: { ...(b?.sodaData as any), bubble: "box" } });
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-[#333] hover:text-white rounded text-left"
                  >
                    <span>📦 方框旁白</span>
                  </button>
                  <div className="h-[1px] bg-neutral-800 my-1" />
                  <button
                    type="button"
                    onClick={() => {
                      deleteSelection();
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-red-950 text-red-400 rounded text-left"
                  >
                    <span>🗑 删除台词框</span>
                    <span className="text-[10px] text-red-400 font-mono">Del</span>
                  </button>
                </>
              );
            })()}

            {target.kind === "canvas" && (
              <>
                <div className="px-2.5 py-1 text-[11px] font-mono text-[var(--signal)] font-bold border-b border-neutral-800 mb-1">
                  画布快捷视图
                </div>
                <button
                  type="button"
                  onClick={() => {
                    openLayoutModal();
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-[#333] hover:text-white rounded text-left"
                >
                  <span>⊞ 生成分镜版式候选</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    openPreviewModal();
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-[#333] hover:text-white rounded text-left"
                >
                  <span>👁 查看草稿大图预览</span>
                </button>
                <div className="h-[1px] bg-neutral-800 my-1" />
                <button
                  type="button"
                  onClick={() => {
                    setShowLiveArea((v) => !v);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-[#333] hover:text-white rounded text-left"
                >
                  <span>📏 切换版心安全区线</span>
                  <span className="text-[10px] text-neutral-400 font-mono">{showLiveArea ? "关" : "开"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowReadingFlow((v) => !v);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-[#333] hover:text-white rounded text-left"
                >
                  <span>🏹 切换视线流动线</span>
                  <span className="text-[10px] text-neutral-400 font-mono">{showReadingFlow ? "关" : "开"}</span>
                </button>
                <div className="h-[1px] bg-neutral-800 my-1" />
                <button
                  type="button"
                  onClick={() => {
                    openCommandPalette();
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-[#333] hover:text-white rounded text-left"
                >
                  <span>⌘K 打开全局命令面板</span>
                  <span className="text-[10px] text-neutral-400 font-mono">Ctrl+K</span>
                </button>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
});

export default CanvasEditor;
