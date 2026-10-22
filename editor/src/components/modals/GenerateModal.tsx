import { useRef, useState } from "react";
import { useEditorStore } from "../../lib/store";
import ModalShell from "./ModalShell";
import NumberInput from "../ui/NumberInput";

function GenerateDialog() {
  const modal = useEditorStore(state => state.generateModal);
  const job = useEditorStore(state => state.activeJob);
  const [seeds, setSeeds] = useState(modal.seeds || 4);
  const [valid, setValid] = useState(true);
  const [preset, setPreset] = useState(modal.preset || "draft");
  const submitting = useRef(false);
  const active = job?.status === "queued" || job?.status === "running";
  const close = () => useEditorStore.getState().closeGenerateModal();
  const submit = async () => {
    if (submitting.current || !valid || active) return;
    submitting.current = true;
    try { await useEditorStore.getState().submitGenerate({ seeds, preset, model: null, lora: "auto" }); }
    finally { submitting.current = false; }
  };
  return <ModalShell title="生成出图" description="先保存分镜，再生成一组候选。已有结果会保留。" onClose={close} busy={modal.loading} className="max-w-md" footer={<><button className="ui-btn" disabled={modal.loading} onClick={close}>取消</button><button className="ui-btn ui-btn-primary" disabled={modal.loading || !valid || active} onClick={() => void submit()}>{modal.loading ? "正在提交…" : modal.error ? "重试出图" : "开始出图"}</button></>}>
    <div className="space-y-4 p-5"><label className="block"><span className="ui-label">候选张数</span><NumberInput aria-label="候选张数" value={seeds} min={1} max={8} integer disabled={modal.loading} onCommit={setSeeds} onValidityChange={setValid} /><span className="mt-1 block text-xs text-[var(--muted)]">每张使用不同种子，最多 8 张，逐张生成。</span></label><label className="block"><span className="ui-label">画质</span><select className="ui-select" value={preset} disabled={modal.loading} onChange={event => setPreset(event.target.value as "draft" | "final")}><option value="draft">草稿 · 较快查看构图</option><option value="final">定稿 · 较高细节</option></select></label>{active && <p role="status" className="ui-notice-box">当前任务仍在进行，请完成或取消后再生成。</p>}{modal.error && <p role="alert" className="ui-notice-box text-[var(--error)]">{modal.error}</p>}</div>
  </ModalShell>;
}
export default function GenerateModal() { return useEditorStore(state => state.generateModal.open) ? <GenerateDialog /> : null; }
