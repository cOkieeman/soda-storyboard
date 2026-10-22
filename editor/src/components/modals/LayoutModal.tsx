import { useRef, useState } from "react";
import { useEditorStore } from "../../lib/store";
import ModalShell from "./ModalShell";

function LayoutDialog() {
  const modal = useEditorStore(state => state.layoutModal);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const apply = async (id: string) => {
    if (busy.current) return;
    busy.current = true; setApplying(id); setError("");
    try { if (!(await useEditorStore.getState().applyLayoutCandidate(id))) setError("版式未应用。请检查保存提示后重试，当前分镜已保留。"); }
    catch (failure) { setError((failure as Error).message); }
    finally { busy.current = false; setApplying(null); }
  };
  const close = () => useEditorStore.getState().closeLayoutModal();
  return <ModalShell title="版式候选" description="选择新的分格布局。画面描述、人物和台词会保留。" busy={Boolean(applying)} onClose={close} className="max-w-4xl" footer={<button className="ui-btn" disabled={Boolean(applying)} onClick={close}>关闭</button>}>
    <div className="p-5">{modal.loading ? <p role="status" className="py-16 text-center text-[var(--muted)]">正在准备版式候选…</p> : modal.error ? <div role="alert" className="space-y-3"><p>{modal.error}</p><button className="ui-btn" onClick={() => void useEditorStore.getState().openLayoutModal()}>重新获取候选</button></div> : modal.candidates.length ? <div className="grid grid-cols-2 gap-4 md:grid-cols-3">{modal.candidates.map(candidate => <section className="flex min-w-0 flex-col gap-2 border-b border-[var(--line)] pb-4" key={candidate.candidate_id}><img src={candidate.preview_url} alt={`${candidate.name_zh || candidate.name}，${candidate.panel_count} 格`} loading="lazy" className="h-52 w-full bg-white object-contain" /><h3 className="text-sm font-semibold">{candidate.name_zh || candidate.name}</h3><p className="flex-1 text-xs text-[var(--muted)]">{candidate.description}</p><button className="ui-btn w-full" disabled={Boolean(applying)} onClick={() => void apply(candidate.candidate_id)}>{applying === candidate.candidate_id ? "正在应用…" : "应用此版式"}</button></section>)}</div> : <div className="space-y-3 py-8"><p>当前格数暂无匹配版式。可以关闭后手动分格。</p><button className="ui-btn" onClick={() => void useEditorStore.getState().openLayoutModal()}>重新获取候选</button></div>}{error && <p role="alert" className="mt-4 text-[var(--error)]">{error}</p>}</div>
  </ModalShell>;
}
export default function LayoutModal() { return useEditorStore(state => state.layoutModal.open) ? <LayoutDialog /> : null; }
