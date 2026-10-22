import { useEffect, useId, useMemo, useRef, useState } from "react";
import { batchActions } from "../../lib/editorActions";
import { useEditorStore } from "../../lib/store";
import ModalShell, { isComposingEvent } from "./ModalShell";

function CommandDialog() {
  const pages = useEditorStore(state => state.pages);
  const selection = useEditorStore(state => state.selection);
  const selections = useEditorStore(state => state.selections);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => useEditorStore.getState().closeCommandPalette();
  const commands = useMemo(() => {
    const state = useEditorStore.getState();
    return [
      { id: "save", label: "保存当前分镜页", shortcut: "Ctrl+S", keywords: "保存 磁盘", run: () => state.saveCurrentPage(true) },
      { id: "undo", label: "撤销上一操作", shortcut: "Ctrl+Z", keywords: "撤销", run: state.undo },
      { id: "redo", label: "重做操作", shortcut: "Ctrl+Shift+Z", keywords: "重做", run: state.redo },
      { id: "import", label: "导入 JSON 分镜", keywords: "文件 粘贴", run: state.openImportModal },
      { id: "new-page", label: "新建分镜页", keywords: "页面", run: state.createPage },
      { id: "layout", label: "生成分镜版式候选", keywords: "布局 分格", run: state.openLayoutModal },
      { id: "preview", label: "查看草稿大图预览", keywords: "火柴人 线框", run: state.openPreviewModal },
      { id: "compile", label: "导出 MOSS JSON", keywords: "编译 引擎 布局", run: state.openCompileModal },
      { id: "source-json", label: "下载源分镜 JSON（可继续编辑）", keywords: "导出 备份 人物 姿势", run: state.downloadSourceJson },
      { id: "generate", label: "生成出图", keywords: "候选 ComfyUI", run: state.openGenerateModal },
      ...batchActions,
      ...(selection?.kind === "panel" ? [
        { id: "split-h", label: "上下分格", keywords: "水平 切分", run: () => state.splitPanelHorizontal(selection.id) },
        { id: "split-v", label: "左右分格", keywords: "垂直 切分", run: () => state.splitPanelVertical(selection.id) }
      ] : []),
      ...(selection ? [{ id: "delete", label: "删除当前选中对象", shortcut: "Delete", keywords: "删除", run: state.deleteSelection }] : []),
      ...pages.map(page => ({ id: `page-${page.id}`, label: `跳转至分镜页：${page.id}`, keywords: `页面 ${page.description || ""}`, run: () => state.selectPage(page.id) }))
    ];
  }, [pages, selection, selections]);
  const filtered = commands.filter(command => `${command.label} ${command.keywords}`.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => setIndex(0), [query]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [index, query]);
  const current = filtered[Math.min(index, filtered.length - 1)];
  const reason = current && "disabled" in current ? current.disabled?.() : null;
  const run = (command: typeof commands[number]) => {
    if ("disabled" in command && command.disabled?.()) return;
    close(); void command.run();
  };
  return <ModalShell title="命令面板" description="搜索操作或页面。方向键选择，Enter 执行。" onClose={close} initialFocusRef={input} className="max-w-2xl">
    <div className="p-4"><label className="ui-label" htmlFor={`${id}-search`}>搜索命令</label><input ref={input} id={`${id}-search`} role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={current ? `${id}-${current.id}` : undefined} value={query} onChange={event => setQuery(event.target.value)} placeholder="输入操作指令、分镜页名或搜索功能…" className="ui-input" onKeyDown={event => {
      if (isComposingEvent(event.nativeEvent)) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setIndex(value => (value + (event.key === "ArrowDown" ? 1 : -1) + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1)); }
      else if (event.key === "Enter") { event.preventDefault(); if (current) run(current); }
    }} /></div>
    <div ref={list} id={`${id}-list`} role="listbox" aria-label="匹配的命令" className="max-h-[52dvh] overflow-auto px-2 pb-2">{filtered.map((command, position) => {
      const disabled = "disabled" in command ? command.disabled?.() : null;
      return <button type="button" role="option" tabIndex={-1} id={`${id}-${command.id}`} aria-selected={position === index} aria-disabled={Boolean(disabled)} key={command.id} onMouseEnter={() => setIndex(position)} onClick={() => run(command)} className={`flex w-full items-center justify-between gap-4 px-3 py-3 text-left ${position === index ? "bg-[var(--signal-wash)]" : "hover:bg-[var(--paper-wash)]"}`}><span className="min-w-0"><span className="block">{command.label}</span>{disabled && <span className="block text-xs text-[var(--muted)]">{disabled}</span>}</span>{"shortcut" in command && command.shortcut && <kbd className="shrink-0 text-xs text-[var(--muted)]">{command.shortcut}</kbd>}</button>;
    })}{!filtered.length && <p className="p-6 text-[var(--muted)]">没有匹配的命令，请换一个关键词。</p>}</div><p role="status" className="border-t border-[var(--line)] px-5 py-3 text-xs text-[var(--muted)]">{reason || `${filtered.length} 项命令 · Esc 关闭`}</p>
  </ModalShell>;
}
export default function CommandPalette() { return useEditorStore(state => state.commandPaletteOpen) ? <CommandDialog /> : null; }
