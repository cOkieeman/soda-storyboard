import { useMemo, useRef, useState } from "react";
import Konva from "konva";
import { Circle, Group, KonvaRenderer, Line, Rect, Text } from "react-konva";
import type { Figure, FigureEditor, FigureJointName, Panel, Primitive, ReadingDirection, Selection, SketchFigure, SketchGeometry } from "../../types";
import { drawPanelPath } from "../../lib/panelRender";
import { getPanelCanvasPoint, getPanelRenderTransform } from "../../lib/panelGeometry";
import { figureEditorBounds, figureJointToLocal, figureLocalToJoint, generateRigPrimitives, getFigureId, JOINT_NAMES } from "../../lib/figureRig";
import { editableFigureEditor, resolvedFigures } from "../../lib/figures";
import { characterSketchColor } from "../../lib/characterColors";
import { useEditorStore } from "../../lib/store";

type Bounds = { x: number; y: number; width: number; height: number };
type FigureCommit = (panelId: string, figureId: string, patch: Partial<Figure>) => void;
type FigureSelect = (panelId: string, figureId: string) => void;
const ACTIVE_COLOR = "#9a321f";
const JOINT_LABELS: Record<FigureJointName, string> = {
  head: "头部", neck: "颈部", hip: "髋部", lElbow: "左肘", lHand: "左手", rElbow: "右肘", rHand: "右手",
  lKnee: "左膝", lFoot: "左脚", rKnee: "右膝", rFoot: "右脚"
};

