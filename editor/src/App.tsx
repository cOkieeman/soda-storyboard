import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
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
import { useTheme } from "./hooks/useTheme";
import { clampWidth, readWorkspace, resetWorkspacePreferences, saveWorkspace } from "./lib/workspace";
import WorkspaceResizeHandle from "./components/WorkspaceResizeHandle";
import ShortcutHelp from "./components/ShortcutHelp";
import { batchActions } from "./lib/editorActions";
import DialogueEditor from "./components/modals/DialogueEditor";
import FavoritesDialog from "./components/modals/FavoritesDialog";
import { hasCharacterDraftChanges, isCharacterScope, useCharacterDraftStore } from "./lib/characterDrafts";

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const init = useEditorStore(s => s.init);
  const notice = useEditorStore(s => s.notice);
  const activePageId = useEditorStore(s => s.activePageId);
  const activeJob = useEditorStore(s => s.activeJob);
  const inspectorTarget = useCharacterDraftStore(state => state.target);
  const [mode, setMode] = useState<CanvasMode>("draft");
  const [tool, setTool] = useState<CanvasTool>("select");
  const [initialWorkspace] = useState(readWorkspace);
  const [sidebarOpen, setSidebarOpen] = useState(initialWorkspace.sidebarOpen);
  const [inspectorOpen, setInspectorOpen] = useState(initialWorkspace.inspectorOpen);
  const [sidebarWidth, setSidebarWidth] = useState(initialWorkspace.sidebarWidth);
  const [inspectorWidth, setInspectorWidth] = useState(initialWorkspace.inspectorWidth);
  const [workspaceFocused, setWorkspaceFocused] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dialogueOpen,setDialogueOpen]=useState(false);
  const [favoritesOpen,setFavoritesOpen]=useState(false);
  useEffect(()=>{
    const dialogue=()=>setDialogueOpen(true),favorites=()=>setFavoritesOpen(true),help=()=>setHelpOpen(true);
    window.addEventListener("soda:open-dialogue-editor",dialogue);window.addEventListener("soda:open-favorites",favorites);
    window.addEventListener("soda:open-shortcut-help",help);
    return()=>{window.removeEventListener("soda:open-dialogue-editor",dialogue);window.removeEventListener("soda:open-favorites",favorites);window.removeEventListener("soda:open-shortcut-help",help);};
  },[]);
  const canvasRef = useRef<CanvasEditorHandle>(null);
  const completedGenerationRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isCharacterScope(inspectorTarget)) return;
    setMode("draft"); setInspectorOpen(true); setWorkspaceFocused(false);
    if (window.innerWidth < 1280) setSidebarOpen(false);
  }, [inspectorTarget]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (useEditorStore.getState().hasUnsavedChanges || hasCharacterDraftChanges(useCharacterDraftStore.getState())) { event.preventDefault(); event.returnValue = ""; }
    };
    const refresh = () => { void useEditorStore.getState().refreshCharacters().catch(() => {}); };
    window.addEventListener("beforeunload", beforeUnload); window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("focus", refresh); };
  }, []);

  const changeMode = useCallback((next: CanvasMode) => {
    setMode(next);
    setTool("select");
    useEditorStore.getState().selectItem(null);
  }, []);
  const selectObject = useCallback((selection: Selection, additive=false) => {
    setMode("draft");
    setTool("select");
    setInspectorOpen(true);
    if (window.innerWidth < 1280) setSidebarOpen(false);
    useEditorStore.getState().selectItem(selection,additive);
    requestAnimationFrame(() => requestAnimationFrame(() => canvasRef.current?.revealSelection()));
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
  const resetWorkspace = () => {
    resetWorkspacePreferences(); setSidebarWidth(280); setInspectorWidth(340);
    setSidebarOpen(window.innerWidth >= 1280); setInspectorOpen(window.innerWidth >= 1024); setWorkspaceFocused(false);
    requestAnimationFrame(() => canvasRef.current?.fitToViewport());
    window.dispatchEvent(new Event("soda:reset-workspace"));
  };
  useEffect(() => { saveWorkspace({ sidebarOpen, inspectorOpen, sidebarWidth, inspectorWidth }); }, [sidebarOpen, inspectorOpen, sidebarWidth, inspectorWidth]);
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
      if (event.isComposing || event.keyCode === 229) return;
      const isInput = ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName || "") || target?.isContentEditable;
      const modified = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const state = useEditorStore.getState();
      if (state.importModalOpen) return;
      if (document.querySelector('[role="dialog"][aria-labelledby="identity-title"]')) return;
      if (isCharacterScope(useCharacterDraftStore.getState().target)) {
        if (modified && key === "s") { event.preventDefault(); void useCharacterDraftStore.getState().save(); }
        if (!isInput && (event.key === "Delete" || event.key === "Backspace" || (modified && ["z", "y", "c", "v", "d"].includes(key)))) event.preventDefault();
        if (!isInput && event.key === "Escape") useCharacterDraftStore.getState().showCanvas();
        return;
      }
      if (modified && key === "s") { event.preventDefault(); void state.saveCurrentPage(true); return; }
      if (modified && key === "k") { event.preventDefault(); state.openCommandPalette(); return; }
      if (isInput || document.querySelector('[role="dialog"]') || state.commandPaletteOpen || state.generateModal.open || state.layoutModal.open || state.previewModal.open || state.compileModal?.open || state.conflictModal?.open) return;
      if (modified && ["c", "v", "d"].includes(key)) {
        event.preventDefault();
        batchActions.find(action => action.id === (key === "c" ? "copy" : key === "v" ? "paste" : "duplicate"))?.run();
        return;
      }
      if(modified && key==="\\") {event.preventDefault();setWorkspaceFocused(v=>!v);return;}
      if (!modified && !event.altKey) {
        if (key === "1") { event.preventDefault(); canvasRef.current?.fitToViewport(); return; }
        if (key === "2") { event.preventDefault(); canvasRef.current?.fitSelection(); return; }
        if (key === "f") { event.preventDefault(); canvasRef.current?.focusPanel(); return; }
        if (key === "?") { event.preventDefault(); setHelpOpen(true); return; }
      }
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
        state.moveSelection(dx, dy);
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
    <div className="editor-shell" style={{ "--sidebar-width": `${sidebarWidth}px`, "--inspector-width": `${inspectorWidth}px` } as CSSProperties}>
      <Toolbar toolLabel={EDITOR_TOOLS.find(item => item.id === tool)!.label} sidebarOpen={sidebarOpen && !workspaceFocused} inspectorOpen={inspectorOpen && !workspaceFocused} onToggleSidebar={() => { setWorkspaceFocused(false); setSidebarOpen(v => !v); }} onToggleInspector={() => { setWorkspaceFocused(false); setInspectorOpen(v => !v); }} theme={theme} onToggleTheme={toggleTheme} onExportPng={() => canvasRef.current?.exportPng()} onExportPdf={() => canvasRef.current?.exportPdf()} onFocusWorkspace={() => setWorkspaceFocused(v => !v)} onResetWorkspace={resetWorkspace} workspaceFocused={workspaceFocused} />
      <main className={"editor-body" + (sidebarOpen && !workspaceFocused ? " has-sidebar" : "") + (inspectorOpen && !workspaceFocused ? " has-inspector" : "")}>
        <ToolRail tool={tool} onChange={chooseTool} />
        {sidebarOpen && !workspaceFocused && <section className="sidebar-slot"><PageSidebar onSelectObject={selectObject} onStartPage={startPage} /><WorkspaceResizeHandle side="left" value={sidebarWidth} onChange={value => setSidebarWidth(clampWidth(value, 220, 420, 280))} /></section>}
        <section className="workspace-column" aria-label="分镜画布工作区">
          {mode === "draft" && <ElementPalette onAdded={finishAdding} />}
          <div className="canvas-slot"><CanvasEditor ref={canvasRef} activeTool={tool} mode={mode} onModeChange={changeMode} onInspect={() => setInspectorOpen(true)} onElementAdded={finishAdding} onInlineTextEdit={beginInlineTextEdit} /></div>
          <RenderBar mode={mode} onViewArtwork={() => changeMode("artwork")} />
        </section>
        {inspectorOpen && !workspaceFocused && <section className="inspector-slot" aria-label="属性检查器">{mode === "draft" ? <InspectorPanel onSelectObject={selectObject} onStartPage={startPage} /> : <OutputInspector onEdit={() => changeMode("draft")} />}<WorkspaceResizeHandle side="right" value={inspectorWidth} onChange={value => setInspectorWidth(clampWidth(value, 280, 520, 340))} /></section>}
        {sidebarOpen && !workspaceFocused && <button className="sidebar-scrim" aria-label="关闭页面面板" onClick={() => setSidebarOpen(false)} />}
        {inspectorOpen && !workspaceFocused && <button className="inspector-scrim" aria-label="关闭检查器" onClick={() => setInspectorOpen(false)} />}
        {notice && <div className="editor-toast" role="status">{notice}</div>}
      </main>
      <ConflictModal /><LayoutModal /><PreviewModal /><CompileModal /><GenerateModal /><CommandPalette /><ImportModal />
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      {dialogueOpen && <DialogueEditor onClose={()=>setDialogueOpen(false)}/>}{favoritesOpen&&<FavoritesDialog onClose={()=>setFavoritesOpen(false)}/>}
    </div>
  );
}
