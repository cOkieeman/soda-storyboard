import React, { useEffect, useRef, useState } from "react";
import { ApiError, type IdentityOptions, type IdentityPlan } from "../lib/api";
import { applyIdentity, prepareIdentity, refreshIdentityHistory, undoIdentity, useIdentityState } from "../lib/characterIdentity";
import { useEditorStore } from "../lib/store";
import type { CharacterDraft } from "../lib/characterDrafts";
import { useCharacterDraftStore } from "../lib/characterDrafts";

export function CharacterOperationUndo() {
  const { busy, last, error } = useIdentityState();
  useEffect(() => { void refreshIdentityHistory().catch(() => {}); }, []);
  return <div className="px-3 py-2 text-[12px]" role="status"><button className="ui-btn ui-btn-sm" disabled={!last || busy} onClick={() => void undoIdentity()}>撤销上次角色操作</button>{error && <p className="mt-2 text-[var(--error)]" role="alert">{error}</p>}</div>;
}

export default function CharacterIdentityDialog({ draft, action, close }: { draft: CharacterDraft; action: IdentityOptions["action"]; close: () => void }) {
  const characters = useEditorStore(state => state.characters);
  const [options, setOptions] = useState<IdentityOptions>({ action, display_name: draft.value.display_name || draft.value.name, new_id: "", mode: "block", replacement_id: characters.find(character => character.id !== draft.value.id)?.id, preserve_lora: false });
  const [plan, setPlan] = useState<IdentityPlan | null>(null);
  const [references, setReferences] = useState<IdentityPlan["references"]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const title = action === "rename" ? "改名（只改显示名）" : action === "rename_id" ? "更改角色 ID" : "删除角色";
  const change = (patch: Partial<IdentityOptions>) => { setOptions(value => ({ ...value, ...patch })); setPlan(null); setError(""); };
  useEffect(() => {
    const store = useCharacterDraftStore;
    store.setState(state => ({ drafts: { ...state.drafts, [draft.key]: { ...state.drafts[draft.key], identityEditing: true } } }));
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>("input,button")?.focus();
    return () => {
      const latest = store.getState().drafts[draft.key];
      if (latest) {
        store.setState(state => ({ drafts: { ...state.drafts, [draft.key]: { ...state.drafts[draft.key], identityEditing: false } } }));
        if (latest.externalChanged && !latest.dirty && !latest.saving) void store.getState().reload(draft.key);
      }
      previous?.focus();
    };
  }, []);
  const preview = async () => {
    setBusy(true); setError(""); setPlan(null);
    try { const result = await prepareIdentity(draft.value.id, draft.version, options); setPlan(result); setReferences(result.references); }
    catch (error) { setError((error as Error).message); if (error instanceof ApiError) setReferences(error.data?.references || []); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!plan) return;
    setBusy(true); setError("");
    try { await applyIdentity(draft.value.id, draft.version, plan); close(); }
    catch (error) { setError((error as Error).message); setPlan(null); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onKeyDown={event => {
    event.stopPropagation();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") event.preventDefault();
    if (event.key === "Escape" && !busy) close();
    if (event.key === "Tab") { const items = root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)'); if (!items?.length) return; const first = items[0], last = items[items.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
  }}>
    <div ref={root} role="dialog" aria-modal="true" aria-labelledby="identity-title" className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--paper)] p-6 shadow-xl text-[var(--ink)]">
      <h2 id="identity-title" className="text-lg font-semibold">{title} · {draft.value.display_name || draft.value.name}</h2>
      <p className="my-3 text-sm">原 ID：{draft.value.id}。操作影响整个项目，可作为一个整体撤销。</p>
      <fieldset disabled={busy} className="space-y-3 text-sm">
        {action === "rename" && <><label className="block">新显示名<input aria-label="新显示名" className="ui-input mt-1 w-full" value={options.display_name || ""} onChange={event => change({ display_name: event.target.value })} /></label><p>ID、外观正文和对白内容保持原样。</p>{characters.some(character => character.id !== draft.value.id && character.display_name === options.display_name) && <p className="ui-notice-box">已有同名角色，请结合 ID 区分。</p>}</>}
        {action === "rename_id" && <><label className="block">新角色 ID<input aria-label="新角色 ID" className="ui-input mt-1 w-full" value={options.new_id} onChange={event => change({ new_id: event.target.value })} /></label><p>以小写字母开头，最多 64 位，可含数字、下划线和短横线。将同步页面、分镜包和翻译清单引用。</p><label className="flex gap-2"><input type="checkbox" checked={options.preserve_lora} onChange={event => change({ preserve_lora: event.target.checked })} />固定原先选中的 LoRA（避免自动排序改变）</label></>}
        {action === "delete" && <div className="space-y-3 rounded border border-[var(--line)] p-3">
          <label className="flex gap-2"><input type="radio" name="delete-mode" checked={options.mode === "block"} onChange={() => change({ mode: "block" })} />阻止删除（被引用时保留角色）</label>
          <label className="flex gap-2"><input type="radio" name="delete-mode" checked={options.mode === "replace"} onChange={() => change({ mode: "replace" })} />替换成另一个角色</label>
          {options.mode === "replace" && <select aria-label="替换角色" className="ui-input w-full" value={options.replacement_id || ""} onChange={event => change({ replacement_id: event.target.value })}><option value="">请选择</option>{characters.filter(character => character.id !== draft.value.id).map(character => <option key={character.id} value={character.id}>{character.display_name} · {character.id}</option>)}</select>}
          <label className="flex gap-2"><input type="radio" name="delete-mode" checked={options.mode === "anonymous"} onChange={() => change({ mode: "anonymous" })} />转成无名人物</label>
          {options.mode === "anonymous" && <p>保留每个人物的外观快照、姿势和位置；解除说话人绑定，相关页面禁用指定角色 LoRA。</p>}
        </div>}
        <button className="ui-btn" onClick={() => void preview()}>检查影响范围</button>
        {references.length > 0 && <div><h3 className="font-semibold">引用位置（{references.length}）</h3><ul className="mt-2 max-h-40 overflow-auto text-xs space-y-1">{references.map((reference, index) => <li key={index}>{reference.path} · {reference.kind} · {reference.pointer}</li>)}</ul></div>}
        {plan && <div className="ui-notice-box space-y-2"><p>将修改 {plan.affected_files.length} 个文件：</p><ul className="text-xs">{plan.affected_files.map(path => <li key={path}>{path}</li>)}</ul>{plan.lora_changes.map(item => <p key={item.path}>LoRA · {item.path}：{item.before?.character_id || "不使用"} → {item.after?.character_id || "不使用"}</p>)}{plan.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
      </fieldset>
      {error && <p className="my-3 text-sm text-[var(--error)]" role="alert">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><button className="ui-btn" disabled={busy} onClick={close}>取消</button><button className="ui-btn ui-btn-primary" disabled={busy || !plan} onClick={() => void submit()}>{busy ? "处理中…" : action === "delete" ? "确认删除并更新引用" : "确认更改"}</button></div>
    </div>
  </div>;
}
