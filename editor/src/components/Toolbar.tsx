import React from "react";
import { useEditorStore } from "../lib/store";

export default function Toolbar() {
  const sodaProject = useEditorStore((state) => state.sodaProject);
  const activePageId = useEditorStore((state) => state.activePageId);
  const isSaving = useEditorStore((state) => state.isSaving);
  const hasUnsavedChanges = useEditorStore((state) => state.hasUnsavedChanges);
  const lastSavedTime = useEditorStore((state) => state.lastSavedTime);
  const sseConnected = useEditorStore((state) => state.sseConnected);

  const saveCurrentPage = useEditorStore((state) => state.saveCurrentPage);
  const openLayoutModal = useEditorStore((state) => state.openLayoutModal);
  const openPreviewModal = useEditorStore((state) => state.openPreviewModal);
  const openCompileModal = useEditorStore((state) => state.openCompileModal);
  const openGenerateModal = useEditorStore((state) => state.openGenerateModal);

  return (
    <header className="flex h-12 w-full items-center justify-between border-b border-[var(--line)] bg-[var(--paper-surface)] px-4">
      {/* Brand & Project Info */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 border border-[var(--ink)] bg-[var(--ink)] px-2 py-1 text-[var(--paper-lift)]">
          <span className="font-mono text-xs font-black tracking-widest">SODA</span>
          <span className="bg-[var(--acid)] px-1 font-mono text-[10px] font-bold text-[var(--ink)]">
            EDITOR
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="font-bold text-[var(--ink)]">{sodaProject?.name || "布丁争夺战"}</span>
          <span className="text-[var(--rule)]">/</span>
          <span className="text-[var(--signal)]">{activePageId || "pudding"}</span>
        </div>
      </div>

      {/* Main Operations */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={openLayoutModal}
          className="ui-btn"
          title="生成多种分镜版式候选并直接替换"
        >
          <span className="text-[var(--signal)]">⊞</span> 版式候选
        </button>

        <button
          type="button"
          onClick={openPreviewModal}
          className="ui-btn"
          title="查看后端渲染的火柴人与分镜草稿大图"
        >
          <span>👁</span> 草稿预览
        </button>

        <button
          type="button"
          onClick={openCompileModal}
          className="ui-btn"
          title="调用编译接口生成 MOSS JSON"
        >
          <span>⤓</span> 导出 JSON
        </button>

        <button
          type="button"
          onClick={openGenerateModal}
          className="ui-btn ui-btn-primary"
          title="调用 P3 出图接口（如尚未安装将给出提示）"
        >
          <span>⚡</span> 生成出图
        </button>
      </div>

      {/* Save Status & Action */}
      <div className="flex items-center gap-3">
        <span role="status" className="font-mono text-xs text-[var(--muted)]" title={sseConnected ? "SSE 已连接，文件修改会自动同步" : "SSE 断开，正在重连"}>
          {sseConnected ? "● 与 AI 同步中" : "○ 断开重连中"}
        </span>
        <div className="font-mono text-xs">
          {isSaving ? (
            <span className="text-[var(--signal)] animate-pulse">正在写盘保存...</span>
          ) : hasUnsavedChanges ? (
            <span className="font-bold text-[var(--signal)]">● 未保存修改 (1s 自动保存)</span>
          ) : (
            <span className="text-[var(--muted)]">已保存 {lastSavedTime ? `(${lastSavedTime})` : ""}</span>
          )}
        </div>

        <button
          type="button"
          onClick={() => saveCurrentPage(true)}
          disabled={isSaving || !hasUnsavedChanges}
          className="ui-btn ui-btn-ink"
          title="手动保存 (Ctrl+S)"
        >
          保存 (Ctrl+S)
        </button>
      </div>
    </header>
  );
}
