import { Fragment, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import Konva from "konva";
import { Circle, Ellipse, Group, Image as KonvaImage, Layer, Rect, Shape, Stage, Text, Transformer } from "react-konva";
import useImage from "use-image";
import { Bubble, Panel, SodaOverlay, SodaPage } from "../types";
import {
  PANEL_SHAPE_HANDLE_KEYS,
  PanelShapeKey,
  Point,
  getPanelCanvasPoint,
  getPanelRenderTransform,
  getPanelShapeHandlePoint,
  normalizePanelRotation,
  normalizePanelShape,
  updatePanelShapeHandle
} from "../lib/panelGeometry";
import { drawPanelPath, getPanelImageLayout } from "../lib/panelRender";
import { getActivePage, useEditorStore } from "../lib/store";

export type CanvasEditorHandle = {
  exportPng: () => Promise<void>;
  exportPdf: () => Promise<void>;
};

const ROTATION_SNAP_ANGLES = Array.from({ length: 72 }, (_value, index) => index * 5);
const BUBBLE_TRANSFORMER_ANCHORS: string[] = ["top-center", "middle-left", "middle-right", "bottom-center"];

const SKEW_HANDLE_RADIUS = 12;
const SKEW_HANDLE_HIT_RADIUS = 28;
const SKEW_HANDLE_COLOR = "#9a321f"; // Soda Hub signal color
const SKEW_GUIDE_COLOR = "rgba(154, 50, 31, 0.35)";
const TRANSFORMER_ANCHOR_SIZE = 14;

function clampZoom(value: number) {
  return Math.min(2, Math.max(0.1, value));
}

function snapSize(value: number, minValue: number, step = 16) {
  const minMultiple = Math.ceil(minValue / step) * step;
  const snapped = Math.round(value / step) * step;
  return Math.max(minMultiple, snapped);
}

function waitForStageRefresh(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
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
      fill="rgba(255, 255, 255, 0.01)" // Almost transparent to catch hit tests
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
  const strokeColor = hasError
    ? "#9a321f"
    : selected
    ? "#9a321f"
    : "#171815";
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
            strokeWidth={2}
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
    </Group>
  );
}

function BubbleShape({ bubble }: { bubble: Bubble }) {
  if (bubble.type === "circle") {
    return (
      <Ellipse
        x={bubble.width / 2}
        y={bubble.height / 2}
        radiusX={bubble.width / 2}
        radiusY={bubble.height / 2}
        fill={bubble.background}
        stroke={bubble.borderColor}
        strokeWidth={bubble.borderWidth}
      />
    );
  }

  return (
    <Rect
      width={bubble.width}
      height={bubble.height}
      fill={bubble.background}
      stroke={bubble.borderColor}
      strokeWidth={bubble.borderWidth}
      cornerRadius={bubble.type === "rounded" ? 18 : 0}
    />
  );
}

function toVerticalText(text: string) {
  return text
    .split("\n")
    .map((line) => line.split("").join("\n"))
    .join("\n\n");
}

function BubbleText({ bubble }: { bubble: Bubble }) {
  const text = bubble.direction === "vertical" ? toVerticalText(bubble.text) : bubble.text;

  return (
    <Text
      x={8}
      y={8}
      width={Math.max(10, bubble.width - 16)}
      height={Math.max(10, bubble.height - 16)}
      text={text}
      align="center"
      verticalAlign="middle"
      fontSize={bubble.fontSize || 20}
      fontFamily={bubble.fontFamily || "Consolas, 'Microsoft YaHei', sans-serif"}
      fill={bubble.textColor || "#171815"}
      lineHeight={1.25}
      listening={false}
    />
  );
}

// Background layer component for sketch draft
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

