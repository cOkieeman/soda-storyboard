import { useEffect, useRef, useState } from "react";
import { ChevronDown, Eye, Image, LayoutTemplate, Maximize, Minus, Plus, Settings2, SquarePen } from "lucide-react";
import { useEditorStore } from "../../lib/store";
import type { CanvasMode } from "../CanvasEditor";

export function CanvasHeading({ width, height, mode, onModeChange }: { width: number; height: number; mode: CanvasMode; onModeChange?: (mode: CanvasMode) => void }) {
  const hasPanels = useEditorStore(state => Boolean(state.sodaPage?.panels.length));
  return (
    <div className="canvas-heading workspace-heading">
      <div className="workspace-modes" role="group" aria-label="工作模式">
        <button type="button" aria-pressed={mode === "draft"} onClick={() => onModeChange?.("draft")}><SquarePen /><span>编辑分镜</span></button>
        <button type="button" aria-pressed={mode === "artwork"} onClick={() => onModeChange?.("artwork")}><Image /><span>查看出图</span></button>
      </div>
      <span className="workspace-dimensions numeric">{width} × {height}</span>
      <div className="workspace-actions">
        <button type="button" disabled={!hasPanels} title={hasPanels ? "为当前格数选择版式" : "先建立第一个格子"} onClick={() => void useEditorStore.getState().openLayoutModal()}><LayoutTemplate />调整版式</button>
        <button type="button" disabled={!hasPanels} onClick={() => useEditorStore.getState().openPreviewModal()}><Eye />检查草稿</button>
      </div>
    </div>
  );
}

export function CanvasZoomBar({ zoom, onZoom, onFit, onReset }: {
  zoom: number;
  onZoom: (delta: number) => void;
  onFit: () => void;
  onReset: () => void;
}) {
  return (
    <div className="canvas-zoom-bar flex h-9 items-center gap-1 border border-[var(--line)] bg-[var(--paper-surface)] px-1 text-xs shadow-sm" aria-label="画布缩放">
      <button type="button" className="canvas-control-button flex h-7 w-7 items-center justify-center" onClick={() => onZoom(-0.05)} title="缩小" aria-label="缩小"><Minus size={15} /></button>
      <button type="button" className="canvas-control-button h-7 min-w-14 px-1 font-mono tabular-nums" onClick={onReset} title="恢复 100%">{Math.round(zoom * 100)}%</button>
      <button type="button" className="canvas-control-button flex h-7 w-7 items-center justify-center" onClick={() => onZoom(0.05)} title="放大" aria-label="放大"><Plus size={15} /></button>
      <span className="mx-1 h-4 border-l border-[var(--line)]" />
      <button type="button" className="canvas-control-button flex h-7 items-center gap-1.5 whitespace-nowrap px-2" onClick={onFit} title="适应画布并居中"><Maximize size={14} />适应</button>
    </div>
  );
}

export function CanvasViewMenu({ showLiveArea, showReadingFlow, onLiveAreaChange, onReadingFlowChange }: {
  showLiveArea: boolean;
  showReadingFlow: boolean;
  onLiveAreaChange: (show: boolean) => void;
  onReadingFlowChange: (show: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const layerSettings = useEditorStore((state) => state.layerSettings);
  const setLayerSettings = useEditorStore((state) => state.setLayerSettings);
  const selectedRenderUrl = useEditorStore((state) => state.selectedRenderUrl);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="canvas-view-control relative">
      {open && (
        <div className="canvas-view-menu absolute bottom-11 right-0 w-60 border border-[var(--line)] bg-[var(--paper-surface)] p-4 text-[13px] shadow-lg" role="dialog" aria-label="画布视图设置">
          <div className="mb-3 text-sm font-semibold">画布视图</div>
          <label className="flex min-h-8 cursor-pointer items-center justify-between gap-3"><span>版心安全线</span><input type="checkbox" checked={showLiveArea} onChange={(event) => onLiveAreaChange(event.target.checked)} /></label>
          <label className="flex min-h-8 cursor-pointer items-center justify-between gap-3"><span>阅读视线流</span><input type="checkbox" checked={showReadingFlow} onChange={(event) => onReadingFlowChange(event.target.checked)} /></label>
          <div className="my-3 border-t border-[var(--line)]" />
          <label className="flex min-h-8 cursor-pointer items-center justify-between gap-3"><span>草稿对照</span><input type="checkbox" checked={layerSettings.showSketch} onChange={(event) => setLayerSettings({ showSketch: event.target.checked })} /></label>
          <label className="mt-1 block text-xs text-[var(--ink-light)]">
            <span className="flex justify-between"><span>草稿透明度</span><span className="font-mono tabular-nums">{Math.round(layerSettings.sketchOpacity * 100)}%</span></span>
            <input aria-label="草稿透明度" className="mt-2 w-full" type="range" min="0" max="100" value={Math.round(layerSettings.sketchOpacity * 100)} onChange={(event) => setLayerSettings({ sketchOpacity: Number(event.target.value) / 100 })} />
          </label>
          <div className="my-3 border-t border-[var(--line)]" />
          <label className="flex min-h-8 cursor-pointer items-center justify-between gap-3"><span>在草稿上叠加出图</span><input type="checkbox" checked={layerSettings.showRender} onChange={(event) => setLayerSettings({ showRender: event.target.checked })} /></label>
          <label className="mt-1 block text-xs text-[var(--ink-light)]">
            <span className="flex justify-between"><span>底图透明度</span><span className="font-mono tabular-nums">{Math.round(layerSettings.renderOpacity * 100)}%</span></span>
            <input aria-label="底图透明度" className="mt-2 w-full" type="range" min="0" max="100" value={Math.round(layerSettings.renderOpacity * 100)} onChange={(event) => setLayerSettings({ renderOpacity: Number(event.target.value) / 100 })} />
          </label>
          {!selectedRenderUrl && <p className="mt-2 text-xs leading-relaxed text-[var(--ink-light)]">选用出图后，可在画布上对照。</p>}
        </div>
      )}
      <button type="button" className="canvas-view-button flex h-9 items-center gap-2 whitespace-nowrap border border-[var(--line)] bg-[var(--paper-surface)] px-3 text-xs shadow-sm" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="画布视图" title="画布视图设置"><Settings2 size={15} /><span>视图</span><ChevronDown size={12} /></button>
    </div>
  );
}
