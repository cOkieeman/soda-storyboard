import React, { useState } from "react";
import { useEditorStore } from "../../lib/store";

export default function CompileModal() {
  const compileModal = useEditorStore((state) => state.compileModal);
  const closeCompileModal = useEditorStore((state) => state.closeCompileModal);

  const [copied, setCopied] = useState(false);

  if (!compileModal?.open) return null;

  const jsonString = JSON.stringify(compileModal.moss, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4">
      <div className="flex h-[85vh] w-full max-w-4xl flex-col border border-[var(--ink)] bg-[var(--paper-lift)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--paper-surface)] px-5 py-3">
          <div>
            <h3 className="font-serif text-lg font-bold text-[var(--ink)]">
              编译产物 / COMPILED MOSS JSON
            </h3>
            <p className="font-mono text-xs text-[var(--muted)]">
              已写盘到: {compileModal.path}
            </p>
          </div>
          <button
            type="button"
            onClick={closeCompileModal}
            className="font-mono text-base font-bold text-[var(--muted)] hover:text-[var(--ink)]"
          >
            ✕
          </button>
        </div>

        {/* JSON Preview */}
        <div className="flex-1 overflow-auto p-4">
          <pre className="h-full w-full overflow-auto border border-[var(--line)] bg-[#ffffff] p-4 font-mono text-xs text-[var(--ink)] leading-relaxed">
            {jsonString}
          </pre>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--paper-surface)] px-5 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="ui-btn ui-btn-primary"
            >
              {copied ? "已复制到剪贴板！" : "复制 MOSS JSON"}
            </button>
            <a
              href={`/api/files/${encodeURIComponent(compileModal.path)}`}
              download
              className="ui-btn"
            >
              下载文件
            </a>
          </div>
          <button
            type="button"
            onClick={closeCompileModal}
            className="ui-btn"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
