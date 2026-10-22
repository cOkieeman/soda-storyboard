import { v4 as uuid } from "uuid";
import type { Figure, ObjectFlags, ProjectPage, Selection, SelectionAlignment, SelectionStylePatch, SketchGeometry, SodaPage, SodaPanel } from "../types";
import { getFigureId, figureEditorBounds } from "./figureRig";
import { applyFigurePoseInPanel, editableFigureEditor, resolvedFigures } from "./figures";
import { sodaPageToProjectPage } from "./project";
import { generatePageSketchGeometry } from "./sketchGeometry";
import { getPanelCanvasPoint, getPanelLocalPoints } from "./panelGeometry";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const freshId = (prefix: string) => prefix + "_" + uuid().replace(/-/g, "").slice(0, 12);
export const selectionKey = (item: Selection): string => item.kind === "figure"
  ? "figure:" + encodeURIComponent(item.panelId) + ":" + encodeURIComponent(item.id)
  : (item.kind === "bubble" ? "text" : item.kind) + ":" + encodeURIComponent(item.id);

export function selectionParent(page: SodaPage, item: Selection): string | null {
  if (item.kind === "figure") return item.panelId;
  if (item.kind === "text" || item.kind === "bubble") return page.texts.find(text => text.id === item.id)?.panel_id || null;
  if (item.kind === "overlay") return page.overlays?.find(overlay => overlay.id === item.id)?.panel_id || null;
  return null;
}
export function selectionExists(page: SodaPage, item: Selection): boolean {
  if (item.kind === "panel") return page.panels.some(panel => panel.id === item.id);
  if (item.kind === "text" || item.kind === "bubble") return page.texts.some(text => text.id === item.id);
  if (item.kind === "overlay") return !!page.overlays?.some(overlay => overlay.id === item.id);
  const panel = page.panels.find(panel => panel.id === item.panelId);
  return !!panel && resolvedFigures(panel, page.reading_direction).some((figure, index) => getFigureId(figure, index) === item.id);
}
export function normalizeSelections(page: SodaPage, items: Selection[]): Selection[] {
  const unique = [...new Map(items.filter(item => selectionExists(page, item)).map(item => [selectionKey(item), item])).values()];
  const parents = new Set(unique.filter(item => item.kind === "panel").map(item => item.id));
  return unique.filter(item => item.kind === "panel" || !parents.has(selectionParent(page, item) || ""));
}
export function isSelectionLocked(page: SodaPage, flags: Record<string, ObjectFlags>, item: Selection): boolean {
  const parent = selectionParent(page, item);
  return !!flags[selectionKey(item)]?.locked || !!(parent && flags[selectionKey({ kind: "panel", id: parent })]?.locked);
}
export function isSelectionHidden(page: SodaPage, flags: Record<string, ObjectFlags>, item: Selection): boolean {
  const parent = selectionParent(page, item);
  return !!flags[selectionKey(item)]?.hidden || !!(parent && flags[selectionKey({ kind: "panel", id: parent })]?.hidden);
}
export function panelHasLockedChildren(page: SodaPage, flags: Record<string, ObjectFlags>, id: string): boolean {
  const panel = page.panels.find(panel => panel.id === id);
  return page.texts.some(text => text.panel_id === id && isSelectionLocked(page, flags, { kind: "text", id: text.id }))
    || !!page.overlays?.some(overlay => overlay.panel_id === id && isSelectionLocked(page, flags, { kind: "overlay", id: overlay.id }))
    || !!panel && resolvedFigures(panel, page.reading_direction).some((figure, index) => isSelectionLocked(page, flags, { kind: "figure", panelId: id, id: getFigureId(figure, index) }));
}

export function selectionBounds(projectPage: ProjectPage, page: SodaPage | null, item: Selection, geometry?: SketchGeometry | null): { x: number; y: number; width: number; height: number } | null {
  const boundsOf = (points: Array<{ x: number; y: number }>) => {
    const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
    return { x, y, width: Math.max(...points.map(point => point.x)) - x, height: Math.max(...points.map(point => point.y)) - y };
  };
  if (item.kind === "panel") {
    const panel = projectPage.panels.find(panel => panel.id === item.id);
    return panel ? boundsOf(getPanelLocalPoints(panel).map(point => getPanelCanvasPoint(panel, point))) : null;
  }
  if (item.kind === "text" || item.kind === "bubble") return projectPage.bubbles.find(bubble => bubble.id === item.id) || null;
  if (item.kind === "overlay") {
    const rect = page?.overlays?.find(overlay => overlay.id === item.id)?.rect;
    return rect ? { x: rect.x, y: rect.y, width: rect.w, height: rect.h } : null;
  }
  const panel = projectPage.panels.find(panel => panel.id === item.panelId);
  if (!panel?.sodaData) return null;
  const figures = resolvedFigures(panel.sodaData, page?.reading_direction);
  const index = figures.findIndex((figure, index) => getFigureId(figure, index) === item.id);
  if (index < 0) return null;
  const sketch = geometry?.panels.find(sketch => sketch.panel_id === panel.id)?.figures[index];
  const editor = editableFigureEditor(figures[index], panel, sketch);
  const bounds = figureEditorBounds(editor);
  return boundsOf([{ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height }].map(point => getPanelCanvasPoint(panel, point)));
}

