import React from "react";
import { useEditorStore } from "../../lib/store";

export default function LayoutModal() {
  const layoutModal = useEditorStore((state) => state.layoutModal);
  const closeLayoutModal = useEditorStore((state) => state.closeLayoutModal);
  const applyLayoutCandidate = useEditorStore((state) => state.applyLayoutCandidate);

  if (!layoutModal.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4">
      <div className="flex h-[85vh] w-full max-w-4xl flex-col border border-[var(--ink)] bg-[var(--paper-lift)] shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--paper-surface)] px-5 py-3.5">
          <div>
            <h3 className="font-serif text-lg font-bold text-[var(--ink)]">
              版式推荐与候选 / LAYOUT SUGGESTIONS
            </h3>
            <p className="font-mono text-xs text-[var(--muted)]">
              选择版式后直接应用到当前页，保留人物台词和描述，仅更新分镜几何
            </p>
          </div>
          <button
            type="button"
            onClick={closeLayoutModal}
            className="font-mono text-base font-bold text-[var(--muted)] hover:text-[var(--ink)]"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {layoutModal.loading ? (
            <div className="flex h-64 flex-col items-center justify-center space-y-2">
              <span className="font-mono text-sm text-[var(--signal)] animate-pulse">
                正在分析当前页分镜并生成版式候选...
              </span>
            </div>
          ) : layoutModal.error ? (
            <div className="ui-notice-box text-[var(--signal)]">
              生成候选失败: {layoutModal.error}
            </div>
          ) : layoutModal.candidates.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-xs text-[var(--muted)]">
              暂无可推荐版式
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {layoutModal.candidates.map((cand) => (
                <div
                  key={cand.candidate_id}
                  className="flex flex-col border border-[var(--line)] bg-[var(--paper-surface)] p-3 transition hover:border-[var(--ink)] hover:shadow-md"
                >
                  {/* Thumbnail */}
                  <div className="relative aspect-[2/3] w-full overflow-hidden border border-[var(--line)] bg-[#ffffff]">
                    <img
                      src={cand.preview_url}
                      alt={cand.name_zh || cand.name}
                      className="h-full w-full object-contain p-1"
                      loading="lazy"
                    />
                    <div className="absolute top-1 right-1 bg-[var(--ink)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--paper-lift)]">
                      {cand.panel_count} 格
                    </div>
                  </div>

                  {/* Title & Description */}
                  <div className="mt-2.5 flex-1">
                    <h4 className="font-mono text-xs font-bold text-[var(--ink)]">
                      {cand.name_zh || cand.name}
                    </h4>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--muted)]">
                      {cand.description}
                    </p>
                  </div>

                  {/* Action */}
                  <button
                    type="button"
                    onClick={() => applyLayoutCandidate(cand.candidate_id)}
                    className="ui-btn ui-btn-primary mt-3 w-full"
                  >
                    应用此版式
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end border-t border-[var(--line)] bg-[var(--paper-surface)] px-5 py-3">
          <button
            type="button"
            onClick={closeLayoutModal}
            className="ui-btn"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
