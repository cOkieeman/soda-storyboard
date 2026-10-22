import { useRef, useState } from "react";
import { useEditorStore } from "../../lib/store";
import type { SodaText, BubbleStyle } from "../../types";
import ModalShell from "./ModalShell";

export default function DialogueEditor({ onClose }: { onClose: () => void }) {
  const page = useEditorStore(state => state.sodaPage);
  const characters = useEditorStore(state => state.characters);
  const initial = useRef(page);
  const [rows, setRows] = useState(() => (page?.texts || []).map(text => ({ ...text })));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef(false);
  const update = (id: string, patch: Partial<SodaText>) => setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row));
  const changed = rows.filter(row => { const before = initial.current?.texts.find(item => item.id === row.id); return before && ["text", "speaker_id", "bubble"].some(key => row[key] !== before[key]); });
  const save = async () => {
    if (guard.current || !page) return;
    const state = useEditorStore.getState();
    if (state.sodaPage?.id !== initial.current?.id) { setError("当前页面已改变，请关闭后重新打开台词表。"); return; }
    if (changed.some(row => { const original = initial.current?.texts.find(item => item.id === row.id); const latest = state.sodaPage?.texts.find(item => item.id === row.id); return !latest || ["text", "speaker_id", "bubble"].some(key => latest[key] !== original?.[key] && latest[key] !== row[key]); })) { setError("部分台词在外部发生了变化。为保留两边内容，请复制本表修改后关闭并重新载入。"); return; }
    if (changed.some(row => state.isObjectLocked({ kind: "text", id: row.id }))) { setError("修改中包含已锁定的台词，请先解锁后再保存。"); return; }
    guard.current = true; setBusy(true); setError("");
    try {
      state.updateTextsBatch(changed.map(row => ({ id: row.id, patch: { text: row.text, speaker_id: row.speaker_id, bubble: row.bubble } })));
      if (await state.saveCurrentPage(true)) onClose();
      else setError("台词修改已保留在编辑器中，尚未保存成功。关闭本表后处理保存提示，或稍后重试保存。");
    } catch (failure) { setError((failure as Error).message); }
    finally { guard.current = false; setBusy(false); }
  };
  const visible = rows.filter(row => `${row.text} ${row.id}`.toLowerCase().includes(query.toLowerCase()));
  return <ModalShell title="整页台词" description="集中校对文字、说话人和气泡。保存时作为一组修改，可一次撤销。" onClose={onClose} busy={busy} className="max-w-5xl" footer={<><span className="mr-auto text-xs text-[var(--muted)]">{changed.length} 条修改 · {rows.length} 条台词</span><button className="ui-btn" disabled={busy} onClick={onClose}>取消</button><button className="ui-btn ui-btn-primary" disabled={busy || !changed.length} onClick={() => void save()}>{busy ? "正在保存…" : error ? "重试保存" : "保存台词"}</button></>}>
    <div className="space-y-4 p-5"><label className="block"><span className="ui-label">筛选台词</span><input className="ui-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索内容或台词 ID" /></label>{error && <p role="alert" className="text-[var(--error)]">{error}</p>}{!rows.length ? <p className="py-8 text-[var(--muted)]">本页还没有台词。在格子中添加台词后，可在这里集中编辑。</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">整页台词编辑表</caption><thead><tr className="border-b border-[var(--line)] text-left"><th className="p-2">归属</th><th className="p-2">文字</th><th className="p-2">说话人</th><th className="p-2">气泡</th></tr></thead><tbody>{visible.map(row => <tr key={row.id} className="border-b border-[var(--line)] align-top"><th scope="row" className="p-2 text-left font-normal"><span className="block whitespace-nowrap">{row.panel_id ? `格子 ${page?.panels.find(panel => panel.id === row.panel_id)?.order || row.panel_id}` : "页上文字"}</span><code className="text-xs text-[var(--muted)]">{row.id}</code></th><td className="min-w-64 p-2"><textarea rows={3} className="ui-textarea" aria-label={`台词 ${row.id}`} value={row.text} disabled={busy} onChange={event => update(row.id, { text: event.target.value })} /></td><td className="min-w-36 p-2"><select className="ui-select" aria-label={`说话人 ${row.id}`} value={row.speaker_id || ""} disabled={busy} onChange={event => update(row.id, { speaker_id: event.target.value || null })}><option value="">无说话人</option>{characters.map(character => <option key={character.id} value={character.id}>{character.display_name}</option>)}</select></td><td className="min-w-32 p-2"><select className="ui-select" aria-label={`气泡 ${row.id}`} value={row.bubble} disabled={busy} onChange={event => update(row.id, { bubble: event.target.value as BubbleStyle })}>{[["speech", "对话"], ["shout", "喊叫"], ["thought", "思考"], ["box", "方框"], ["none", "无气泡"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td></tr>)}</tbody></table>{!visible.length && <p className="py-6 text-[var(--muted)]">没有匹配的台词。</p>}</div>}</div>
  </ModalShell>;
}