function offsetShape(panel: SodaPanel, dx: number, dy: number): void {
  panel.shape = panel.shape.type === "rect"
    ? { ...panel.shape, x: panel.shape.x + dx, y: panel.shape.y + dy }
    : { ...panel.shape, points: panel.shape.points.map(([x, y]) => [x + dx, y + dy]) as typeof panel.shape.points };
}
function moveOne(page: SodaPage, item: Selection, dx: number, dy: number, geometry?: SketchGeometry | null, projectPage?: ProjectPage): void {
  if (item.kind === "panel") {
    const panel = page.panels.find(panel => panel.id === item.id);
    if (!panel) return;
    offsetShape(panel, dx, dy);
    page.texts.forEach(text => { if (text.panel_id === item.id && text.bbox) text.bbox = { ...text.bbox, x: text.bbox.x + dx, y: text.bbox.y + dy }; });
    page.overlays?.forEach(overlay => { if (overlay.panel_id === item.id) overlay.rect = { ...overlay.rect, x: overlay.rect.x + dx, y: overlay.rect.y + dy }; });
  } else if (item.kind === "text" || item.kind === "bubble") {
    const text = page.texts.find(text => text.id === item.id);
    if (text?.bbox) text.bbox = { ...text.bbox, x: text.bbox.x + dx, y: text.bbox.y + dy };
  } else if (item.kind === "overlay") {
    const overlay = page.overlays?.find(overlay => overlay.id === item.id);
    if (overlay) overlay.rect = { ...overlay.rect, x: overlay.rect.x + dx, y: overlay.rect.y + dy };
  } else {
    const projectPanel = (projectPage || sodaPageToProjectPage(page)).panels.find(panel => panel.id === item.panelId);
    const panel = page.panels.find(panel => panel.id === item.panelId);
    if (!panel || !projectPanel) return;
    panel.figures = resolvedFigures(panel, page.reading_direction).map((figure, index) => {
      const id = getFigureId(figure, index);
      if (id !== item.id) return { ...figure, id };
      const editor = editableFigureEditor(figure, projectPanel, geometry?.panels.find(panel => panel.panel_id === item.panelId)?.figures[index]);
      const angle = projectPanel.rotation * Math.PI / 180, localX = dx * Math.cos(angle) + dy * Math.sin(angle), localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
      return { ...figure, id, position: Math.max(0, Math.min(1, (editor.x + localX) / projectPanel.width)), editor: { ...editor, x: editor.x + localX, y: editor.y + localY } };
    });
  }
}
export function movePageSelections(source: SodaPage, items: Selection[], dx: number, dy: number, geometry?: SketchGeometry | null, projectPage?: ProjectPage): SodaPage {
  const page = clone(source);
  normalizeSelections(source, items).forEach(item => moveOne(page, item, dx, dy, geometry, projectPage));
  return page;
}
export function alignPageSelections(source: SodaPage, items: Selection[], action: SelectionAlignment, geometry?: SketchGeometry | null, projectPage?: ProjectPage): SodaPage {
  const page = clone(source);
  const project = projectPage || sodaPageToProjectPage(source);
  const entries = normalizeSelections(source, items).map(item => ({ item, bounds: selectionBounds(project, source, item, geometry) })).filter(entry => entry.bounds !== null);
  if (!entries.length) return page;
  const union = entries.length === 1 ? { x: 0, y: 0, width: page.canvas_width, height: page.canvas_height } : {
    x: Math.min(...entries.map(entry => entry.bounds!.x)), y: Math.min(...entries.map(entry => entry.bounds!.y)),
    width: 0, height: 0
  };
  if (entries.length > 1) {
    union.width = Math.max(...entries.map(entry => entry.bounds!.x + entry.bounds!.width)) - union.x;
    union.height = Math.max(...entries.map(entry => entry.bounds!.y + entry.bounds!.height)) - union.y;
  }
  if (action === "distribute-x" || action === "distribute-y") {
    if (entries.length < 3) return page;
    const horizontal = action === "distribute-x";
    const axis = horizontal ? "x" : "y", size = horizontal ? "width" : "height";
    entries.sort((a, b) => a.bounds![axis] - b.bounds![axis]);
    const gap = (union[size] - entries.reduce((sum, entry) => sum + entry.bounds![size], 0)) / (entries.length - 1);
    let cursor = union[axis];
    entries.forEach(entry => { const delta = cursor - entry.bounds![axis]; moveOne(page, entry.item, horizontal ? delta : 0, horizontal ? 0 : delta, geometry, project); cursor += entry.bounds![size] + gap; });
  } else entries.forEach(({ item, bounds }) => {
    let dx = 0, dy = 0;
    if (action === "left") dx = union.x - bounds!.x;
    if (action === "right") dx = union.x + union.width - bounds!.x - bounds!.width;
    if (action === "center-x") dx = union.x + union.width / 2 - bounds!.x - bounds!.width / 2;
    if (action === "top") dy = union.y - bounds!.y;
    if (action === "bottom") dy = union.y + union.height - bounds!.y - bounds!.height;
    if (action === "center-y") dy = union.y + union.height / 2 - bounds!.y - bounds!.height / 2;
    moveOne(page, item, dx, dy, geometry, project);
  });
  return page;
}
export function stylePageSelections(source: SodaPage, items: Selection[], patch: SelectionStylePatch, geometry?: SketchGeometry | null): SodaPage {
  const page = clone(source), project = sodaPageToProjectPage(source);
  normalizeSelections(source, items).forEach(item => {
    if (item.kind === "panel" && patch.panel) {
      const panel = page.panels.find(panel => panel.id === item.id);
      if (panel) Object.assign(panel, patch.panel, { id: panel.id });
    } else if ((item.kind === "text" || item.kind === "bubble") && patch.text) {
      const text = page.texts.find(text => text.id === item.id);
      if (text) {
        Object.assign(text, patch.text, { id: text.id });
        if (typeof text.font_size === "number") text.font_size = Math.max(1, Math.min(512, text.font_size));
      }
    } else if (item.kind === "figure" && patch.figure) {
      const panel = page.panels.find(panel => panel.id === item.panelId), projectPanel = project.panels.find(panel => panel.id === item.panelId);
      if (!panel || !projectPanel) return;
      panel.figures = resolvedFigures(panel, page.reading_direction).map((figure, index) => {
        const id = getFigureId(figure, index);
        if (id !== item.id) return { ...figure, id };
        let editor = editableFigureEditor(figure, projectPanel, geometry?.panels.find(panel => panel.panel_id === item.panelId)?.figures[index]);
        if (patch.figure!.pose) editor = applyFigurePoseInPanel(editor, patch.figure!.pose!, projectPanel);
        if (patch.figure!.facing && patch.figure!.editor?.flip === undefined) editor = { ...editor, flip: patch.figure!.facing === "left" };
        const merged = { ...editor, ...patch.figure!.editor, joints: { ...editor.joints, ...patch.figure!.editor?.joints } };
        return { ...figure, ...patch.figure, id, editor: merged, position: Math.max(0, Math.min(1, merged.x / projectPanel.width)),
          ...(patch.figure!.editor?.flip !== undefined && !patch.figure!.facing ? { facing: merged.flip ? "left" as const : "right" as const } : {}) };
      });
      panel.character_ids = [...new Set(panel.figures.map(figure => figure.character_id).filter(Boolean))];
    }
  });
  return page;
}
export function deletePageSelections(source: SodaPage, items: Selection[]): SodaPage {
  const page = clone(source), selection = normalizeSelections(source, items);
  const panels = new Set(selection.filter(item => item.kind === "panel").map(item => item.id));
  const texts = new Set(selection.filter(item => item.kind === "text" || item.kind === "bubble").map(item => item.id));
  const overlays = new Set(selection.filter(item => item.kind === "overlay").map(item => item.id));
  page.panels = page.panels.filter(panel => !panels.has(panel.id)).map(panel => {
    const removed = new Set(selection.filter(item => item.kind === "figure" && item.panelId === panel.id).map(item => item.id));
    if (!removed.size) return panel;
    const figures = resolvedFigures(panel, page.reading_direction).filter((figure, index) => !removed.has(getFigureId(figure, index)));
    return { ...panel, figures, character_ids: [...new Set(figures.map(figure => figure.character_id).filter(Boolean))] };
  });
  page.texts = page.texts.filter(text => !texts.has(text.id) && !panels.has(text.panel_id || ""));
  if (page.overlays) page.overlays = page.overlays.filter(overlay => !overlays.has(overlay.id) && !panels.has(overlay.panel_id || ""));
  return page;
}

