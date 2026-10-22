import { useCallback, useEffect, useRef, useState } from "react";
import CanvasEditor, { CanvasEditorHandle, CanvasMode, CanvasTool } from "./components/CanvasEditor";
import InspectorPanel from "./components/InspectorPanel";
import PageSidebar from "./components/PageSidebar";
import RenderBar from "./components/RenderBar";
import Toolbar from "./components/Toolbar";
import ToolRail, { EDITOR_TOOLS } from "./components/ToolRail";
import ConflictModal from "./components/modals/ConflictModal";
import LayoutModal from "./components/modals/LayoutModal";
import PreviewModal from "./components/modals/PreviewModal";
import CompileModal from "./components/modals/CompileModal";
import GenerateModal from "./components/modals/GenerateModal";
import CommandPalette from "./components/modals/CommandPalette";
import ImportModal from "./components/modals/ImportModal";
import { useEditorStore } from "./lib/store";
import type { Selection } from "./types";
import OutputInspector from "./components/OutputInspector";
import ElementPalette from "./components/ElementPalette";
import { getFigureId } from "./lib/figureRig";
import { editableFigureEditor, resolvedFigures } from "./lib/figures";
import { useTheme } from "./hooks/useTheme";

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const init = useEditorStore(s => s.init);
  const notice = useEditorStore(s => s.notice);
  const activePageId = useEditorStore(s => s.activePageId);
  const activeJob = useEditorStore(s => s.activeJob);
  const [mode, setMode] = useState<CanvasMode>("draft");
  const [tool, setTool] = useState<CanvasTool>("select");
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1280);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth >= 1024);
  const canvasRef = useRef<CanvasEditorHandle>(null);
  const completedGenerationRef = useRef<string | null>(null);

  const changeMode = useCallback((next: CanvasMode) => {
    setMode(next);
    setTool("select");
    useEditorStore.getState().selectItem(null);
  }, []);
  const selectObject = useCallback((selection: Selection) => {
    setMode("draft");
    setTool("select");
    setInspectorOpen(true);
    if (window.innerWidth < 1280) setSidebarOpen(false);
    useEditorStore.getState().selectItem(selection);
  }, []);
  const startPage = useCallback(() => {
    setMode("draft"); setTool("select"); setInspectorOpen(true);
    if (window.innerWidth < 1280) setSidebarOpen(false);
    useEditorStore.getState().startFirstPanel();
  }, []);
  const finishAdding = useCallback(() => {
    setMode("draft"); setTool("select"); setInspectorOpen(true);
    if (window.innerWidth < 1280) setSidebarOpen(false);
  }, []);
  const beginInlineTextEdit = useCallback(() => {
    if (window.innerWidth < 1024) setInspectorOpen(false);
    if (window.innerWidth < 1280) setSidebarOpen(false);
  }, []);
  const chooseTool = (next: CanvasTool) => { setMode("draft"); setTool(next); };
  useEffect(() => { setMode("draft"); setTool("select"); }, [activePageId]);
  useEffect(() => {
    if (activeJob?.operation === "generate" && activeJob.page_id === activePageId && activeJob.status === "completed" && completedGenerationRef.current !== activeJob.id) {
      completedGenerationRef.current = activeJob.id;
      changeMode("artwork");
    }
  }, [activeJob?.id, activeJob?.status, activePageId, changeMode]);

  useEffect(() => {
    (window as any).__editorStore = useEditorStore;
    void init();
  }, [init]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => useEditorStore.setState({ notice: null }), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1280px)");
    const desktop = window.matchMedia("(min-width: 1024px)");
    const updateSidebar = () => setSidebarOpen(wide.matches);
    const updateInspector = () => setInspectorOpen(desktop.matches);
    wide.addEventListener("change", updateSidebar);
    desktop.addEventListener("change", updateInspector);
    return () => { wide.removeEventListener("change", updateSidebar); desktop.removeEventListener("change", updateInspector); };
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const pageId = new URLSearchParams(window.location.hash.slice(1)).get("page");
      const state = useEditorStore.getState();
      if (state.initialized && pageId && pageId !== state.activePageId) {
        if (state.pages.some(page => page.id === pageId)) void state.selectPage(pageId);
        else state.setNotice("页面 " + pageId + " 不存在");
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInput = ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName || "") || target?.isContentEditable;
      const modified = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const state = useEditorStore.getState();
      if (state.importModalOpen) return;
      if (modified && key === "s") { event.preventDefault(); void state.saveCurrentPage(true); return; }
      if (modified && key === "k") { event.preventDefault(); state.openCommandPalette(); return; }
      if (isInput || state.commandPaletteOpen || state.generateModal.open || state.layoutModal.open || state.previewModal.open || state.compileModal?.open || state.conflictModal?.open) return;
      if (modified && (key === "z" || key === "y")) {
        event.preventDefault();
        if (key === "y" || event.shiftKey) state.redo(); else state.undo();
        return;
      }
      if (!modified && !event.altKey) {
        const match = EDITOR_TOOLS.find(item => item.shortcut.toLowerCase() === key);
        if (match) { event.preventDefault(); setMode("draft"); setTool(match.id); return; }
      }
      const selection = state.selection;
      if (selection && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        const page = state.project.pages[0];
        if (selection.kind === "text" || selection.kind === "bubble") {
          const bubble = page?.bubbles.find(item => item.id === selection.id);
          if (bubble) state.updateBubble(bubble.id, { x: bubble.x + dx, y: bubble.y + dy });
        } else if (selection.kind === "panel") {
          const panel = page?.panels.find(item => item.id === selection.id);
          if (panel) state.updatePanel(panel.id, { x: panel.x + dx, y: panel.y + dy });
        } else if (selection.kind === "figure") {
          const panel = page?.panels.find(item => item.id === selection.panelId);
          const figure = panel?.sodaData && resolvedFigures(panel.sodaData, state.sodaPage?.reading_direction).find((item, index) => getFigureId(item, index) === selection.id);
          if (panel && figure) {
            const figures = resolvedFigures(panel.sodaData!, state.sodaPage?.reading_direction);
            const index = figures.findIndex((item, index) => getFigureId(item, index) === selection.id);
            const sketch = state.sketchGeometry?.panels.find(item => item.panel_id === panel.id)?.figures[index];
            const editor = editableFigureEditor(figure, panel, sketch);
            state.updateFigureById(panel.id, selection.id, { editor: { ...editor, x: editor.x + dx, y: editor.y + dy } });
          }
        }
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault(); state.deleteSelection();
      } else if (event.key === "Escape") {
        state.selectItem(null); setTool("select");
        if (window.innerWidth < 1280) setSidebarOpen(false);
        if (window.innerWidth < 1024) setInspectorOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="editor-shell">
      <Toolbar toolLabel={EDITOR_TOOLS.find(item => item.id === tool)!.label} sidebarOpen={sidebarOpen} inspectorOpen={inspectorOpen} onToggleSidebar={() => setSidebarOpen(v => !v)} onToggleInspector={() => setInspectorOpen(v => !v)} theme={theme} onToggleTheme={toggleTheme} />
      <main className={"editor-body" + (sidebarOpen ? " has-sidebar" : "") + (inspectorOpen ? " has-inspector" : "")}>
        <ToolRail tool={tool} onChange={chooseTool} />
        {sidebarOpen && <section className="sidebar-slot"><PageSidebar onSelectObject={selectObject} onStartPage={startPage} /></section>}
        <section className="workspace-column" aria-label="分镜画布工作区">
          {mode === "draft" && <ElementPalette onAdded={finishAdding} />}
          <div className="canvas-slot"><CanvasEditor ref={canvasRef} activeTool={tool} mode={mode} onModeChange={changeMode} onInspect={() => setInspectorOpen(true)} onElementAdded={finishAdding} onInlineTextEdit={beginInlineTextEdit} /></div>
          <RenderBar mode={mode} onViewArtwork={() => changeMode("artwork")} />
        </section>
        {inspectorOpen && <section className="inspector-slot" aria-label="属性检查器">{mode === "draft" ? <InspectorPanel onSelectObject={selectObject} onStartPage={startPage} /> : <OutputInspector onEdit={() => changeMode("draft")} />}</section>}
        {sidebarOpen && <button className="sidebar-scrim" aria-label="关闭页面面板" onClick={() => setSidebarOpen(false)} />}
        {inspectorOpen && <button className="inspector-scrim" aria-label="关闭检查器" onClick={() => setInspectorOpen(false)} />}
        {notice && <div className="editor-toast" role="status">{notice}</div>}
      </main>
      <ConflictModal /><LayoutModal /><PreviewModal /><CompileModal /><GenerateModal /><CommandPalette /><ImportModal />
    </div>
  );
}
