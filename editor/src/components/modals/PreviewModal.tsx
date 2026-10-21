import React, { useState } from "react";
import { useEditorStore } from "../../lib/store";

export default function PreviewModal() {
  const previewModal = useEditorStore((state) => state.previewModal);
  const closePreviewModal = useEditorStore((state) => state.closePreviewModal);
  const activePageId = useEditorStore((state) => state.activePageId);
  const currentVersion = useEditorStore((state) => state.currentVersion);

  const [style, setStyle] = useState<"sketch" | "boxes">("sketch");

  if (!previewModal.open) return null;

  const previewUrl = `/api/pages/${encodeURIComponent(activePageId)}/preview.png?style=${style}&scale=1&v=${encodeURIComponent(currentVersion)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4">
      <div className="flex h-[90vh] w-full max-w-5xl flex-col border border-[var(--ink)] bg-[var(--paper-lift)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--paper-surface)] px-5 py-3">
          <div className="flex items-center gap-3">
            <h3 className="font-serif text-lg font-bold text-[var(--ink)]">
              草稿预览大图 / DRAFT SKETCH PREVIEW
            </h3>
            <div className="flex items-center border border-[var(--line)] bg-[var(--paper-lift)]">
              <button
                type="button"
                onClick={() => setStyle("sketch")}
                className={`px-2.5 py-1 font-mono text-xs font-bold transition ${
                  style === "sketch"
                    ? "bg-[var(--signal)] text-[var(--paper-lift)]"
                    : "text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                火柴人草稿 (Sketch)
              </button>
              <button
                type="button"
                onClick={() => setStyle("boxes")}
                className={`px-2.5 py-1 font-mono text-xs font-bold transition ${
                  style === "boxes"
                    ? "bg-[var(--signal)] text-[var(--paper-lift)]"
                    : "text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                分镜线框 (Boxes)
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={closePreviewModal}
            className="font-mono text-base font-bold text-[var(--muted)] hover:text-[var(--ink)]"
          >
            ✕
          </button>
        </div>

        {/* Image Preview Canvas */}
        <div className="flex flex-1 items-center justify-center overflow-auto bg-[var(--paper-wash)] p-6">
          <img
            src={previewUrl}
            alt="Preview"
            className="max-h-full max-w-full object-contain border border-[var(--line)] bg-[#ffffff] shadow-xl"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--paper-surface)] px-5 py-3">
          <span className="font-mono text-xs text-[var(--muted)]">
            青色: 分镜格子 | 红色: 跨格人物 | 绿色: 文字框
          </span>
          <button
            type="button"
            onClick={closePreviewModal}
            className="ui-btn"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