export type SelectionClipboard = {
  format: "soda-editor-elements-v1"; projectIdentity: string;
  panels: SodaPanel[]; texts: SodaPage["texts"]; overlays: NonNullable<SodaPage["overlays"]>;
  figures: Array<{ panelId: string; figure: Figure }>;
};
export function copyPageSelections(source: SodaPage, items: Selection[], projectIdentity = "", sketchGeometry?: SketchGeometry | null): SelectionClipboard {
  const selection = normalizeSelections(source, items), panels = new Set(selection.filter(item => item.kind === "panel").map(item => item.id));
  const textIds = new Set(selection.filter(item => item.kind === "text" || item.kind === "bubble").map(item => item.id));
  const overlayIds = new Set(selection.filter(item => item.kind === "overlay").map(item => item.id));
  const geometry = sketchGeometry || generatePageSketchGeometry(source, []), project = sodaPageToProjectPage(source);
  const figures: SelectionClipboard["figures"] = [];
  selection.forEach(item => {
    if (item.kind !== "figure") return;
    const panel = source.panels.find(panel => panel.id === item.panelId), projectPanel = project.panels.find(panel => panel.id === item.panelId);
    if (!panel || !projectPanel) return;
    const all = resolvedFigures(panel, source.reading_direction), index = all.findIndex((figure, index) => getFigureId(figure, index) === item.id);
    if (index >= 0) figures.push({ panelId: item.panelId, figure: { ...all[index], editor: editableFigureEditor(all[index], projectPanel, geometry.panels.find(panel => panel.panel_id === item.panelId)?.figures[index]) } });
  });
  return clone({ format: "soda-editor-elements-v1", projectIdentity, panels: source.panels.filter(panel => panels.has(panel.id)),
    texts: source.texts.filter(text => panels.has(text.panel_id || "") || textIds.has(text.id)),
    overlays: (source.overlays || []).filter(overlay => panels.has(overlay.panel_id || "") || overlayIds.has(overlay.id)), figures });
}
export function pastePageSelections(source: SodaPage, clipboard: SelectionClipboard, dx = 24, dy = 24, targetPanelId?: string, projectPage?: ProjectPage): { page: SodaPage; selections: Selection[] } {
  const page = clone(source), selections: Selection[] = [], panelIds = new Map<string, string>();
  const maxOrder = Math.max(0, ...page.panels.map(panel => panel.order));
  clipboard.panels.forEach((original, index) => {
    const panel = clone(original), id = freshId("p");
    panelIds.set(original.id, id); panel.id = id; panel.order = maxOrder + index + 1;
    panel.figures = resolvedFigures(panel, page.reading_direction).map(figure => ({ ...figure, id: freshId("fig") }));
    offsetShape(panel, dx, dy); page.panels.push(panel); selections.push({ kind: "panel", id });
  });
  const target = targetPanelId && page.panels.some(panel => panel.id === targetPanelId) ? targetPanelId : undefined;
  clipboard.texts.forEach(original => {
    const text = clone(original), parent = panelIds.get(original.panel_id || "");
    text.id = freshId("t"); text.panel_id = parent || target || (page.panels.some(panel => panel.id === original.panel_id) ? original.panel_id : null);
    if (text.bbox) text.bbox = { ...text.bbox, x: text.bbox.x + dx, y: text.bbox.y + dy };
    page.texts.push(text); if (!parent) selections.push({ kind: "text", id: text.id });
  });
  clipboard.overlays.forEach(original => {
    const overlay = clone(original), parent = panelIds.get(original.panel_id || "");
    overlay.id = freshId("o"); overlay.panel_id = parent || target || (page.panels.some(panel => panel.id === original.panel_id) ? original.panel_id : null);
    overlay.rect = { ...overlay.rect, x: overlay.rect.x + dx, y: overlay.rect.y + dy };
    (page.overlays ||= []).push(overlay); if (!parent) selections.push({ kind: "overlay", id: overlay.id });
  });
  clipboard.figures.forEach(original => {
    const panel = page.panels.find(panel => panel.id === (target || original.panelId)) || page.panels[0];
    if (!panel) return;
    const figure = clone(original.figure); figure.id = freshId("fig");
    const angle = (projectPage?.panels.find(item => item.id === panel.id)?.rotation || 0) * Math.PI / 180;
    if (figure.editor) figure.editor = { ...figure.editor, x: figure.editor.x + dx * Math.cos(angle) + dy * Math.sin(angle), y: figure.editor.y - dx * Math.sin(angle) + dy * Math.cos(angle) };
    panel.figures = [...resolvedFigures(panel, page.reading_direction).map((figure, index) => ({ ...figure, id: getFigureId(figure, index) })), figure];
    panel.character_ids = [...new Set(panel.figures.map(figure => figure.character_id).filter(Boolean))];
    selections.push({ kind: "figure", panelId: panel.id, id: figure.id });
  });
  return { page, selections };
}
