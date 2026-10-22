import React, { useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "../../lib/store";

interface CommandItem {
  id: string;
  category: "操作" | "页面" | "视图";
  title: string;
  description?: string;
  shortcut?: string;
  action: () => void;
}

export default function CommandPalette() {
  const open = useEditorStore((state) => state.commandPaletteOpen);
  const close = useEditorStore((state) => state.closeCommandPalette);

  const pages = useEditorStore((state) => state.pages);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectPage = useEditorStore((state) => state.selectPage);
  const createPage = useEditorStore((state) => state.createPage);

  const selection = useEditorStore((state) => state.selection);
  const deleteSelection = useEditorStore((state) => state.deleteSelection);
  const splitPanelHorizontal = useEditorStore((state) => state.splitPanelHorizontal);
  const splitPanelVertical = useEditorStore((state) => state.splitPanelVertical);

  const saveCurrentPage = useEditorStore((state) => state.saveCurrentPage);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const openLayoutModal = useEditorStore((state) => state.openLayoutModal);
  const openPreviewModal = useEditorStore((state) => state.openPreviewModal);
  const openCompileModal = useEditorStore((state) => state.openCompileModal);
  const openGenerateModal = useEditorStore((state) => state.openGenerateModal);
  const openImportModal = useEditorStore((state) => state.openImportModal);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commands: CommandItem[] = useMemo(() => {
    const list: CommandItem[] = [
      {
        id: "import_json",
        category: "操作",
        title: "导入 JSON 分镜",
        description: "选择文件或粘贴分镜单、MOSS 布局，预览后导入为新页",
        action: () => openImportModal()
      },
      {
        id: "save",
        category: "操作",
        title: "保存当前分镜页",
        description: "立即写入本地磁盘并触发编译校验",
        shortcut: "Ctrl+S",
        action: () => saveCurrentPage(true)
      },
      {
        id: "undo",
        category: "操作",
        title: "撤销上一操作",
        shortcut: "Ctrl+Z",
        action: () => undo()
      },
      {
        id: "redo",
        category: "操作",
        title: "重做操作",
        shortcut: "Ctrl+Shift+Z",
        action: () => redo()
      },
      {
        id: "layout",
        category: "操作",
        title: "生成分镜版式候选",
        description: "根据分镜格数生成多种日漫经典版式布局",
        action: () => openLayoutModal()
      },
      {
        id: "preview",
        category: "操作",
        title: "查看草稿大图预览",
        description: "查看火柴人与提示词排版预览图",
        action: () => openPreviewModal()
      },
      {
        id: "compile",
        category: "操作",
        title: "导出 MOSS JSON",
        description: "编译当前分镜为标准 MOSS 布局规范",
        action: () => void openCompileModal()
      },
      {
        id: "generate",
        category: "操作",
        title: "调用 ComfyUI 生成出图",
        description: "投递 MOSS 批量生图任务",
        shortcut: "⚡",
        action: () => openGenerateModal()
      },
      {
        id: "new_page",
        category: "操作",
        title: "新建分镜页",
        description: "在当前项目中增加空白分镜页面",
        action: () => void createPage()
      }
    ];

    if (selection?.kind === "panel") {
      list.push(
        {
          id: "split_h",
          category: "操作",
          title: `水平切分当前格 (#${selection.id})`,
          description: "将当前选中分镜格横切为上下两格",
          action: () => splitPanelHorizontal(selection.id)
        },
        {
          id: "split_v",
          category: "操作",
          title: `垂直切分当前格 (#${selection.id})`,
          description: "将当前选中分镜格竖切为左右两格",
          action: () => splitPanelVertical(selection.id)
        },
        {
          id: "delete_panel",
          category: "操作",
          title: `删除当前选中分镜格 (#${selection.id})`,
          shortcut: "Del",
          action: () => deleteSelection()
        }
      );
    } else if (selection?.kind === "text") {
      list.push({
        id: "delete_text",
        category: "操作",
        title: `删除当前文字气泡 (#${selection.id})`,
        shortcut: "Del",
        action: () => deleteSelection()
      });
    }

    // Add page switch items
    pages.forEach((p) => {
      list.push({
        id: `page_${p.id}`,
        category: "页面",
        title: `跳转至分镜页: ${p.id}`,
        description: `${p.panel_count} 格 · ${p.description || "无描述"}`,
        shortcut: p.id === activePageId ? "当前" : undefined,
        action: () => void selectPage(p.id)
      });
    });

    return list;
  }, [
    saveCurrentPage,
    undo,
    redo,
    openLayoutModal,
    openPreviewModal,
    openCompileModal,
    openGenerateModal,
    openImportModal,
    createPage,
    selection,
    splitPanelHorizontal,
    splitPanelVertical,
    deleteSelection,
    pages,
    activePageId,
    selectPage
  ]);

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
    );
  }, [commands, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const current = filteredCommands[selectedIndex];
      if (current) {
        current.action();
        close();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/55 backdrop-blur-xs select-none"
      onClick={close}
    >
      <div
        className="w-full max-w-xl bg-[var(--paper-surface)] border-2 border-[var(--ink)] shadow-2xl overflow-hidden font-sans"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 border-b-2 border-[var(--line)] bg-[var(--paper)] px-4 py-3">
          <span className="text-[var(--signal)] font-mono text-base font-bold">⌘K</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入操作指令、分镜页名或搜索功能..."
            className="flex-1 bg-transparent text-sm font-medium text-[var(--ink)] outline-none placeholder:text-[var(--ink-light)]"
          />
          <span className="font-mono text-xs text-[var(--ink-light)] px-1.5 py-0.5 bg-[var(--paper-wash)] border border-[var(--line)] rounded">
            ESC 关闭
          </span>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filteredCommands.length === 0 ? (
            <div className="p-6 text-center text-xs text-[var(--ink-light)] font-mono">
              无匹配操作指令
            </div>
          ) : (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={cmd.id}
                  onClick={() => {
                    cmd.action();
                    close();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2 cursor-pointer transition rounded ${
                    isSelected
                      ? "bg-[var(--signal)] text-white font-semibold"
                      : "text-[var(--ink)] hover:bg-[var(--paper-wash)]"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`text-[10px] font-mono uppercase px-1.5 py-0.2 rounded border ${
                        isSelected
                          ? "border-white/40 bg-white/20 text-white"
                          : "border-[var(--line)] bg-[var(--paper-lift)] text-[var(--ink-light)]"
                      }`}
                    >
                      {cmd.category}
                    </span>
                    <span className="text-[13px] truncate">{cmd.title}</span>
                    {cmd.description && (
                      <span
                        className={`text-xs truncate ${
                          isSelected ? "text-white/80" : "text-[var(--ink-light)]"
                        }`}
                      >
                        · {cmd.description}
                      </span>
                    )}
                  </div>

                  {cmd.shortcut && (
                    <span
                      className={`font-mono text-xs font-bold shrink-0 ml-3 ${
                        isSelected ? "text-white" : "text-[var(--ink-light)]"
                      }`}
                    >
                      {cmd.shortcut}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--paper)] px-4 py-2 text-[11px] text-[var(--ink-light)] font-mono">
          <div className="flex items-center gap-3">
            <span>↑↓ 选择</span>
            <span>↵ 确认</span>
          </div>
          <span>SODA COMMAND PALETTE</span>
        </div>
      </div>
    </div>
  );
}
