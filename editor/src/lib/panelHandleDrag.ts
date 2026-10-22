import type { Panel } from "../types";
import {
  getPanelCanvasPoint, getPanelEdgeHandlePoint, getPanelLocalPoint, getPanelShapeHandlePoint,
  normalizePanelShape, updatePanelEdgeHandle, updatePanelShapeHandle,
  type PanelEdgeKey, type PanelShapeKey, type Point
} from "./panelGeometry";

export type PanelHandle = { kind: "corner"; key: PanelShapeKey } | { kind: "edge"; key: PanelEdgeKey };
export type PanelHandleDrag = ReturnType<typeof startPanelHandleDrag>;

function handlePoint(panel: Panel, handle: PanelHandle): Point {
  return handle.kind === "corner" ? getPanelShapeHandlePoint(panel, handle.key) : getPanelEdgeHandlePoint(panel, handle.key);
}

/** Keep one immutable origin for the entire gesture, including an off-center grab. */
export function startPanelHandleDrag(panel: Panel, handle: PanelHandle, pointer: Point) {
  const base = { ...panel, shape: normalizePanelShape(panel.shape, panel.width) };
  return { panel: base, handle, pointer: getPanelLocalPoint(base, pointer), point: handlePoint(base, handle) };
}

export function updatePanelHandleDrag(drag: PanelHandleDrag, pointer: Point): { patch: Partial<Panel>; point: Point; changed: boolean } {
  const local = getPanelLocalPoint(drag.panel, pointer);
  const target = { x: drag.point.x + local.x - drag.pointer.x, y: drag.point.y + local.y - drag.pointer.y };
  const patch: Partial<Panel> = drag.handle.kind === "corner"
    ? { shape: updatePanelShapeHandle(drag.panel.shape, drag.handle.key, drag.panel.width, target.x) }
    : updatePanelEdgeHandle(drag.panel, drag.handle.key, target);
  const next = { ...drag.panel, ...patch };
  const changed = (["x", "y", "width", "height"] as const).some(key => Math.abs(next[key] - drag.panel[key]) > 1e-8)
    || (["topLeft", "topRight", "bottomLeft", "bottomRight"] as const).some(key => Math.abs(next.shape[key] - drag.panel.shape[key]) > 1e-8);
  return { patch, point: getPanelCanvasPoint(next, handlePoint(next, drag.handle)), changed };
}
