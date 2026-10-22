import { useRef, useState } from "react";
import { useEditorStore } from "../../lib/store";
import ModalShell from "./ModalShell";

function CompileDialog() {
  const modal = useEditorStore(state => state.compileModal)!;
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const retryGuard = useRef(false);
  const busy = Boolean(modal.loading || retrying);
  const hasResult = !busy && !modal.error && modal.moss !== null && Boolean(modal.path);
  const json = JSON.stringify(modal.moss, null, 2);
  const copy = async () => { try { await navigator.clipboard.writeText(json); setCopied(true); setError(""); } catch { setError("剪贴板不可用，请下载文件，或在下方选中 JSON 手动复制。"); } };
  const close = () => useEditorStore.getState().closeCompileModal();
  const retry = async () => {
    if (retryGuard.current || busy) return;
    retryGuard.current = true; setRetrying(true); setError(""); setCopied(false);
    try { await useEditorStore.getState().openCompileModal(); }
    catch (failure) { setError((failure as Error).message || "编译失败，请重试。"); }
    finally { retryGuard.current = false; setRetrying(false); }
  };
  return <ModalShell title="导出 MOSS 布局" description="供图像生成引擎使用。若要保留人物姿势等编辑信息，请使用“导出分镜源文件”。" onClose={close} busy={busy} className="max-w-4xl" footer={<>{hasResult && <button className="ui-btn" onClick={() => void copy()}>{copied ? "已复制" : "复制 MOSS JSON"}</button>}<button className="ui-btn" disabled={busy} onClick={close}>关闭</button></>}>
    <div className="space-y-4 p-5">
      {busy ? <p role="status" className="py-12 text-center text-[var(--muted)]">正在保存分镜并编译 MOSS 布局…</p> : modal.error || !hasResult ? <div className="space-y-4 py-6"><p role="alert" className="text-[var(--error)]">{modal.error || error || "没有获得编译结果，请重试。"}</p><p className="text-sm text-[var(--muted)]">当前编辑会保留。修正保存提示或恢复连接后，可以重新编译。</p><button className="ui-btn" disabled={busy} onClick={() => void retry()}>重试编译</button></div> : <><div className="flex flex-wrap gap-2">{[...new Set(modal.paths?.length ? modal.paths : [modal.path])].filter(Boolean).map(file => <a key={file} className="ui-btn" href={`/api/files/${encodeURIComponent(file)}`} download>下载 {file.split(/[\\/]/).pop()}</a>)}</div>{error && <p role="alert" className="text-[var(--error)]">{error}</p>}<pre tabIndex={0} aria-label="MOSS 布局 JSON" className="max-h-[52dvh] overflow-auto border border-[var(--line)] bg-[var(--control-surface)] p-4 text-xs">{json}</pre><p className="break-all text-xs text-[var(--muted)]">项目内文件：{modal.path}</p></>}
    </div>
  </ModalShell>;
}
export default function CompileModal() { return useEditorStore(state => state.compileModal?.open) ? <CompileDialog /> : null; }
