import { Fragment, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import Konva from "konva";
import { Circle, Group, Layer, Line as KonvaLine, Rect, Stage, Text, Transformer } from "react-konva";
import { X } from "lucide-react";
import { Bubble, Panel } from "../types";
import { getPanelRenderTransform } from "../lib/panelGeometry";
import { getActivePage, useEditorStore } from "../lib/store";
import { generateOverlayFigure } from "../lib/sketchGeometry";
import { CanvasHeading, CanvasViewMenu, CanvasZoomBar } from "./canvas/CanvasControls";
import { CanvasContextMenu, CanvasContextMenuData } from "./canvas/CanvasContextMenu";
import { CanvasSelectionToolbar, CanvasTextSelectionToolbar } from "./canvas/CanvasSelectionToolbar";
import { EditablePanelFigures, FigureAccessibleList } from "./canvas/EditableFigures";
import {
  BubbleShape, BubbleText, calculateSnap, getBubbleTailHandlePos, LiveAreaOverlay,
  PanelBorderShape, PanelFillShape, PanelImageLayer, PanelSkewHandles,
  ReadingFlowOverlay, RenderLayerImage, SketchLayerImage, SnapGuidesOverlay
} from "./canvas/CanvasPrimitives";

export type CanvasTool = "select" | "panel" | "text" | "figure" | "pan";
export type CanvasMode = "draft" | "artwork";

type CanvasEditorProps = { activeTool?: CanvasTool; mode?: CanvasMode; onModeChange?: (mode: CanvasMode) => void; onInspect?: () => void; onElementAdded?: () => void; onInlineTextEdit?: () => void };

export type CanvasEditorHandle = {
  exportPng: () => Promise<void>;
  exportPdf: () => Promise<void>;
  fitToViewport: () => void;
  resetZoom: () => void;
};

const BUBBLE_TRANSFORMER_ANCHORS: string[] = ["top-center", "middle-left", "middle-right", "bottom-center"];
const TRANSFORMER_ANCHOR_SIZE = 14;
const BUBBLE_HANDLE_CLICK_WINDOW_MS = 600;

function clampZoom(value: number) {
  return Math.min(2.5, Math.max(0.05, value));
}

const CanvasEditor = forwardRef<CanvasEditorHandle, CanvasEditorProps>(function CanvasEditor({ activeTool = "select", mode = "draft", onModeChange, onInspect, onElementAdded, onInlineTextEdit }, ref) {
  const activePage = useEditorStore((state) => getActivePage(state.project));
  const sodaPage = useEditorStore((state) => state.sodaPage);
  const currentVersion = useEditorStore((state) => state.currentVersion);
  const selection = useEditorStore((state) => state.selection);
  const layerSettings = useEditorStore((state) => state.layerSettings);
  const selectedRenderUrl = useEditorStore((state) => state.selectedRenderUrl);
  const validationIssues = useEditorStore((state) => state.validationIssues);
  const sketchGeometry = useEditorStore((state) => state.sketchGeometry);
  const characters = useEditorStore((state) => state.characters);

  const selectItem = useEditorStore((state) => state.selectItem);
  const updatePanel = useEditorStore((state) => state.updatePanel);
  const updateSodaPanel = useEditorStore((state) => state.updateSodaPanel);
  const updateBubble = useEditorStore((state) => state.updateBubble);
  const updateSodaText = useEditorStore((state) => state.updateSodaText);
  const updateSodaOverlay = useEditorStore((state) => state.updateSodaOverlay);
  const addFigureToPanel = useEditorStore((state) => state.addFigureToPanel);
  const updateFigureById = useEditorStore((state) => state.updateFigureById);
  const addTextToPanel = useEditorStore((state) => state.addTextToPanel);
  const setNotice = useEditorStore((state) => state.setNotice);

  const stageRef = useRef<Konva.Stage | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const inlineBubbleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fitZoomRef = useRef(true);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const bubbleTransformStartRef = useRef<{ id: string; point: { x: number; y: number } | null } | null>(null);
  const bubbleHandleClickRef = useRef<{ id: string; point: { x: number; y: number }; time: number } | null>(null);
  const [figureControlsRoot, setFigureControlsRoot] = useState<Konva.Group | null>(null);
  const [zoom, setZoom] = useState(0.44);
  const [panelDraft, setPanelDraft] = useState<{ panelId: string; patch: Partial<Panel> } | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });

  const [contextMenu, setContextMenu] = useState<CanvasContextMenuData | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
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

  const canvasWidth = activePage.canvas.width || 1024;
  const canvasHeight = activePage.canvas.height || 1536;
  const isPanTool = activeTool === "pan" || isSpacePressed;
  const isArtwork = mode === "artwork";
  const canSelectObjects = activeTool === "select" && !isArtwork;

  // Measure the actual workspace, so folding a side panel also refits the page.
  const autoFitZoom = useCallback(() => {
    const container = workspaceRef.current;
    if (!container || !container.clientWidth || !container.clientHeight) return;
    const fitZoom = Math.min(
      1,
      Math.max(0.05, Math.min((container.clientHeight - 96) / canvasHeight, (container.clientWidth - 80) / canvasWidth))
    );
    fitZoomRef.current = true;
    setZoom(Math.floor(fitZoom * 1000) / 1000);
    setPan({ x: 0, y: 0 });
  }, [canvasWidth, canvasHeight]);

  const resetZoom = useCallback(() => {
    fitZoomRef.current = false;
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    autoFitZoom();
    const container = workspaceRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (fitZoomRef.current) autoFitZoom();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [activePage.id, autoFitZoom]);

  useEffect(() => {
    setEditingBubble(null);
    setEditingPanelDesc(null);
    setContextMenu(null);
    setPan({ x: 0, y: 0 });
  }, [activePage.id]);

  useEffect(() => {
    const container = workspaceRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      fitZoomRef.current = false;
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      setZoom((current) => Math.round(clampZoom(current * factor) * 1000) / 1000);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

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

  const selectedBubble = useMemo(() => {
    if (selection?.kind !== "text" && selection?.kind !== "bubble") return null;
    return activePage.bubbles.find((bubble) => bubble.id === selection.id) || null;
  }, [selection, activePage.bubbles]);

  const openBubbleEditor = (bubble: Bubble) => {
    selectItem({ kind: "text", id: bubble.id });
    onInlineTextEdit?.();
    setEditingPanelDesc(null);
    setEditingBubble({ id: bubble.id, text: bubble.text, x: bubble.x, y: bubble.y, width: bubble.width, height: bubble.height });
  };

  // Transformer anchors can cover the text at small zoom levels. Konva routes
  // their double clicks to the Stage, so resolve the actual hit node here too.
  const editBubbleAtPointer = () => {
    const stage = stageRef.current;
    const point = stage?.getPointerPosition();
    if (!stage || !point || !canSelectObjects || isPanTool) return;
    const hit = stage.getIntersection(point);
    const bubbleNode = hit?.findAncestor(".bubble-node", true);
    const local = stage.getAbsoluteTransform().copy().invert().point(point);
    // During the Transformer's mouseup/touchend, Konva temporarily disables
    // its hit canvas. Only fall back to the selected text's own rectangle.
    const selectedContainsPoint = selectedBubble && local.x >= selectedBubble.x && local.x <= selectedBubble.x + selectedBubble.width
      && local.y >= selectedBubble.y && local.y <= selectedBubble.y + selectedBubble.height;
    const handle = bubbleHandleClickRef.current;
    const clickedSelectedHandle = selectedBubble && handle?.id === selectedBubble.id && Date.now() - handle.time < BUBBLE_HANDLE_CLICK_WINDOW_MS
      && Math.hypot(point.x - handle.point.x, point.y - handle.point.y) <= TRANSFORMER_ANCHOR_SIZE;
    const bubble = bubbleNode
      ? activePage.bubbles.find((item) => `bubble-${item.id}` === bubbleNode.id())
      : hit?.findAncestor(".selection-transformer", true) || (!hit && (selectedContainsPoint || clickedSelectedHandle)) ? selectedBubble : null;
    if (bubble) openBubbleEditor(bubble);
  };

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
      exportPdf: async () => {},
      fitToViewport: autoFitZoom,
      resetZoom
    }),
    [activePage.id, autoFitZoom, resetZoom]
  );

  const handleMouseDown = (event: any) => {
    if (isPanTool) return;
    const target = event.target;
    const onPanel = Boolean(target?.findAncestor?.(".panel-node", true));
    const onBubble = Boolean(target?.findAncestor?.(".bubble-node", true));
    const onOverlay = Boolean(target?.findAncestor?.(".overlay-node", true));
    const onFigure = Boolean(target?.findAncestor?.(".figure-node", true) || target?.findAncestor?.(".figure-controls", true));
    const onTransformer = Boolean(target?.findAncestor?.(".selection-transformer", true));
    const onSkewHandle = Boolean(
      target?.findAncestor?.(".panel-skew-handle", true) ||
      target?.findAncestor?.(".panel-edge-handle", true) ||
      target?.findAncestor?.(".panel-skew-overlay", true)
    );

    if (onPanel || onBubble || onOverlay || onFigure || onTransformer || onSkewHandle) {
      return;
    }

    selectItem(null);
  };

  const adjustZoom = (delta: number) => {
    fitZoomRef.current = false;
    setZoom((current) => clampZoom(current + delta));
  };

  const handlePanelClick = (panel: Panel) => {
    if (isPanTool) return;
    selectItem({ kind: "panel", id: panel.id });
    onInspect?.();
    if (activeTool === "text") {
      addTextToPanel(panel.id);
      onElementAdded?.();
    } else if (activeTool === "figure") {
      const characterId = characters[0]?.id;
      if (!characterId) {
        setNotice("请先在角色面板添加角色，再点击格子放置人物");
        return;
      }
      addFigureToPanel(panel.id, { character_id: characterId, position: "center", facing: "front", pose: "stand" });
      onElementAdded?.();
    }
  };

  const inlineEditorPosition = (() => {
    if (!editingBubble) return null;
    const workspace = workspaceRef.current?.getBoundingClientRect();
    const paper = stageRef.current?.container().getBoundingClientRect();
    const width = Math.min(360, Math.max(180, editingBubble.width * zoom), Math.max(140, (workspace?.width || 376) - 16));
    const minLeft = workspace && paper ? workspace.left - paper.left + 8 : 8;
    const maxLeft = workspace && paper ? workspace.right - paper.left - width - 8 : canvasWidth * zoom - width - 8;
    const minTop = workspace && paper ? workspace.top - paper.top + 8 : 8;
    const maxTop = workspace && paper ? workspace.bottom - paper.top - 210 - 8 : canvasHeight * zoom - 218;
    return { left: Math.max(minLeft, Math.min(maxLeft, editingBubble.x * zoom)), top: Math.max(minTop, Math.min(maxTop, editingBubble.y * zoom)), width };
  })();

  return (
    <div className="canvas-editor relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--paper-wash)] select-none">
      <CanvasHeading width={canvasWidth} height={canvasHeight} mode={mode} onModeChange={onModeChange} />
      <div className="workspace-instruction" aria-live="polite">{isArtwork ? "这里显示选用的完整出图。点击下方候选图切换；需要改内容，返回“编辑分镜”。" : activeTool === "text" ? "点击画布里的一个格子添加台词；双击文字，或点“编辑台词”输入内容。" : activeTool === "figure" ? "点击一个格子添加人物，在右侧选择角色和姿势。" : activeTool === "pan" ? "拖动空白处移动视野；点击“适应”回到整页。" : selectedBubble ? "双击文字，或点“编辑台词”修改内容；拖动气泡移动，拖动方块调整大小。" : "点击一格开始编辑，右侧填写画面、人物和台词。修改会自动保存。"}</div>
      <FigureAccessibleList panels={activePage.panels} sketchGeometry={sketchGeometry} selection={selection} editable={canSelectObjects && !isPanTool} zoom={zoom} readingDirection={sodaPage?.reading_direction}
        onSelect={(panelId, id) => { selectItem({ kind: "figure", panelId, id }); onInspect?.(); }} />
      {isArtwork && !selectedRenderUrl && <div className="artwork-empty"><h3>这一页还没有出图</h3><p>先在“编辑分镜”中填写画面和台词，再生成候选图。</p><button className="ui-btn" onClick={() => useEditorStore.getState().openGenerateModal()}>设置出图</button></div>}
      {!isArtwork && !activePage.panels.length && <div className="artwork-empty draft-empty"><h3>从第一个画面开始</h3><p>先建立一格，写下发生了什么。之后可以上下或左右分格，继续安排故事。</p><button className="ui-btn" onClick={() => { const state = useEditorStore.getState(); if (state.sodaPage) state.startFirstPanel(); else void state.createPage(); onInspect?.(); }}>{sodaPage ? "建立第一个格子" : "新建分镜页"}</button></div>}
      {/* Canvas Workspace with Pan & Smooth Wheel Zoom */}
      <div
        ref={workspaceRef}
        className="canvas-workspace relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-8 pb-16 select-none"
        style={{
          cursor: isPanning ? "grabbing" : isPanTool ? "grab" : activeTool === "text" || activeTool === "figure" ? "crosshair" : "default"
        }}
        onMouseDown={(e) => {
          if (isPanTool || e.button === 1) {
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
        onMouseLeave={() => setIsPanning(false)}
      >
        <div
          className="canvas-page-paper relative shrink-0"
          onDoubleClick={(event) => {
            if (!(event.target instanceof HTMLCanvasElement)) return;
            stageRef.current?.setPointersPositions(event.nativeEvent);
            editBubbleAtPointer();
          }}
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
              onElementAdded?.();
              onInspect?.();
              setNotice(`已将角色 [${charId}] 放置于格 #${targetPanel.order}`);
            }
          }}
        >
          {!isArtwork && selectedPanel && (canSelectObjects || activeTool === "panel") && <CanvasSelectionToolbar panel={selectedPanel} canvasWidth={canvasWidth} zoom={zoom} />}
          {selectedBubble && canSelectObjects && !isPanTool && !editingBubble && <CanvasTextSelectionToolbar bubble={selectedBubble} canvasWidth={canvasWidth} zoom={zoom} onEdit={() => openBubbleEditor(selectedBubble)} />}
          {/* In-Place Textarea for Double-Click Bubble Editing */}
          {editingBubble && (
            <div
              className="absolute z-50 bg-white shadow-2xl border-2 border-[var(--signal)] rounded p-2"
              style={inlineEditorPosition || undefined}
              role="dialog"
              aria-label="画布台词编辑"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setEditingBubble(null);
                } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  event.stopPropagation();
                  updateSodaText(editingBubble.id, { text: inlineBubbleInputRef.current?.value ?? editingBubble.text });
                  setEditingBubble(null);
                }
              }}
              onBlur={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                updateSodaText(editingBubble.id, { text: inlineBubbleInputRef.current?.value ?? editingBubble.text });
                setEditingBubble(null);
              }}
            >
              <div className="text-xs font-bold text-[var(--signal)] mb-1 flex justify-between">
                <span>编辑台词</span>
                <span className="text-xs text-neutral-400 font-normal">Esc 取消</span>
              </div>
              <textarea
                key={editingBubble.id}
                ref={inlineBubbleInputRef}
                aria-label="编辑台词文本"
                autoFocus
                defaultValue={editingBubble.text}
                rows={4}
                className="w-full resize-none border border-neutral-300 rounded p-1.5 text-sm font-sans outline-none focus:border-[var(--signal)]"
              />
              <div className="mt-2 flex items-center justify-end gap-1">
                <button type="button" className="ui-btn ui-btn-sm" onPointerDown={(event) => event.preventDefault()} onClick={() => setEditingBubble(null)}>取消</button>
                <button type="button" className="ui-btn ui-btn-sm ui-btn-primary" onPointerDown={(event) => event.preventDefault()} onClick={() => {
                  updateSodaText(editingBubble.id, { text: inlineBubbleInputRef.current?.value ?? editingBubble.text });
                  setEditingBubble(null);
                }}>保存</button>
              </div>
              <p className="mt-1 text-xs text-[var(--ink-light)]">Ctrl+Enter 保存</p>
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
                  <X size={14} />
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
              <div className="flex justify-between items-center mt-2 text-xs text-neutral-400">
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

          <Stage
            ref={stageRef}
            width={Math.ceil(canvasWidth * zoom)}
            height={Math.ceil(canvasHeight * zoom)}
            scaleX={zoom}
            scaleY={zoom}
            onMouseDown={handleMouseDown}
            onDblClick={editBubbleAtPointer}
            onDblTap={editBubbleAtPointer}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              setContextMenu({
                x: e.evt.clientX,
                y: e.evt.clientY,
                target: { kind: "canvas" }
              });
            }}
          >
            <Layer listening={!isPanTool && !isArtwork}>
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
              {!isArtwork && showLiveArea && <LiveAreaOverlay width={canvasWidth} height={canvasHeight} />}

              {/* Layer 1: Render result bottom layer */}
              {(isArtwork || layerSettings.showRender) && selectedRenderUrl && (
                <RenderLayerImage
                  renderUrl={selectedRenderUrl}
                  canvasWidth={canvasWidth}
                  canvasHeight={canvasHeight}
                  opacity={isArtwork ? 1 : layerSettings.renderOpacity}
                />
              )}

              {/* Layer 2: Sketch preview draft comparison layer */}
              {!isArtwork && layerSettings.showSketch && activePage.id && (
                <SketchLayerImage
                  pageId={activePage.id}
                  version={currentVersion}
                  canvasWidth={canvasWidth}
                  canvasHeight={canvasHeight}
                  opacity={layerSettings.sketchOpacity}
                />
              )}

              <Group visible={!isArtwork}>
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
                      draggable={!isPanTool && (canSelectObjects || activeTool === "panel")}
                      onClick={(event) => {
                        event.cancelBubble = true;
                        handlePanelClick(panel);
                      }}
                      onTap={(event) => {
                        event.cancelBubble = true;
                        handlePanelClick(panel);
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
                        if (!canSelectObjects && activeTool !== "panel") return;
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

                      <EditablePanelFigures panel={displayPanel} sketchGeometry={sketchGeometry} selection={selection} readingDirection={sodaPage?.reading_direction}
                        editable={canSelectObjects && !isPanTool} zoom={zoom} controlsRoot={figureControlsRoot}
                        onSelect={(panelId, id) => { selectItem({ kind: "figure", panelId, id }); onInspect?.(); }}
                        onCommit={updateFigureById} />

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
                    {selected && (canSelectObjects || activeTool === "panel") && (
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

              {/* Figures that leave a frame sit above every panel border and below text. */}
              {activePage.panels.map((panel) => <EditablePanelFigures key={`break-${panel.id}`} panel={panel} sketchGeometry={sketchGeometry}
                selection={selection} editable={canSelectObjects && !isPanTool} zoom={zoom} controlsRoot={figureControlsRoot} readingDirection={sodaPage?.reading_direction} breakFrame
                onSelect={(panelId, id) => { selectItem({ kind: "figure", panelId, id }); onInspect?.(); }}
                onCommit={updateFigureById} />)}

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
                    listening={canSelectObjects}
                    draggable={!isPanTool && canSelectObjects}
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
                                stroke={overlayFigure.color}
                                strokeWidth={2.2}
                                fill={prim.fill ? overlayFigure.color : undefined}
                              />
                            );
                          }
                          if (prim.type === "line") {
                            const flatPoints = prim.points.flatMap(([px, py]) => [px - rect.x, py - rect.y]);
                            return (
                              <KonvaLine
                                key={primIdx}
                                points={flatPoints}
                                stroke={overlayFigure.color}
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
                  (v) => v.severity === "error" && (v.field === "texts" || (v as any).text_id === bubble.id)
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
                      listening={canSelectObjects}
                      draggable={!isPanTool && canSelectObjects}
                      onClick={(event) => {
                        event.cancelBubble = true;
                        selectItem({ kind: "text", id: bubble.id });
                        onInspect?.();
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
                        openBubbleEditor(bubble);
                      }}
                      onDblTap={(event) => {
                        event.cancelBubble = true;
                        openBubbleEditor(bubble);
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
                      onTransformStart={(event) => {
                        const point = event.target.getStage()?.getPointerPosition() || null;
                        bubbleTransformStartRef.current = { id: bubble.id, point };
                        if (point) bubbleHandleClickRef.current = { id: bubble.id, point, time: Date.now() };
                      }}
                      onTransformEnd={(event) => {
                        const node = event.target;
                        const start = bubbleTransformStartRef.current;
                        const pointer = node.getStage()?.getPointerPosition();
                        bubbleTransformStartRef.current = null;
                        // Treat click jitter on a resize handle as a click. A
                        // double click should open editing without resizing.
                        if (start?.id === bubble.id && start.point && pointer && Math.hypot(pointer.x - start.point.x, pointer.y - start.point.y) < Konva.dragDistance) {
                          node.position({ x: bubble.x, y: bubble.y });
                          node.scaleX(1);
                          node.scaleY(1);
                          return;
                        }
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
                    {selected && canSelectObjects &&
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
                visible={canSelectObjects || (activeTool === "panel" && selection?.kind === "panel")}
                listening={!isPanTool && canSelectObjects}
                rotateEnabled={false}
                resizeEnabled={selection?.kind === "text" || selection?.kind === "bubble"}
                flipEnabled={false}
                enabledAnchors={
                  selection?.kind === "text" || selection?.kind === "bubble"
                    ? BUBBLE_TRANSFORMER_ANCHORS
                    : []
                }
                anchorSize={TRANSFORMER_ANCHOR_SIZE}
                anchorStyleFunc={(anchor) => anchor.dragDistance(Konva.dragDistance)}
                keepRatio={false}
                borderStroke="#9a321f"
                anchorStroke="#9a321f"
                anchorFill="#fbf6ec"
              />
              <Group ref={setFigureControlsRoot} name="figure-controls-layer" />
              </Group>
            </Layer>
          </Stage>
        </div>
      </div>

      <div className="canvas-footer pointer-events-none absolute bottom-4 left-4 right-4 z-40 flex items-end justify-between gap-2">
        <div className="pointer-events-auto"><CanvasZoomBar zoom={zoom} onZoom={adjustZoom} onFit={autoFitZoom} onReset={resetZoom} /></div>
        <div className="pointer-events-auto"><CanvasViewMenu showLiveArea={showLiveArea} showReadingFlow={showReadingFlow} onLiveAreaChange={setShowLiveArea} onReadingFlowChange={setShowReadingFlow} /></div>
      </div>
      {contextMenu && <CanvasContextMenu menu={contextMenu} onClose={closeContextMenu} onEditBubble={openBubbleEditor} showLiveArea={showLiveArea} showReadingFlow={showReadingFlow} onToggleLiveArea={() => setShowLiveArea((value) => !value)} onToggleReadingFlow={() => setShowReadingFlow((value) => !value)} />}
    </div>
  );
});

export default CanvasEditor;
