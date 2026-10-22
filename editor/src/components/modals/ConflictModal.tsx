import { useRef, useState } from "react";
import { useEditorStore } from "../../lib/store";
import ModalShell from "./ModalShell";

function ConflictDialog() {
  const conflict = useEditorStore(state => state.conflictModal)!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const guard = useRef(false);
  const close = () => useEditorStore.getState().closeConflictModal();
  const copy = async () => { try { await navigator.clipboard.writeText(conflict.localBackup || ""); setCopied(true); } catch { setError("无法自动复制，请在下方选中并复制本地草稿。"); } };
  const load = async () => { if (guard.current) return; guard.current = true; setBusy(true); try { if (!(await useEditorStore.getState().resolveConflictLoadLatest())) setError("最新版本未能载入。本地草稿仍然保留，请检查连接后重试。"); } catch (failure) { setError((failure as Error).message); } finally { guard.current = false; setBusy(false); } };
  return <ModalShell title="页面已被外部修改" description={conflict.reason === "production_running" ? "后台任务正在使用这一页。保留本地草稿，等待任务结束后再保存。" : "本次保存已停止。你可以保留本地修改，或确认后载入外部版本。"} onClose={close} busy={busy} footer={<><button className="ui-btn" disabled={busy} onClick={close}>保留本地修改并暂存</button><button className="ui-btn" disabled={busy || conflict.reason === "production_running"} onClick={() => void load()}>{busy ? "正在载入…" : "载入最新版本（替换当前编辑）"}</button></>}><div className="space-y-3 p-5"><div className="flex items-center justify-between gap-3"><label htmlFor="conflict-backup" className="ui-label">本地草稿备份</label><button className="ui-btn ui-btn-sm" onClick={() => void copy()}>{copied ? "已复制草稿" : "复制草稿 JSON"}</button></div><textarea id="conflict-backup" readOnly rows={9} value={conflict.localBackup || ""} className="ui-textarea numeric" /><p className="text-xs text-[var(--muted)]">关闭此窗口会保留当前编辑。载入外部版本前，建议先复制草稿。</p>{error && <p role="alert" className="text-[var(--error)]">{error}</p>}</div></ModalShell>;
}
export default function ConflictModal() { return useEditorStore(state => state.conflictModal?.open) ? <ConflictDialog /> : null; }
