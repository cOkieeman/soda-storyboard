import { useState } from "react";
import { useEditorStore } from "../../lib/store";
import ModalShell from "./ModalShell";

function PreviewDialog() {
  const pageId = useEditorStore(state => state.activePageId);
  const version = useEditorStore(state => state.currentVersion);
  const [style, setStyle] = useState("sketch");
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState("loading");
  const close = () => useEditorStore.getState().closePreviewModal();
  const changeStyle = (value: string) => { setStatus("loading"); setStyle(value); };
  return <ModalShell title="草稿预览" description="核对分格、人物和文字范围。预览不会改变当前页面。" onClose={close} className="max-w-5xl" footer={<button className="ui-btn" onClick={close}>关闭</button>}>
    <div className="flex gap-2 border-b border-[var(--line)] px-5 py-3" role="group" aria-label="预览方式"><button className={`ui-btn ${style === "sketch" ? "ui-btn-acid" : ""}`} aria-pressed={style === "sketch"} onClick={() => changeStyle("sketch")}>人物草稿</button><button className={`ui-btn ${style === "boxes" ? "ui-btn-acid" : ""}`} aria-pressed={style === "boxes"} onClick={() => changeStyle("boxes")}>分镜线框</button></div>
    <div className="relative flex min-h-64 items-center justify-center bg-[var(--paper-wash)] p-5">{status === "loading" && <p role="status" className="absolute bg-[var(--paper)] px-4 py-2">正在载入预览…</p>}{status === "error" ? <div role="alert" className="space-y-3"><p>预览图片未能载入，请重试。</p><button className="ui-btn" onClick={() => { setStatus("loading"); setAttempt(value => value + 1); }}>重新载入</button></div> : <img key={`${style}:${attempt}`} src={`/api/pages/${encodeURIComponent(pageId)}/preview.png?style=${style}&scale=1&v=${encodeURIComponent(version)}&retry=${attempt}`} alt="当前分镜页草稿预览" className="max-h-[65dvh] max-w-full bg-white object-contain" onLoad={() => setStatus("ready")} onError={() => setStatus("error")} />}</div>
  </ModalShell>;
}
export default function PreviewModal() { return useEditorStore(state => state.previewModal.open) ? <PreviewDialog /> : null; }
