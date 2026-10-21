import React from "react";
import { useEditorStore } from "../lib/store";

export default function RenderBar() {
  const renders = useEditorStore((state) => state.renders);
  const activeJob = useEditorStore((state) => state.activeJob);
  const layerSettings = useEditorStore((state) => state.layerSettings);
  const setLayerSettings = useEditorStore((state) => state.setLayerSettings);
  const pickRender = useEditorStore((state) => state.pickRender);
  const cancelJob = useEditorStore((state) => state.cancelJob);

  const renderList = renders?.renders || [];
  const selectedRenderPath = renders?.selected_render;

  return (
    <footer className="flex h-24 w-full items-center justify-between border-t border-[var(--line)] bg-[var(--paper-surface)] px-4">
      {/* Left: Candidate List */}
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto py-1">
        <div className="shrink-0 flex flex-col justify-center border-r border-[var(--line)] pr-3 font-mono text-[11px]">
          <span className="font-bold text-[var(--ink)]">底图候选</span>
          <span className="text-[var(--muted)]">{renderList.length} 张可用</span>
        </div>

        {renderList.length === 0 ? (
          <div className="flex items-center text-xs text-[var(--muted)] italic">
            当前页暂无出图结果。点击顶部“生成出图”可开始渲染。
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {renderList.map((item, idx) => {
              const isSelected = item.path === selectedRenderPath;
              return (
                <div
                  key={idx}
                  onClick={() => pickRender(item.path)}
                  className={`group relative h-20 w-16 shrink-0 cursor-pointer overflow-hidden border transition-all ${
                    isSelected
                      ? "border-2 border-[var(--signal)] shadow-[0_0_0_1px_var(--signal)]"
                      : "border border-[var(--line)] hover:border-[var(--ink)]"
                  }`}
                  title={`点击应用为底图: ${item.path}`}
                >
                  <img
                    src={item.url}
                    alt={item.path}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute top-0 left-0 bg-[var(--ink)] px-1 font-mono text-[9px] text-[var(--paper-lift)] opacity-90">
                    #{item.seed || idx + 1}
                  </div>
                  {isSelected && (
                    <div className="absolute bottom-0 inset-x-0 bg-[var(--signal)] py-0.5 text-center font-mono text-[9px] font-bold text-[var(--paper-lift)]">
                      已选用
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Middle: Job Status (Queue / Running / Progress / Cancel) */}
      {activeJob && (
        <div className="mx-4 flex shrink-0 items-center gap-2.5 border border-[var(--line)] bg-[var(--paper-lift)] px-3 py-1.5 font-mono text-xs shadow-sm">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[var(--ink)]">
                任务: {activeJob.operation}
              </span>
              <span
                className={`px-1.5 py-0.2 text-[10px] font-bold ${
                  activeJob.status === "completed"
                    ? "bg-[var(--acid)] text-[var(--ink)]"
                    : activeJob.status === "failed"
                    ? "bg-[var(--signal)] text-[var(--paper-lift)]"
                    : "bg-[var(--paper-wash)] text-[var(--signal)] animate-pulse"
                }`}
              >
                {activeJob.status === "queued"
                  ? "排队中"
                  : activeJob.status === "running"
                  ? "运行中"
                  : activeJob.status === "completed"
                  ? "已完成"
                  : activeJob.status === "failed"
                  ? "失败"
                  : "已取消"}
              </span>
            </div>
            <div className="text-[11px] text-[var(--muted)]">
              {activeJob.message || (activeJob.progress ? activeJob.progress.message : "处理中...")}
              {activeJob.error ? ` (${activeJob.error})` : ""}
            </div>
          </div>

          {(activeJob.status === "queued" || activeJob.status === "running") && (
            <button
              type="button"
              onClick={() => cancelJob(activeJob.id)}
              className="ui-btn ui-btn-sm"
              title="取消后台任务"
            >
              取消
            </button>
          )}
        </div>
      )}

      {/* Right: Layer Toggles & Opacity Controls */}
      <div className="flex shrink-0 items-center gap-4 border-l border-[var(--line)] pl-4 font-mono text-xs">
        {/* Sketch Layer Control */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={layerSettings.showSketch}
                onChange={(e) => setLayerSettings({ showSketch: e.target.checked })}
                className="accent-[var(--signal)]"
              />
              <span className="font-bold text-[var(--ink)]">草稿图层</span>
            </label>
            <span className="text-[10px] text-[var(--muted)]">
              {Math.round(layerSettings.sketchOpacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={layerSettings.sketchOpacity}
            onChange={(e) => setLayerSettings({ sketchOpacity: parseFloat(e.target.value) })}
            disabled={!layerSettings.showSketch}
            className="w-24 accent-[var(--signal)] h-1"
          />
        </div>

        {/* Render Layer Control */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={layerSettings.showRender}
                onChange={(e) => setLayerSettings({ showRender: e.target.checked })}
                className="accent-[var(--signal)]"
              />
              <span className="font-bold text-[var(--ink)]">出图底图</span>
            </label>
            <span className="text-[10px] text-[var(--muted)]">
              {Math.round(layerSettings.renderOpacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={layerSettings.renderOpacity}
            onChange={(e) => setLayerSettings({ renderOpacity: parseFloat(e.target.value) })}
            disabled={!layerSettings.showRender}
            className="w-24 accent-[var(--signal)] h-1"
          />
        </div>
      </div>
    </footer>
  );
}
