import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Columns2, Download, LoaderCircle, Maximize, Minus, Plus } from "lucide-react";
import type { RenderItem } from "../types";
import { adjacentCandidate, REVIEW_FIT, zoomReviewAt, type ReviewViewport } from "../lib/reviewViewport";
import ModalShell from "./modals/ModalShell";

type Props = {
  items: RenderItem[];
  initialPath: string;
  savedPath: string | null;
  onClose: () => void;
  onPick: (path: string) => Promise<boolean>;
};

function ReviewPane({ item, label, saved, view, onViewChange }: {
  item: RenderItem; label: string; saved: boolean; view: ReviewViewport;
  onViewChange: React.Dispatch<React.SetStateAction<ReviewViewport>>;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointer: number; x: number; y: number; view: ReviewViewport } | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => { setFailed(false); setReload(0); }, [item.url]);
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = pane.getBoundingClientRect();
      onViewChange(current => zoomReviewAt(current, current.scale * Math.exp(-event.deltaY * 0.0015), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }));
    };
    pane.addEventListener("wheel", onWheel, { passive: false });
    return () => pane.removeEventListener("wheel", onWheel);
  }, [onViewChange]);
  return <section className="candidate-review-pane flex min-h-0 min-w-0 flex-1 flex-col border border-[var(--line)]">
    <div className="flex min-h-[68px] shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2 text-sm sm:min-h-0"><strong>{label}</strong><span className="flex items-center gap-1 text-[var(--muted)]">{saved ? <><Check size={14} />项目已选用</> : "仅预览"}</span></div>
    <div ref={paneRef} className="relative min-h-0 flex-1 overflow-hidden bg-[var(--paper-wash)]" style={{ touchAction: "none", cursor: "grab" }} data-testid={`review-pane-${label.startsWith("A") ? "a" : "b"}`}
      onPointerDown={event => {
        if (event.button !== 0) return;
        if ((event.target as Element).closest("button, a, select")) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, view };
        event.currentTarget.style.cursor = "grabbing";
      }}
      onPointerMove={event => {
        const drag = dragRef.current;
        if (drag?.pointer !== event.pointerId) return;
        onViewChange({ ...drag.view, x: drag.view.x + event.clientX - drag.x, y: drag.view.y + event.clientY - drag.y });
      }}
      onPointerUp={event => { dragRef.current = null; event.currentTarget.style.cursor = "grab"; }}
      onPointerCancel={() => { dragRef.current = null; }}>
      {failed ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center"><p>图片暂时无法载入</p><button className="ui-btn" onClick={() => { setFailed(false); setReload(value => value + 1); }}>重试载入</button></div>
        : <img key={`${item.url}:${reload}`} src={item.url} alt={`${label}，候选图片`} draggable={false} onError={() => setFailed(true)} className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: "center" }} data-review-scale={view.scale} data-review-pan={`${view.x},${view.y}`} />}
    </div>
  </section>;
}

