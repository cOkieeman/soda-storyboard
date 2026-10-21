import React from "react";
import { useEditorStore } from "../lib/store";

export default function PageSidebar() {
  const sodaProject = useEditorStore((state) => state.sodaProject);
  const pages = useEditorStore((state) => state.pages);
  const characters = useEditorStore((state) => state.characters);
  const characterDetails = useEditorStore((state) => state.characterDetails);
  const activePageId = useEditorStore((state) => state.activePageId);
  const selectPage = useEditorStore((state) => state.selectPage);
  const createPage = useEditorStore((state) => state.createPage);
  const deletePage = useEditorStore((state) => state.deletePage);

  return (
    <aside className="flex h-full flex-col border-r border-[var(--line)] bg-[var(--paper-wash)]">
      {/* Project & Reading Direction Header */}
      <div className="border-b border-[var(--line)] bg-[var(--paper-surface)] p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-serif text-lg font-bold tracking-tight text-[var(--ink)]">
            {sodaProject?.name || "Soda Storyboard"}
          </span>
          <span className="border border-[var(--ink)] bg-[var(--acid)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--ink)]">
            {sodaProject?.reading_direction === "rtl" ? "日漫从右往左 (RTL)" : "从左往右 (LTR)"}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-[var(--muted)]">
          <span>画布 {sodaProject?.default_canvas_width || 1024} × {sodaProject?.default_canvas_height || 1536}</span>
          <span>{pages.length} 页</span>
        </div>
      </div>

      {/* Pages Section */}
      <div className="flex min-h-0 flex-1 flex-col border-b border-[var(--line)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--paper)] px-3 py-2">
          <span className="font-mono text-xs font-bold tracking-wider text-[var(--ink)]">
            分镜页面 / PAGES
          </span>
          <button
            type="button"
            onClick={createPage}
            className="ui-btn ui-btn-sm"
            title="新建分镜页"
          >
            + 新建页
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {pages.map((p) => {
            const isActive = p.id === activePageId;
            const previewUrl = `/api/pages/${encodeURIComponent(p.id)}/preview.png?style=sketch&scale=0.2&v=${encodeURIComponent(p.version)}`;

            return (
              <div
                key={p.id}
                onClick={() => selectPage(p.id)}
                className={`group relative flex cursor-pointer border p-2 transition-all ${
                  isActive
                    ? "border-[var(--signal)] bg-[var(--paper-lift)] shadow-[inset_4px_0_var(--signal)]"
                    : "border-[var(--line)] bg-[var(--paper-surface)] hover:border-[var(--ink)]"
                }`}
              >
                {/* Sketch Thumbnail */}
                <div className="relative h-20 w-14 shrink-0 overflow-hidden border border-[var(--line)] bg-[#ffffff]">
                  <img
                    src={previewUrl}
                    alt={p.id}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      // Fallback for image loading error
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                  <div className="absolute bottom-0 right-0 bg-[var(--ink)] px-1 font-mono text-[9px] text-[var(--paper-lift)]">
                    {p.panel_count}格
                  </div>
                </div>

                {/* Page Info */}
                <div className="ml-2.5 flex min-w-0 flex-1 flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="truncate font-mono text-xs font-bold text-[var(--ink)]">
                      {p.id}
                    </span>
                    {isActive && (
                      <span className="font-mono text-[10px] font-bold text-[var(--signal)]">
                        ● 当前
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-2 text-[11px] leading-snug text-[var(--muted)]">
                    {p.description || "无描述"}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-[var(--muted)]">
                    <span className="font-mono">P4a</span>
                    {pages.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`确认将分镜页 ${p.id} 移入回收站 (.trash) 吗？`)) {
                            deletePage(p.id);
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 font-mono text-[10px] text-[var(--signal)] hover:underline"
                        title="移入回收站"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Characters Section (Readonly List) */}
      <div className="flex h-56 flex-col bg-[var(--paper-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--paper)] px-3 py-1.5">
          <span className="font-mono text-xs font-bold tracking-wider text-[var(--ink)]">
            角色列表 / CHARACTERS ({characters.length})
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {characters.length === 0 ? (
            <p className="p-3 text-center text-xs text-[var(--muted)]">暂无角色</p>
          ) : (
            characters.map((c) => {
              const detail = characterDetails[c.id];
              return (
                <div
                  key={c.id}
                  className="border border-[var(--line)] bg-[var(--paper-lift)] p-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-[var(--ink)]">
                      {c.display_name} ({c.id})
                    </span>
                    {c.has_lora && (
                      <span className="border border-[var(--ink)] bg-[var(--acid)] px-1 font-mono text-[9px] font-bold text-[var(--ink)]">
                        LoRA {detail?.lora?.strength ? `×${detail.lora.strength}` : "有效"}
                      </span>
                    )}
                  </div>
                  {detail?.appearance?.zh ? (
                    <p className="mt-1 line-clamp-1 text-[11px] text-[var(--muted)]">
                      {detail.appearance.zh}
                    </p>
                  ) : detail?.appearance?.en ? (
                    <p className="mt-1 line-clamp-1 text-[11px] text-[var(--muted)]">
                      {detail.appearance.en}
                    </p>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
