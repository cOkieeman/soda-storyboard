import React, { useState } from "react";
import { useEditorStore } from "../../lib/store";

export default function ConflictModal() {
  const conflictModal = useEditorStore((state) => state.conflictModal);
  const closeConflictModal = useEditorStore((state) => state.closeConflictModal);
  const resolveConflictLoadLatest = useEditorStore((state) => state.resolveConflictLoadLatest);

  const [copied, setCopied] = useState(false);

  if (!conflictModal?.open) return null;

  const handleCopy = () => {
    if (conflictModal.localBackup) {
      navigator.clipboard.writeText(conflictModal.localBackup);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4">
      <div className="w-full max-w-xl border-2 border-[var(--signal)] bg-[var(--paper-lift)] p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
          <div className="flex items-center gap-2">
            <span className="bg-[var(--signal)] px-2 py-0.5 font-mono text-xs font-bold text-[var(--paper-lift)]">
              409 CONFLICT
            </span>
            <h3 className="font-serif text-lg font-bold text-[var(--ink)]">
              页面已被外部修改
            </h3>
          </div>
          <button
            type="button"
            onClick={closeConflictModal}
            className="font-mono text-sm font-bold text-[var(--muted)] hover:text-[var(--ink)]"
          >
            ✕
          </button>
        </div>

        <div className="my-4 space-y-3 text-xs leading-relaxed text-[var(--ink)]">
          <p>
            {conflictModal.reason === "production_running" ? (
              <span className="font-bold text-[var(--signal)]">
                后台出图/生产任务正在进行中，该页处于写保护状态以避免覆盖正在生成的内容。
              </span>
            ) : (
              <span>
                分镜单文件已被 AI 助手或命令行在外部修改（版本哈希不一致）。为防止覆盖最新内容，本次保存已被中止。
              </span>
            )}
          </p>

          <div className="border border-[var(--line)] bg-[var(--paper)] p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[11px] font-bold text-[var(--muted)]">
                本地未保存的内容副本 (可复制保留):
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="font-mono text-[10px] text-[var(--signal)] underline"
              >
                {copied ? "已复制到剪贴板！" : "点击复制 JSON"}
              </button>
            </div>
            <textarea
              readOnly
              rows={8}
              value={conflictModal.localBackup || ""}
              className="w-full border border-[var(--rule)] bg-[#ffffff] p-2 font-mono text-[11px] text-[var(--ink)]"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={closeConflictModal}
            className="ui-btn"
          >
            保留本地修改并暂存
          </button>
          <button
            type="button"
            onClick={resolveConflictLoadLatest}
            className="ui-btn ui-btn-primary"
          >
            载入最新版本 (重新加载)
          </button>
        </div>
      </div>
    </div>
  );
}
