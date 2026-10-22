import { useEffect, useRef, useState } from "react";
import { Command, Ellipsis, FileJson, FileUp, Image, LayoutTemplate, Moon, PanelLeftClose, PanelRight, Redo2, Save, Sun, Undo2, WandSparkles } from "lucide-react";
import { useEditorStore } from "../lib/store";
import type { Theme } from "../lib/theme";

type Props = { toolLabel: string; onToggleSidebar: () => void; onToggleInspector: () => void; sidebarOpen: boolean; inspectorOpen: boolean; theme: Theme; onToggleTheme: () => void };

export default function Toolbar({ toolLabel, onToggleSidebar, onToggleInspector, sidebarOpen, inspectorOpen, theme, onToggleTheme }: Props) {
  const sodaProject = useEditorStore(s => s.sodaProject);
  const activePageId = useEditorStore(s => s.activePageId);
  const pageIndex = useEditorStore(s => s.pages.findIndex(page => page.id === s.activePageId));
  const isSaving = useEditorStore(s => s.isSaving);
  const dirty = useEditorStore(s => s.hasUnsavedChanges);
  const savedTime = useEditorStore(s => s.lastSavedTime);
  const connected = useEditorStore(s => s.sseConnected);
  const canUndo = useEditorStore(s => s.canUndo);
  const canRedo = useEditorStore(s => s.canRedo);
  const hasPanels = useEditorStore(s => Boolean(s.sodaPage?.panels.length));
  const undo = useEditorStore(s => s.undo);
  const redo = useEditorStore(s => s.redo);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); };
  }, [menuOpen]);
  const run = (action: () => unknown) => { setMenuOpen(false); void action(); };
  return (
    <header className="editor-topbar">
      <div className="topbar-identity">
        <span className="brand-mark" aria-label="Soda Storyboard">soda<span>.</span></span>
        <button className="icon-button panel-toggle sidebar-toggle" aria-label="切换页面面板" aria-expanded={sidebarOpen} onClick={onToggleSidebar} title="页面与角色面板"><PanelLeftClose /><span>页面</span></button>
        <nav className="project-breadcrumb" aria-label="当前项目与页面">
          <span title={sodaProject?.name}>{sodaProject?.name || "分镜项目"}</span><span className="breadcrumb-slash">/</span><span className="page-crumb" title={activePageId}>{pageIndex >= 0 ? `第 ${pageIndex + 1} 页` : "载入中"}</span>
        </nav>
      </div>
      <div className="topbar-tools">
        <button className="icon-button" onClick={undo} disabled={!canUndo} title="撤销 · Ctrl+Z" aria-label="撤销"><Undo2 /></button>
        <button className="icon-button" onClick={redo} disabled={!canRedo} title="重做 · Ctrl+Shift+Z" aria-label="重做"><Redo2 /></button>
        <span className="current-tool">{toolLabel}</span>
      </div>
      <div className="topbar-actions">
        <span className={connected ? "sync-indicator is-connected" : "sync-indicator"} title={connected ? "外部修改自动同步已连接" : "外部修改同步正在重连"} aria-label={connected ? "同步已连接" : "同步重连中"} />
        <button className="save-status" onClick={() => void useEditorStore.getState().saveCurrentPage(true)} disabled={isSaving} title="保存 · Ctrl+S" aria-live="polite">{isSaving ? "保存中…" : dirty ? "待保存" : "已保存" + (savedTime ? " · " + savedTime : "")}</button>
        <button type="button" className="icon-button theme-toggle" onClick={onToggleTheme} aria-pressed={theme === "dark"} aria-label={theme === "dark" ? "切换浅色模式" : "切换暗色模式"} title={theme === "dark" ? "切换浅色模式" : "切换暗色模式"}>{theme === "dark" ? <Sun /> : <Moon />}</button>
        <button className="icon-button panel-toggle inspector-toggle" onClick={onToggleInspector} aria-label="切换检查器" aria-expanded={inspectorOpen} title="选中对象的编辑属性"><PanelRight /><span>属性</span></button>
        <div className="toolbar-menu" ref={menuRef}>
          <button className="icon-button" onClick={() => setMenuOpen(v => !v)} aria-label="更多操作" aria-expanded={menuOpen} title="更多操作"><Ellipsis /></button>
          {menuOpen && <div className="editor-popover action-menu" role="menu" aria-label="更多操作">
            <button className="compact-history-action" role="menuitem" disabled={!canUndo} onClick={() => run(undo)}><Undo2 />撤销<kbd>Ctrl Z</kbd></button>
            <button className="compact-history-action" role="menuitem" disabled={!canRedo} onClick={() => run(redo)}><Redo2 />重做<kbd>Ctrl Shift Z</kbd></button>
            <button role="menuitem" onClick={() => run(useEditorStore.getState().openCommandPalette)}><Command />命令面板<kbd>Ctrl K</kbd></button>
            <button role="menuitem" onClick={() => run(() => useEditorStore.getState().saveCurrentPage(true))}><Save />保存<kbd>Ctrl S</kbd></button>
            <div className="menu-rule" />
            <button role="menuitem" onClick={() => run(useEditorStore.getState().openImportModal)}><FileUp />导入 JSON</button>
            <button role="menuitem" onClick={() => run(useEditorStore.getState().openLayoutModal)}><LayoutTemplate />版式候选</button>
            <button role="menuitem" onClick={() => run(useEditorStore.getState().openPreviewModal)}><Image />草稿预览</button>
            <button role="menuitem" onClick={() => run(useEditorStore.getState().openCompileModal)}><FileJson />导出 MOSS JSON</button>
          </div>}
        </div>
        <button className="ui-btn ui-btn-primary generate-button" disabled={!hasPanels} title={hasPanels ? "生成这一页的候选图" : "先建立分镜格子，再生成出图"} onClick={() => useEditorStore.getState().openGenerateModal()}><WandSparkles /><span>生成出图</span></button>
      </div>
    </header>
  );
}
