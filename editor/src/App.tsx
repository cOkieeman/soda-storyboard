import React, { useEffect, useRef } from "react";
import CanvasEditor, { CanvasEditorHandle } from "./components/CanvasEditor";
import InspectorPanel from "./components/InspectorPanel";
import PageSidebar from "./components/PageSidebar";
import RenderBar from "./components/RenderBar";
import Toolbar from "./components/Toolbar";

import ConflictModal from "./components/modals/ConflictModal";
import LayoutModal from "./components/modals/LayoutModal";
import PreviewModal from "./components/modals/PreviewModal";
import CompileModal from "./components/modals/CompileModal";
import GenerateModal from "./components/modals/GenerateModal";

import { useEditorStore } from "./lib/store";

export default function App() {
  const init = useEditorStore((state) => state.init);
  const saveCurrentPage = useEditorStore((state) => state.saveCurrentPage);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const selectItem = useEditorStore((state) => state.selectItem);
  const notice = useEditorStore((state) => state.notice);

  const canvasEditorRef = useRef<CanvasEditorHandle | null>(null);

  // Initialize store and SSE connection on mount
  useEffect(() => {
    (window as any).__editorStore = useEditorStore;
    init();
  }, [init]);

  // Global keyboard shortcuts (Ctrl+S, Delete, Escape)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      const isInput = tag === "input" || tag === "textarea" || target?.isContentEditable;

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;

      // Ctrl+S / Cmd+S: Save page
      if (cmdOrCtrl && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveCurrentPage(true);
        return;
      }

      if (isInput) return;

      // Delete / Backspace: Delete current selection
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelection();
        return;
      }

      // Escape: Deselect
      if (event.key === "Escape") {
        selectItem(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelection, saveCurrentPage, selectItem]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--paper-wash)] text-[var(--ink)]">
      {/* Top Header Toolbar */}
      <Toolbar />

      {/* Main Studio Body */}
      <main className="relative flex flex-1 min-h-0 w-full overflow-hidden">
        {/* Left: Pages & Characters Sidebar */}
        <section className="w-[280px] shrink-0 h-full">
          <PageSidebar />
        </section>

        {/* Center: Canvas Workspace */}
        <section className="relative flex-1 min-h-0 min-w-0 h-full">
          <CanvasEditor ref={canvasEditorRef} />
        </section>

        {/* Right: Inspector Property Panel */}
        <section className="w-[360px] shrink-0 h-full">
          <InspectorPanel />
        </section>

        {/* Floating Notice Toast */}
        {notice && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2 border border-[var(--ink)] bg-[var(--ink)] px-4 py-2 font-mono text-xs font-bold text-[var(--paper-lift)] shadow-xl transition-all">
            {notice}
          </div>
        )}
      </main>

      {/* Bottom: Render Candidates & Job Status Bar */}
      <RenderBar />

      {/* Modals */}
      <ConflictModal />
      <LayoutModal />
      <PreviewModal />
      <CompileModal />
      <GenerateModal />
    </div>
  );
}