export default function CandidateReview({ items, initialPath, savedPath, onClose, onPick }: Props) {
  const [index, setIndex] = useState(() => Math.max(0, items.findIndex(item => item.path === initialPath)));
  const [compare, setCompare] = useState(false);
  const [secondIndex, setSecondIndex] = useState(() => adjacentCandidate(Math.max(0, items.findIndex(item => item.path === initialPath)), 1, items.length));
  const [view, setView] = useState<ReviewViewport>(REVIEW_FIT);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const first = items[Math.min(index, items.length - 1)];
  const second = items[Math.min(secondIndex, items.length - 1)];
  if (!first) return null;
  const number = (i: number) => String(i + 1).padStart(2, "0");
  const pick = async (path: string) => {
    if (pending) return;
    setPending(path); setError(null); setFailedPath(null);
    try {
      const success = await onPick(path);
      if (!success) { setError("选用失败，原先选用的图片仍保留。请重试。"); setFailedPath(path); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "选用失败，请重试"); setFailedPath(path); }
    finally { setPending(null); }
  };
  const choose = (value: number) => { if (pending) return; setIndex(value); setView(REVIEW_FIT); setError(null); setFailedPath(null); };
  return <ModalShell title="候选图片预览与比较" description="滚轮缩放，拖动移动；A/B 两张图片同步。只有点击“选用”才更改项目。" onClose={onClose} busy={Boolean(pending)} className="h-[92dvh] max-w-[1440px] [&_.modal-content]:overflow-hidden">
    <div className="flex h-full min-h-0 flex-col"
      onKeyDown={event => {
        const input = ["INPUT", "SELECT", "TEXTAREA"].includes((event.target as HTMLElement).tagName);
        if (!input && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); choose(adjacentCandidate(index, event.key === "ArrowLeft" ? -1 : 1, items.length)); }
      }}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <button className="ui-btn ui-btn-sm" aria-label="上一个候选" disabled={items.length < 2 || Boolean(pending)} onClick={() => choose(adjacentCandidate(index, -1, items.length))}><ChevronLeft size={16} /></button>
        <label className="flex items-center gap-1 text-sm">A<select aria-label="预览候选 A" disabled={Boolean(pending)} className="ui-input !w-auto" value={index} onChange={event => choose(Number(event.target.value))}>{items.map((item, i) => <option key={item.path} value={i}>候选 {number(i)}{item.path === savedPath ? " · 已选用" : ""}</option>)}</select></label>
        <button className="ui-btn ui-btn-sm" aria-label="下一个候选" disabled={items.length < 2 || Boolean(pending)} onClick={() => choose(adjacentCandidate(index, 1, items.length))}><ChevronRight size={16} /></button>
        <button className="ui-btn ui-btn-sm" aria-pressed={compare} disabled={items.length < 2 || Boolean(pending)} onClick={() => { setCompare(value => !value); setView(REVIEW_FIT); if (secondIndex === index) setSecondIndex(adjacentCandidate(index, 1, items.length)); }}><Columns2 size={15} />A/B 比较</button>
        {compare && <label className="flex items-center gap-1 text-sm">B<select aria-label="比较候选 B" disabled={Boolean(pending)} className="ui-input !w-auto" value={secondIndex} onChange={event => { setSecondIndex(Number(event.target.value)); setView(REVIEW_FIT); setError(null); setFailedPath(null); }}>{items.map((item, i) => <option key={item.path} value={i}>候选 {number(i)}</option>)}</select></label>}
        <span className="ml-auto flex items-center gap-1"><button className="ui-btn ui-btn-sm" aria-label="缩小候选图" onClick={() => setView(current => zoomReviewAt(current, current.scale / 1.2, { x: 0, y: 0 }))}><Minus size={15} /></button><span className="min-w-12 text-center text-sm numeric">{Math.round(view.scale * 100)}%</span><button className="ui-btn ui-btn-sm" aria-label="放大候选图" onClick={() => setView(current => zoomReviewAt(current, current.scale * 1.2, { x: 0, y: 0 }))}><Plus size={15} /></button><button className="ui-btn ui-btn-sm" onClick={() => setView(REVIEW_FIT)}><Maximize size={14} />适应</button></span>
      </div>
      <div className="flex min-h-0 flex-1 gap-2 p-2" data-testid="candidate-review-images">
        <ReviewPane item={first} label={`A · 候选 ${number(index)}`} saved={first.path === savedPath} view={view} onViewChange={setView} />
        {compare && second && <ReviewPane item={second} label={`B · 候选 ${number(secondIndex)}`} saved={second.path === savedPath} view={view} onViewChange={setView} />}
      </div>
      <footer className="shrink-0 border-t border-[var(--line)] px-3 py-3">
        {pending && <p className="mb-2 flex items-center gap-2 text-sm" role="status"><LoaderCircle size={15} className="is-spinning" />正在选用候选 {number(items.findIndex(item => item.path === pending))}，请稍候…</p>}
        {error && <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-[var(--error)]" role="alert"><span>{error}</span><button className="ui-btn ui-btn-sm" disabled={Boolean(pending)} onClick={() => failedPath && void pick(failedPath)}>重试选用</button></div>}
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="min-w-0 break-all text-xs text-[var(--muted)]">A 种子：{first.seed ?? "未记录"}{compare && second ? ` · B 种子：${second.seed ?? "未记录"}` : ""}</p><div className="flex flex-wrap gap-2"><a className="ui-btn ui-btn-sm" href={first.url} download><Download size={15} />下载 A</a><button className="ui-btn ui-btn-primary" disabled={Boolean(pending) || savedPath === first.path} onClick={() => void pick(first.path)}>{pending === first.path ? <LoaderCircle size={15} className="is-spinning" /> : savedPath === first.path ? <Check size={15} /> : null}{pending === first.path ? "选用中…" : savedPath === first.path ? "A 已选用" : "选用 A"}</button>{compare && second && <button className="ui-btn" disabled={Boolean(pending) || savedPath === second.path} onClick={() => void pick(second.path)}>{pending === second.path ? "选用中…" : savedPath === second.path ? "B 已选用" : "选用 B"}</button>}</div></div>
      </footer>
    </div>
  </ModalShell>;
}
