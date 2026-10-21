import React, { useEffect } from "react";
import { useEditorStore } from "../lib/store";

export default function Toolbar() {
  const sodaProject = useEditorStore((state) => state.sodaProject);
  const activePageId = useEditorStore((state) => state.activePageId);
  const isSaving = useEditorStore((state) => state.isSaving);
  const hasUnsavedChanges = useEditorStore((state) => state.hasUnsavedChanges);
  const lastSavedTime = useEditorStore((state) => state.lastSavedTime);
  const sseConnected = useEditorStore((state) => state.sseConnected);
  const sketchGeometryUnavailable = useEditorStore((state) => state.sketchGeometryUnavailable);

  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);

  const saveCurrentPage = useEditorStore((state) => state.saveCurrentPage);
  const openLayoutModal = useEditorStore((state) => state.openLayoutModal);
  const openPreviewModal = useEditorStore((state) => state.openPreviewModal);
  const openCompileModal = useEditorStore((state) => state.openCompileModal);
  const openGenerateModal = useEditorStore((state) => state.openGenerateModal);
  const openCommandPalette = useEditorStore((state) => state.openCommandPalette);

  // Global keyboard shortcuts (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y, Ctrl+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (!isInput) {
          e.preventDefault();
          if (e.shiftKey) {
            redo();
          } else {
            undo();
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        if (!isInput) {
          e.preventDefault();
          redo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveCurrentPage(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, saveCurrentPage]);

  return (
    <header className="flex h-13 w-full items-center justify-between border-b border-[var(--line)] bg-[var(--paper-surface)] px-4 select-none">
      {/* Brand & Project Info */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 border border-[var(--ink)] bg-[var(--ink)] px-2.5 py-1 text-[var(--paper-lift)] shadow-sm">
          <span className="font-mono text-sm font-black tracking-widest text-[#fbf6ec]">SODA</span>
          <span className="bg-[var(--acid)] px-1 font-mono text-xs font-bold text-[var(--ink)]">
            EDITOR
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-[13px]">
          <span className="font-bold text-[var(--ink)]">{sodaProject?.name || "分镜项目"}</span>
          <span className="text-[var(--rule)]">/</span>
          <span className="font-semibold text-[var(--signal)]">{activePageId || "page"}</span>
        </div>

        {sketchGeometryUnavailable && (
          <span
            className="rounded bg-amber-100 border border-amber-300 px-2 py-0.5 text-xs text-amber-900 font-medium"
            title="后端尚未提供 GET /api/pages/{id}/sketch-geometry 接口，采用标准矢量模式渲染"
          >
            草稿几何接口不可用
          </span>
        )}
      </div>

      {/* Main Operations & Undo/Redo (P4c Item 5) */}
      <div className="flex items-center gap-2">
        <div className="flex items-center border border-[var(--line)] rounded overflow-hidden mr-2 bg-[var(--paper)]">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className="px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-[var(--paper-wash)] disabled:opacity-35 disabled:cursor-not-allowed border-r border-[var(--line)] text-[var(--ink)]"
            title="撤销 (Ctrl+Z)"
          >
            ↩ 撤销
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            className="px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-[var(--paper-wash)] disabled:opacity-35 disabled:cursor-not-allowed text-[var(--ink)]"
            title="重做 (Ctrl+Shift+Z)"
          >
            ↪ 重做
          </button>
        </div>

        <button
          type="button"
          onClick={openCommandPalette}
          className="ui-btn text-[13px] font-medium"
          title="打开全局命令面板 (Ctrl+K)"
        >
          <span className="text-[var(--signal)] font-mono font-bold">⌘K</span> 命令
        </button>

        <button
          type="button"
          onClick={openLayoutModal}
          className="ui-btn text-[13px] font-medium"
          title="生成多种分镜版式候选并直接替换"
        >
          <span className="text-[var(--signal)]">⊞</span> 版式候选
        </button>

        <button
          type="button"
          onClick={openPreviewModal}
          className="ui-btn text-[13px] font-medium"
          title="查看后端渲染的火柴人与分镜草稿大图"
        >
          <span>👁</span> 草稿预览
        </button>

        <button
          type="button"
          onClick={openCompileModal}
          className="ui-btn text-[13px] font-medium"
          title="调用编译接口生成 MOSS JSON"
        >
          <span>⤓</span> 导出 JSON
        </button>

        <button
          type="button"
          onClick={openGenerateModal}
          className="ui-btn ui-btn-primary text-[13px] font-bold"
          title="调用 P3 出图接口"
        >
          <span>⚡</span> 生成出图
        </button>
      </div>

      {/* Save Status & Action */}
      <div className="flex items-center gap-3">
        <span
          role="status"
          className="font-mono text-xs text-[var(--ink-light)]"
          title={sseConnected ? "SSE 已连接，文件修改会自动同步" : "SSE 断开，正在重连"}
        >
          {sseConnected ? "● 与 AI 同步中" : "○ 断开重连中"}
        </span>
        <div className="font-mono text-xs font-medium">
          {isSaving ? (
            <span className="text-[var(--signal)] animate-pulse">正在保存...</span>
          ) : hasUnsavedChanges ? (
            <span className="font-bold text-[var(--signal)]">● 未保存修改 (1s 自动保存)</span>
          ) : (
            <span className="text-[var(--ink-light)]">已保存 {lastSavedTime ? `(${lastSavedTime})` : ""}</span>
          )}
        </div>

        <button
          type="button"
          onClick={() => saveCurrentPage(true)}
          disabled={isSaving || !hasUnsavedChanges}
          className="ui-btn ui-btn-ink text-[13px] font-semibold"
          title="手动保存 (Ctrl+S)"
        >
          保存 (Ctrl+S)
        </button>
      </div>
    </header>
  );
}
