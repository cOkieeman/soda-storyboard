export type WorkspacePreferences = {
  sidebarOpen: boolean; inspectorOpen: boolean; sidebarWidth: number; inspectorWidth: number;
};
export type Viewport = { zoom: number; pan: { x: number; y: number }; fit: boolean };
const KEY = "soda.workspace.v1";
export function readWorkspace(): WorkspacePreferences {
  const defaults = { sidebarOpen: typeof window !== "undefined" && window.innerWidth >= 1280, inspectorOpen: typeof window !== "undefined" && window.innerWidth >= 1024, sidebarWidth: 280, inspectorWidth: 340 };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!saved) return defaults;
    return { sidebarOpen: typeof saved.sidebarOpen === "boolean" ? saved.sidebarOpen : defaults.sidebarOpen, inspectorOpen: typeof saved.inspectorOpen === "boolean" ? saved.inspectorOpen : defaults.inspectorOpen, sidebarWidth: clampWidth(saved.sidebarWidth, 220, 420, 280), inspectorWidth: clampWidth(saved.inspectorWidth, 280, 520, 340) };
  } catch { return defaults; }
}
export function clampWidth(value: number, min: number, max: number, fallback: number) { return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback; }
export function saveWorkspace(value: WorkspacePreferences) { try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* preferences are optional */ } }
export function readViewport(key: string): Viewport | null {
  try {
    const value = JSON.parse(localStorage.getItem(`${KEY}.view.${key}`) || "null");
    return value && Number.isFinite(value.zoom) && value.zoom >= .05 && value.zoom <= 2.5 && Number.isFinite(value.pan?.x) && Number.isFinite(value.pan?.y) ? value : null;
  } catch { return null; }
}
export function saveViewport(key: string, value: Viewport) { try { localStorage.setItem(`${KEY}.view.${key}`, JSON.stringify(value)); } catch { /* optional */ } }
export function resetWorkspacePreferences() {
  try { for (let i=localStorage.length-1;i>=0;i--) {const key=localStorage.key(i);if(key?.startsWith(KEY)) localStorage.removeItem(key);} } catch { /* optional */ }
}
/** Keep the page point under a pointer still while a centered paper changes size. */
export function anchoredPan(pan: {x:number;y:number}, point: {x:number;y:number}, center: {x:number;y:number}, oldZoom:number, nextZoom:number) {
  const ratio = nextZoom / oldZoom;
  return { x: point.x - center.x - (point.x - center.x - pan.x) * ratio, y: point.y - center.y - (point.y - center.y - pan.y) * ratio };
}

/** Fit the complete page to the measured content box, after the actual CSS padding. */
export function canvasFitZoom(viewport: { width: number; height: number }, canvas: { width: number; height: number }, padding = { left: 0, right: 0, top: 0, bottom: 0 }): number {
  const width = Math.max(1, viewport.width - padding.left - padding.right);
  const height = Math.max(1, viewport.height - padding.top - padding.bottom);
  return Math.max(0.05, Math.min(1, width / Math.max(1, canvas.width), height / Math.max(1, canvas.height)));
}