function primitiveBounds(primitives: Primitive[]): Bounds | null {
  const points = primitives.flatMap((primitive): [number, number][] => primitive.type === "circle"
    ? [[primitive.cx - primitive.r, primitive.cy - primitive.r], [primitive.cx + primitive.r, primitive.cy + primitive.r]]
    : primitive.points);
  if (!points.length) return null;
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function translatePrimitive(primitive: Primitive, x: number, y: number): Primitive {
  return primitive.type === "circle"
    ? { ...primitive, cx: primitive.cx + x, cy: primitive.cy + y }
    : { ...primitive, points: primitive.points.map(([px, py]) => [px + x, py + y]) };
}

function getLegacySketch(panel: Panel, index: number, sketchGeometry: SketchGeometry | null): SketchFigure | undefined {
  return sketchGeometry?.panels.find((candidate) => candidate.panel_id === panel.id)?.figures[index];
}

/** Align the first editable rig with the already-visible legacy drawing. Merely opening a page never writes a migration. */
function alignedEditor(figure: Figure, panel: Panel, sketch?: SketchFigure): FigureEditor {
  return editableFigureEditor(figure, panel, sketch);
}

function FigurePrimitives({ primitives, color }: { primitives: Primitive[]; color: string }) {
  return <>{primitives.map((primitive, index) => primitive.type === "circle"
    ? <Circle key={index} x={primitive.cx} y={primitive.cy} radius={primitive.r} stroke={color} strokeWidth={primitive.width ?? 2.2} fill={primitive.fill ? color : undefined} hitStrokeWidth={14} />
    : <Line key={index} points={primitive.points.flat()} closed={primitive.type === "polygon"} stroke={color} strokeWidth={primitive.width || 2.2} fill={primitive.type === "polygon" && primitive.fill ? color : undefined} lineCap="round" lineJoin="round" hitStrokeWidth={14} />)}</>;
}

function EditableFigure({ panel, figure, index, sketch, selected, editable, zoom, color, controlsRoot, onSelect, onCommit }: {
  panel: Panel; figure: Figure; index: number; sketch?: SketchFigure; selected: boolean; editable: boolean; zoom: number;
  controlsRoot: Konva.Group | null;
  color: string;
  onSelect: FigureSelect; onCommit: FigureCommit;
}) {
  const id = getFigureId(figure, index);
  const baseEditor = useMemo(() => alignedEditor(figure, panel, sketch), [figure, panel, sketch]);
  const [draft, setDraft] = useState<FigureEditor | null>(null);
  const draftRef = useRef<FigureEditor | null>(null);
  const interactionRef = useRef<{ editor: FigureEditor; sizeHandleDistance?: number } | null>(null);
  const editor = draft || baseEditor;
  const usingLegacy = !figure.editor && Boolean(sketch);
  const legacyPrimitives = usingLegacy && sketch ? sketch.primitives.map((primitive) => translatePrimitive(primitive, -panel.x - editor.x, -panel.y - editor.y)) : null;
  const primitives = legacyPrimitives && !draft
    ? legacyPrimitives
    : generateRigPrimitives({ ...editor, x: 0, y: 0 });
  const bounds = legacyPrimitives && !draft
    ? primitiveBounds(sketch!.primitives.map((primitive) => translatePrimitive(primitive, -panel.x, -panel.y))) || figureEditorBounds(editor)
    : figureEditorBounds(editor);
  const handleRadius = Math.max(5, Math.min(11, 5 / zoom));
  const sizeHandle = { x: bounds.x + bounds.width + handleRadius * 1.5, y: bounds.y - handleRadius * 1.5 };
  const select = (event?: Konva.KonvaEventObject<Event>) => { if (event) event.cancelBubble = true; if (editable) onSelect(panel.id, id); };
  const changeDraft = (next: FigureEditor) => { draftRef.current = next; setDraft(next); };
  const commit = (next: FigureEditor) => {
    onCommit(panel.id, id, { editor: next });
    draftRef.current = null;
    setDraft(null);
    interactionRef.current = null;
  };
  const localPointer = (node: Konva.Node): [number, number] | null => {
    const pointer = node.getStage()?.getPointerPosition();
    const parent = node.getParent();
    if (!pointer || !parent) return null;
    const local = parent.getAbsoluteTransform().copy().invert().point(pointer);
    return [local.x, local.y];
  };
  const body = <Group
    id={`figure-${panel.id}-${id}`}
    name="figure-node"
    x={editor.x} y={editor.y}
    draggable={editable}
    onMouseDown={select} onTouchStart={select} onClick={select} onTap={select} onDblClick={select} onDblTap={select}
    onContextMenu={(event) => { event.evt.preventDefault(); select(event); }}
    onDragStart={(event) => { event.cancelBubble = true; select(); interactionRef.current = { editor }; }}
    onDragMove={(event) => {
      event.cancelBubble = true;
      const original = interactionRef.current?.editor || editor;
      changeDraft({ ...original, x: event.target.x(), y: event.target.y() });
    }}
    onDragEnd={(event) => {
      event.cancelBubble = true;
      commit({ ...(draftRef.current || editor), x: event.target.x(), y: event.target.y() });
    }}
    onMouseEnter={(event) => { const container = event.target.getStage()?.container(); if (container && editable) container.style.cursor = "move"; }}
    onMouseLeave={(event) => { const container = event.target.getStage()?.container(); if (container && editable) container.style.cursor = "default"; }}
  >
    <Rect x={bounds.x - editor.x - 7} y={bounds.y - editor.y - 7} width={Math.max(14, bounds.width + 14)} height={Math.max(14, bounds.height + 14)} fill="rgba(0,0,0,.001)" />
    <FigurePrimitives primitives={primitives} color={color} />
    <Group x={bounds.x - editor.x} y={bounds.y + bounds.height - editor.y + 6} listening={false}>
      <Rect width={Math.max(48, (sketch?.label || figure.character_id || "人物").length * 13 + 12)} height={22} fill={color} cornerRadius={3} />
      <Text x={6} y={4} text={sketch?.label || figure.character_id || "人物"} fill="#fff" fontSize={12} fontFamily="'Microsoft YaHei', sans-serif" />
    </Group>
  </Group>;
  // Keep controls in this component's draft state, but paint and hit-test them
  // above every panel and text box, including when the figure itself is clipped.
  const controls = selected && editable && controlsRoot ? KonvaRenderer.createPortal(
    <Group {...getPanelRenderTransform(panel)} name="figure-controls-transform">
    <Group name="figure-controls">
      <Rect x={bounds.x - 7} y={bounds.y - 7} width={bounds.width + 14} height={bounds.height + 14} stroke={ACTIVE_COLOR} strokeWidth={1.5} dash={[7, 5]} listening={false} />
      {JOINT_NAMES.map((joint) => {
        const [x, y] = figureJointToLocal(editor, joint);
        return <Circle key={joint} id={`figure-joint-${panel.id}-${id}-${joint}`} name={`figure-joint figure-joint-${joint}`} x={x} y={y}
          radius={handleRadius} fill="#fffaf1" stroke={ACTIVE_COLOR} strokeWidth={2} hitStrokeWidth={12 / zoom} draggable
          onMouseDown={select} onTouchStart={select} onClick={select} onTap={select}
          onDragStart={(event) => { event.cancelBubble = true; interactionRef.current = { editor }; }}
          onDragMove={(event) => {
            event.cancelBubble = true;
            const point = localPointer(event.target); if (!point) return;
            const original = interactionRef.current?.editor || editor;
            const nextJoint = figureLocalToJoint(original, point);
            changeDraft({ ...original, joints: { ...original.joints, [joint]: nextJoint } });
          }}
          onDragEnd={(event) => { event.cancelBubble = true; commit(draftRef.current || editor); }}
        />;
      })}
      <Line points={[bounds.x + bounds.width, bounds.y, sizeHandle.x, sizeHandle.y]} stroke={ACTIVE_COLOR} strokeWidth={1.5} listening={false} />
      <Rect id={`figure-size-${panel.id}-${id}`} name="figure-size-handle" x={sizeHandle.x} y={sizeHandle.y} offsetX={handleRadius} offsetY={handleRadius}
        width={handleRadius * 2} height={handleRadius * 2} fill={ACTIVE_COLOR} stroke="#fffaf1" strokeWidth={2} cornerRadius={2} draggable hitStrokeWidth={14 / zoom}
        onMouseDown={select} onTouchStart={select} onClick={select} onTap={select}
        onDragStart={(event) => { event.cancelBubble = true; interactionRef.current = { editor, sizeHandleDistance: Math.hypot(sizeHandle.x - editor.x, sizeHandle.y - editor.y) }; }}
        onDragMove={(event) => {
          event.cancelBubble = true;
          const point = localPointer(event.target); if (!point) return;
          const original = interactionRef.current?.editor || editor;
          const distance = Math.hypot(point[0] - original.x, point[1] - original.y);
          const ratio = distance / (interactionRef.current?.sizeHandleDistance || 1);
          changeDraft({ ...original, size: Math.max(24, Math.min(10000, original.size * ratio)) });
        }}
        onDragEnd={(event) => { event.cancelBubble = true; commit(draftRef.current || editor); }}
      />
      <Text x={bounds.x} y={bounds.y - 26 / zoom} text="拖动人物移动 · 圆点调姿势 · 方块缩放" fill={ACTIVE_COLOR} fontSize={Math.min(20, 11 / zoom)} fontFamily="'Microsoft YaHei', sans-serif" listening={false} />
    </Group>
    </Group>, controlsRoot, null, `figure-controls-${panel.id}-${id}`
  ) : null;
  return <Group name="editable-figure" listening={editable}>
    {editor.break_frame ? body : <Group clipFunc={(context) => { context.beginPath(); drawPanelPath(context, panel, panel.gap); context.closePath(); }}>{body}</Group>}
    {controls}
  </Group>;
}

export function EditablePanelFigures({ panel, sketchGeometry, selection, editable, zoom, controlsRoot, readingDirection = "rtl", breakFrame = false, onSelect, onCommit }: {
  panel: Panel; sketchGeometry: SketchGeometry | null; selection: Selection | null; editable: boolean; zoom: number; readingDirection?: ReadingDirection; breakFrame?: boolean;
  controlsRoot: Konva.Group | null;
  onSelect: FigureSelect; onCommit: FigureCommit;
}) {
  const characters = useEditorStore(state => state.characters);
  const figures = resolvedFigures(panel.sodaData, readingDirection).map((figure, index) => ({ figure, index }))
    .filter(({ figure }) => Boolean(figure.editor?.break_frame) === breakFrame);
  if (!figures.length) return null;
  const content = figures.map(({ figure, index }) => {
    const id = getFigureId(figure, index);
    return <EditableFigure key={id} panel={panel} figure={figure} index={index} sketch={getLegacySketch(panel, index, sketchGeometry)}
      selected={selection?.kind === "figure" && selection.panelId === panel.id && selection.id === id} editable={editable} zoom={zoom} color={characterSketchColor(characters.find(character => character.id === figure.character_id))} controlsRoot={controlsRoot} onSelect={onSelect} onCommit={onCommit} />;
  });
  if (!breakFrame) return <>{content}</>;
  const transform = getPanelRenderTransform(panel);
  return <Group x={transform.x} y={transform.y} offsetX={transform.offsetX} offsetY={transform.offsetY} rotation={transform.rotation}>{content}</Group>;
}

/** Canvas objects also expose a compact DOM description for keyboard access and browser QA. */
export function FigureAccessibleList({ panels, sketchGeometry, selection, editable, zoom, readingDirection = "rtl", onSelect }: {
  panels: Panel[]; sketchGeometry: SketchGeometry | null; selection: Selection | null; editable: boolean; zoom: number; readingDirection?: ReadingDirection; onSelect: FigureSelect;
}) {
  const characters = useEditorStore(state => state.characters);
  return <div className="sr-only" data-testid="canvas-figure-list" aria-label="画布人物">
    {panels.flatMap((panel) => resolvedFigures(panel.sodaData, readingDirection).map((figure, index) => {
      const id = getFigureId(figure, index);
      const editor = alignedEditor(figure, panel, getLegacySketch(panel, index, sketchGeometry));
      const bounds = figureEditorBounds(editor);
      const left = editor.break_frame ? bounds.x : Math.max(0, bounds.x);
      const right = editor.break_frame ? bounds.x + bounds.width : Math.min(panel.width, bounds.x + bounds.width);
      const top = editor.break_frame ? bounds.y : Math.max(0, bounds.y);
      const bottom = editor.break_frame ? bounds.y + bounds.height : Math.min(panel.height, bounds.y + bounds.height);
      const center = getPanelCanvasPoint(panel, { x: (left + right) / 2, y: (top + bottom) / 2 });
      const handleRadius = Math.max(5, Math.min(11, 5 / zoom));
      const sizeHandle = getPanelCanvasPoint(panel, { x: bounds.x + bounds.width + handleRadius * 1.5, y: bounds.y - handleRadius * 1.5 });
      return <button key={`${panel.id}-${id}`} type="button" data-testid="canvas-figure" data-figure-id={id} data-panel-id={panel.id}
        data-canvas-x={center.x} data-canvas-y={center.y} data-figure-size={editor.size} data-break-frame={editor.break_frame} data-figure-color={characterSketchColor(characters.find(character => character.id === figure.character_id))}
        data-size-handle-canvas-x={sizeHandle.x} data-size-handle-canvas-y={sizeHandle.y}
        aria-label={`第${panel.order}格人物${index + 1}：${figure.character_id || "未指定角色"}`} aria-pressed={selection?.kind === "figure" && selection.panelId === panel.id && selection.id === id}
        disabled={!editable} onClick={() => onSelect(panel.id, id)}>
        第{panel.order}格人物{index + 1}，拖动移动，选中后拖动圆点调整姿势，方块调整大小。
        {JOINT_NAMES.map((joint) => {
          const point = figureJointToLocal(editor, joint);
          const canvasPoint = getPanelCanvasPoint(panel, { x: point[0], y: point[1] });
          return <span key={joint} data-joint={joint} data-local-x={point[0]} data-local-y={point[1]} data-canvas-x={canvasPoint.x} data-canvas-y={canvasPoint.y}>{JOINT_LABELS[joint]} </span>;
        })}
      </button>;
    }))}
  </div>;
}
