import React, { useState } from "react";
import { useEditorStore } from "../../lib/store";

export default function GenerateModal() {
  const generateModal = useEditorStore((state) => state.generateModal);
  const closeGenerateModal = useEditorStore((state) => state.closeGenerateModal);
  const submitGenerate = useEditorStore((state) => state.submitGenerate);

  const [seeds, setSeeds] = useState(generateModal.seeds || 4);
  const [preset, setPreset] = useState<"draft" | "final">(generateModal.preset || "draft");

  if (!generateModal.open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitGenerate({
      seeds,
      preset,
      model: null,
      lora: "auto"
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4">
      <div className="w-full max-w-md border border-[var(--ink)] bg-[var(--paper-lift)] p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
          <div className="flex items-center gap-2">
            <span className="bg-[var(--signal)] px-2 py-0.5 font-mono text-xs font-bold text-[var(--paper-lift)]">
              GENERATE
            </span>
            <h3 className="font-serif text-lg font-bold text-[var(--ink)]">
              提交分镜出图
            </h3>
          </div>
          <button
            type="button"
            onClick={closeGenerateModal}
            className="font-mono text-base font-bold text-[var(--muted)] hover:text-[var(--ink)]"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="my-5 space-y-4">
          <div>
            <label className="ui-label">出图张数 (Seeds: 1 ~ 8)</label>
            <input
              type="number"
              min={1}
              max={8}
              value={seeds}
              onChange={(e) => setSeeds(Math.max(1, Math.min(8, parseInt(e.target.value) || 1)))}
              className="ui-input"
            />
            <span className="mt-1 block font-mono text-[10px] text-[var(--muted)]">
              每次任务将串行生成指定张数的候选底图
            </span>
          </div>

          <div>
            <label className="ui-label">生成预设 (Preset)</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as "draft" | "final")}
              className="ui-select"
            >
              <option value="draft">草稿质量 (Draft - 快速预览)</option>
              <option value="final">定稿质量 (Final - 高清渲染)</option>
            </select>
          </div>

          {generateModal.error && (
            <div className="ui-notice-box border-l-4 border-[var(--signal)] bg-[var(--paper-surface)] p-3 text-xs leading-relaxed">
              <span className="font-bold text-[var(--signal)]">提示: </span>
              {generateModal.error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--line)]">
            <button
              type="button"
              onClick={closeGenerateModal}
              className="ui-btn"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={generateModal.loading}
              className="ui-btn ui-btn-primary"
            >
              {generateModal.loading ? "提交中..." : "开始出图"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
