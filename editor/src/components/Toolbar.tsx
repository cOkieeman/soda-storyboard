import { useEffect, useRef, useState } from "react";
import { AlertCircle, Command, Download, Ellipsis, FileJson, FileUp, Focus, Image, Keyboard, LayoutTemplate, Moon, PanelLeftClose, PanelRight, Redo2, RotateCcw, Save, Sun, Undo2, WandSparkles } from "lucide-react";
import { useEditorStore } from "../lib/store";
import type { Theme } from "../lib/theme";

type Props = { toolLabel: string; onToggleSidebar: () => void; onToggleInspector: () => void; sidebarOpen: boolean; inspectorOpen: boolean; theme: Theme; onToggleTheme: () => void; workspaceFocused?: boolean; onFocusWorkspace?: () => void; onResetWorkspace?: () => void; onExportPng?: () => void | Promise<void>; onExportPdf?: () => void | Promise<void> };

export default function Toolbar({ toolLabel, onToggleSidebar, onToggleInspector, sidebarOpen, inspectorOpen, theme, onToggleTheme, workspaceFocused, onFocusWorkspace, onResetWorkspace, onExportPng, onExportPdf }: Props) {
  const sodaProject = useEditorStore(s => s.sodaProject);
  const activePageId = useEditorStore(s => s.activePageId);
  const pageIndex = useEditorStore(s => s.pages.findIndex(page => page.id === s.activePageId));
  const isSaving = useEditorStore(s => s.isSaving);
  const dirty = useEditorStore(s => s.hasUnsavedChanges);
  const saveStatus = useEditorStore(s => s.saveStatus);
  const saveError = useEditorStore(s => s.saveError);
  const recoveryDraft = useEditorStore(s => s.recoveryDraft);
  const recoveryStorageError = useEditorStore(s => s.recoveryStorageError);
  const savedTime = useEditorStore(s => s.lastSavedTime);
  const connected = useEditorStore(s => s.sseConnected);
  const canUndo = useEditorStore(s => s.canUndo);
  const canRedo = useEditorStore(s => s.canRedo);
  const undoLabel = useEditorStore(s => s.undoLabel);
  const redoLabel = useEditorStore(s => s.redoLabel);
  const singleCanvas = useEditorStore(s => s.sodaPage?.canvas_mode === "single");
  const hasPanels = useEditorStore(s => Boolean(s.sodaPage?.panels.length || s.sodaPage?.canvas_mode === "single"));
  const undo = useEditorStore(s => s.undo);
  const redo = useEditorStore(s => s.redo);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); };
  }, [menuOpen]);
  const run = (action: () => unknown) => { setMenuOpen(false); Promise.resolve().then(action).catch(error => useEditorStore.getState().setNotice(error instanceof Error ? error.message : "操作失败，请重试")); };
  const recover = async (asNew: boolean) => {
    setRecoveryBusy(true); setRecoveryError(null);
    try {
      const state = useEditorStore.getState();
      const result = asNew ? await state.saveRecoveryAsNewPage() : await state.restoreRecoveryDraft();
      if (!result) setRecoveryError("未能恢复草稿。可以保留备份，并尝试另存为新页。");
    } catch (error) { setRecoveryError(error instanceof Error ? error.message : "恢复失败，草稿仍保留"); }
    finally { setRecoveryBusy(false); }
  };
  const downloadRecovery = () => {
    if (!recoveryDraft) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(recoveryDraft.page, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${recoveryDraft.pageId}-recovery.json`; link.click(); URL.revokeObjectURL(url);
  };
  return <>
    <header className="editor-topbar">
      <div className="topbar-identity">
        <span className="brand-mark" aria-label="Soda Storyboard">soda<span>.</span></span>
        <button className="icon-button panel-toggle sidebar-toggle" aria-label="切换页面面板" aria-expanded={sidebarOpen} onClick={onToggleSidebar} title="页面与角色面板"><PanelLeftClose /><span>页面</span></button>
        <nav className="project-breadcrumb" aria-label="当前项目与页面">
          <span title={sodaProject?.name}>{sodaProject?.name || "分镜项目"}</span><span className="breadcrumb-slash">/</span><span className="page-crumb" title={activePageId}>{pageIndex >= 0 ? `第 ${pageIndex + 1} 页` : "载入中"}</span>
        </nav>
      </div>
      <div className="topbar-tools">
        <button className="icon-button" onClick={undo} disabled={!canUndo} title={`${undoLabel ? `撤销：${undoLabel}` : "撤销"} · Ctrl+Z`} aria-label="撤销"><Undo2 /></button>
        <button className="icon-button" onClick={redo} disabled={!canRedo} title={`${redoLabel ? `重做：${redoLabel}` : "重做"} · Ctrl+Shift+Z`} aria-label="重做"><Redo2 /></button>
        <span className="current-tool">{toolLabel}</span>
      </div>
      <div className="topbar-actions">
        <span className={connected ? "sync-indicator is-connected" : "sync-indicator"} title={connected ? "外部修改自动同步已连接" : "外部修改同步正在重连"} aria-label={connected ? "同步已连接" : "同步重连中"} />
        <button className={`save-status${saveError ? " text-[var(--error)]" : ""}`} onClick={() => void useEditorStore.getState().saveCurrentPage(true)} disabled={isSaving} title={saveError || "保存 · Ctrl+S"} aria-live="polite">{saveStatus === "error" ? "保存失败" : saveStatus === "conflict" ? "保存冲突" : isSaving ? "保存中…" : dirty ? "待保存" : "已保存" + (savedTime ? " · " + savedTime : "")}</button>
        {onFocusWorkspace && <button className="icon-button workspace-focus-button" onClick={onFocusWorkspace} aria-label={workspaceFocused ? "退出专注创作" : "专注创作"} aria-pressed={Boolean(workspaceFocused)} title="专注创作：收起两侧面板 · Ctrl+\"><Focus /></button>}
        <button type="button" className="icon-button theme-toggle" onClick={onToggleTheme} aria-pressed={theme === "dark"} aria-label={theme === "dark" ? "切换浅色模式" : "切换暗色模式"} title={theme === "dark" ? "切换浅色模式" : "切换暗色模式"}>{theme === "dark" ? <Sun /> : <Moon />}</button>
        <button className="icon-button panel-toggle inspector-toggle" onClick={onToggleInspector} aria-label="切换检查器" aria-expanded={inspectorOpen} title="选中对象的编辑属性"><PanelRight /><span>属性</span></button>
        <div className="toolbar-menu" ref={menuRef}>
          <button className="icon-button" onClick={() => setMenuOpen(v => !v)} aria-label="更多操作" aria-expanded={menuOpen} title="更多操作"><Ellipsis /></button>
          {menuOpen && <div className="editor-popover action-menu" role="menu" aria-label="更多操作">
            <button className="compact-history-action" role="menuitem" disabled={!canUndo} onClick={() => run(undo)}><Undo2 />{undoLabel ? `撤销：${undoLabel}` : "撤销"}<kbd>Ctrl Z</kbd></button>
            <button className="compact-history-action" role="menuitem" disabled={!canRedo} onClick={() => run(redo)}><Redo2 />{redoLabel ? `重做：${redoLabel}` : "重做"}<kbd>Ctrl Shift Z</kbd></button>
            <button role="menuitem" onClick={() => run(useEditorStore.getState().openCommandPalette)}><Command />命令面板<kbd>Ctrl K</kbd></button>
            <button role="menuitem" onClick={() => run(() => useEditorStore.getState().saveCurrentPage(true))}><Save />保存<kbd>Ctrl S</kbd></button>
            <div className="menu-rule" />
            <button role="menuitem" onClick={() => run(useEditorStore.getState().openImportModal)}><FileUp />导入 JSON</button>
            {!singleCanvas && <button role="menuitem" onClick={() => run(useEditorStore.getState().openLayoutModal)}><LayoutTemplate />版式候选</button>}
            <button role="menuitem" onClick={() => run(useEditorStore.getState().openPreviewModal)}><Image />草稿预览</button>
            <div className="menu-rule" />
            <button role="menuitem" onClick={() => run(useEditorStore.getState().downloadSourceJson)}><FileJson />下载源分镜 JSON<span className="text-xs text-[var(--muted)]">可再次导入</span></button>
            <button role="menuitem" onClick={() => run(useEditorStore.getState().openCompileModal)}><FileJson />导出 MOSS JSON</button>
            <button role="menuitem" disabled={!onExportPng || !hasPanels} onClick={() => onExportPng && run(onExportPng)}><Image />导出页面 PNG</button>
            <button role="menuitem" disabled={!onExportPdf || !hasPanels} onClick={() => onExportPdf && run(onExportPdf)}><Download />导出页面 PDF</button>
            <div className="menu-rule" />
            {onFocusWorkspace && <button role="menuitem" onClick={() => run(onFocusWorkspace)}><Focus />{workspaceFocused ? "退出专注创作" : "专注创作"}</button>}
            {onResetWorkspace && <button role="menuitem" onClick={() => run(onResetWorkspace)}><RotateCcw />重置工作区与视野</button>}
            <button role="menuitem" onClick={() => run(() => window.dispatchEvent(new Event("soda:open-shortcut-help")))}><Keyboard />快捷键帮助<kbd>?</kbd></button>
          </div>}
        </div>
        <button className="ui-btn ui-btn-primary generate-button" disabled={!hasPanels} title={hasPanels ? "生成这一页的候选图" : "先建立分镜格子，再生成出图"} onClick={() => useEditorStore.getState().openGenerateModal()}><WandSparkles /><span>生成出图</span></button>
      </div>
    </header>
    {(saveStatus === "error" || saveStatus === "conflict") && <div className="save-failure-banner flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--error)] bg-[var(--error-wash)] px-4 py-2 text-sm text-[var(--error)]" role="alert"><AlertCircle size={16} /><span className="flex-1">{saveError || (saveStatus === "conflict" ? "页面发生冲突，修改尚未保存。" : "保存失败，修改仍在编辑器中。")}</span><button className="ui-btn ui-btn-sm" disabled={isSaving} onClick={() => void useEditorStore.getState().retrySave()}>重试保存</button><button className="ui-btn ui-btn-sm" onClick={() => useEditorStore.getState().downloadSourceJson()}>下载当前备份</button></div>}
    {recoveryStorageError && <div className="save-failure-banner flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--error)] px-4 py-2 text-sm text-[var(--error)]" role="alert"><AlertCircle size={16} /><span className="flex-1">{recoveryStorageError}</span><button className="ui-btn ui-btn-sm" onClick={() => useEditorStore.getState().downloadSourceJson()}>下载当前备份</button></div>}
    {recoveryDraft && <div className="recovery-draft-banner shrink-0 border-b border-[var(--line)] bg-[var(--warning-wash)] px-4 py-2 text-sm" role="status"><div className="flex flex-wrap items-center gap-2"><span className="flex-1">发现未保存草稿 · {recoveryDraft.pageId}</span><button className="ui-btn ui-btn-sm" disabled={recoveryBusy} onClick={() => void recover(false)}>恢复草稿</button><button className="ui-btn ui-btn-sm" disabled={recoveryBusy} onClick={() => void recover(true)}>另存为新页</button><button className="ui-btn ui-btn-sm" onClick={downloadRecovery}>下载备份</button><button className="ui-btn ui-btn-sm" disabled={recoveryBusy} onClick={() => { if (confirm("丢弃这份未保存草稿？已保存的页面不会删除。")) useEditorStore.getState().discardRecoveryDraft(); }}>丢弃草稿</button></div>{recoveryError && <p className="mt-1 text-[var(--error)]" role="alert">{recoveryError}</p>}</div>}
  </>;
}