const CanvasEditor = forwardRef<CanvasEditorHandle>(function CanvasEditor(_props, ref) {
  const project = useEditorStore((state) => state.project);
  const activePage = useEditorStore((state) => getActivePage(state.project));
  const sodaPage = useEditorStore((state) => state.sodaPage);
  const currentVersion = useEditorStore((state) => state.currentVersion);
  const selection = useEditorStore((state) => state.selection);
  const layerSettings = useEditorStore((state) => state.layerSettings);
  const selectedRenderUrl = useEditorStore((state) => state.selectedRenderUrl);
  const validationIssues = useEditorStore((state) => state.validationIssues);

  const selectItem = useEditorStore((state) => state.selectItem);
  const updatePanel = useEditorStore((state) => state.updatePanel);
  const updateSodaText = useEditorStore((state) => state.updateSodaText);
  const updateSodaOverlay = useEditorStore((state) => state.updateSodaOverlay);

  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const [zoom, setZoom] = useState(0.42);
  const [panelDraft, setPanelDraft] = useState<{ panelId: string; patch: Partial<Panel> } | null>(null);

  // Auto-fit zoom on mount or page load
  useEffect(() => {
    if (activePage.canvas.width && activePage.canvas.height) {
      // Calculate fit zoom
      const containerHeight = window.innerHeight - 200;
      const fitZoom = Math.min(0.65, Math.max(0.2, (containerHeight / activePage.canvas.height) * 0.9));
      setZoom(Math.round(fitZoom * 100) / 100);
    }
  }, [activePage.id]);

  const selectedNodeId = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === "panel") return `panel-${selection.id}`;
    if (selection.kind === "text" || selection.kind === "bubble") return `bubble-${selection.id}`;
    if (selection.kind === "overlay") return `overlay-${selection.id}`;
    return null;
  }, [selection]);

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
      target?.findAncestor?.(".panel-skew-handle", true) || target?.findAncestor?.(".panel-skew-overlay", true)
    );

    if (onPanel || onBubble || onOverlay || onTransformer || onSkewHandle) {
      return;
    }

    selectItem(null);
  };

  const adjustZoom = (delta: number) => {
    setZoom((current) => clampZoom(current + delta));
  };

  const canvasWidth = activePage.canvas.width || 1024;
  const canvasHeight = activePage.canvas.height || 1536;

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-[var(--paper-wash)]">
      {/* Zoom and Scale Controls Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] bg-[var(--paper-surface)] px-4 py-2 font-mono text-xs">
        <div className="flex items-center gap-3">
          <span className="font-bold text-[var(--ink)]">
            画布 {canvasWidth} × {canvasHeight}
          </span>
          <span className="text-[var(--rule)]">|</span>
          <span className="text-[var(--muted)]">
            {sodaPage?.reading_direction === "rtl" ? "日漫阅读顺序: 右上 ➔ 左下" : "左 ➔ 右"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="ui-btn ui-btn-sm"
            onClick={() => adjustZoom(-0.05)}
            title="缩小"
          >
            -
          </button>
          <span className="w-12 text-center text-xs font-bold text-[var(--ink)]">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="ui-btn ui-btn-sm"
            onClick={() => adjustZoom(0.05)}
            title="放大"
          >
            +
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-sm"
            onClick={() => {
              const containerHeight = window.innerHeight - 220;
              setZoom(Math.round(((containerHeight / canvasHeight) * 0.9) * 100) / 100);
            }}
            title="适应屏幕"
          >
            适应
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-sm"
            onClick={() => setZoom(1)}
            title="原始尺寸 100%"
          >
            100%
          </button>
        </div>
      </div>

      {/* Canvas Workspace */}
      <div className="flex flex-1 min-h-0 items-center justify-center overflow-auto p-8">
        <div
          className="canvas-page-paper relative transition-all"
          style={{
            width: Math.ceil(canvasWidth * zoom),
            height: Math.ceil(canvasHeight * zoom)
          }}
        >
          <Stage
            ref={stageRef}
            width={Math.ceil(canvasWidth * zoom)}
            height={Math.ceil(canvasHeight * zoom)}
            scaleX={zoom}
            scaleY={zoom}
            onMouseDown={handleMouseDown}
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

              {/* Layer 1: Render result bottom layer */}
              {layerSettings.showRender && selectedRenderUrl && (
                <RenderLayerImage
                  renderUrl={selectedRenderUrl}
                  canvasWidth={canvasWidth}
                  canvasHeight={canvasHeight}
                  opacity={layerSettings.renderOpacity}
                />
              )}

              {/* Layer 2: Sketch preview draft layer */}
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
                  (v) => v.severity === "error" && v.panel_id === panel.id
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
                      draggable
                      onClick={(event) => {
                        event.cancelBubble = true;
                        selectItem({ kind: "panel", id: panel.id });
                      }}
                      onTap={(event) => {
                        event.cancelBubble = true;
                        selectItem({ kind: "panel", id: panel.id });
                      }}
                      onDragEnd={(event) => {
                        updatePanel(panel.id, {
                          x: event.target.x() - displayPanel.width / 2,
                          y: event.target.y() - displayPanel.height / 2
                        });
                      }}
                    >
                      <PanelFillShape panel={displayPanel} />
                      <PanelImageLayer panel={displayPanel} />
                      <PanelBorderShape panel={displayPanel} selected={selected} hasError={hasError} />

                      {/* Reading Order Badge on top-right */}
                      <Group x={displayPanel.width - 32} y={4} listening={false}>
                        <Rect
                          width={28}
                          height={20}
                          fill={selected ? "#9a321f" : hasError ? "#9a321f" : "#171815"}
                          cornerRadius={0}
                        />
                        <Text
                          x={0}
                          y={3}
                          width={28}
                          text={`#${displayPanel.order}`}
                          align="center"
                          fill="#fbf6ec"
                          fontSize={12}
                          fontStyle="bold"
                          fontFamily="Consolas, monospace"
                        />
                      </Group>
                    </Group>

                    {/* Skew Corner Drag Handles */}
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

              {/* Layer 4: Overlays (跨格人物框) */}
              {(sodaPage?.overlays || []).map((overlay) => {
                const selected = selection?.kind === "overlay" && selection.id === overlay.id;
                const rect = overlay.rect || { x: 50, y: 50, w: 200, h: 200 };

                return (
                  <Group
                    key={overlay.id}
                    id={`overlay-${overlay.id}`}
                    name="overlay-node"
                    x={rect.x}
                    y={rect.y}
                    width={rect.w}
                    height={rect.h}
                    draggable
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
                    {/* Badge */}
                    <Group x={4} y={4} listening={false}>
                      <Rect width={100} height={18} fill="#9a321f" />
                      <Text
                        x={4}
                        y={3}
                        text={`跨格: ${overlay.character_id}`}
                        fill="#ffffff"
                        fontSize={11}
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

                return (
                  <Group
                    key={bubble.id}
                    id={`bubble-${bubble.id}`}
                    name="bubble-node"
                    x={bubble.x}
                    y={bubble.y}
                    width={bubble.width}
                    height={bubble.height}
                    draggable
                    onClick={(event) => {
                      event.cancelBubble = true;
                      selectItem({ kind: "text", id: bubble.id });
                    }}
                    onDragEnd={(event) => {
                      updateSodaText(bubble.id, {
                        bbox: {
                          type: "rect",
                          x: Math.round(event.target.x()),
                          y: Math.round(event.target.y()),
                          w: bubble.width,
                          h: bubble.height
                        }
                      });
                    }}
                    onTransformEnd={(event) => {
                      const node = event.target;
                      const nextWidth = Math.max(30, Math.round(node.width() * node.scaleX()));
                      const nextHeight = Math.max(30, Math.round(node.height() * node.scaleY()));
                      node.scaleX(1);
                      node.scaleY(1);

                      updateSodaText(bubble.id, {
                        bbox: {
                          type: "rect",
                          x: Math.round(node.x()),
                          y: Math.round(node.y()),
                          w: nextWidth,
                          h: nextHeight
                        }
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
                  </Group>
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
    </div>
  );
});

export default CanvasEditor;
