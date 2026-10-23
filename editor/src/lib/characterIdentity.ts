import { create } from "zustand";
import { characterOperationHistory, commitCharacterIdentity, planCharacterIdentity, undoCharacterOperation, type IdentityOptions, type IdentityPlan, type IdentityResult } from "./api";
import { useEditorStore } from "./store";
import { useCharacterDraftStore } from "./characterDrafts";

export const useIdentityState = create<{ busy: boolean; last: (IdentityResult & { version: string }) | null; error: string }>(() => ({ busy: false, last: null, error: "" }));
const seen = new Set<string>();
const pending = new Map<string, Promise<void>>();
export async function refreshIdentityHistory() {
  const history = await characterOperationHistory();
  useIdentityState.setState({ last: history[history.length - 1] || null });
}
export async function drainIdentityPage() {
  const state = useEditorStore.getState();
  if ((state.hasUnsavedChanges || state.savePromise) && !await state.saveCurrentPage()) throw new Error("当前页未能保存，请先处理页面冲突。");
  if (useEditorStore.getState().hasUnsavedChanges) throw new Error("页面仍有未保存修改，请重试。");
}
export function resetIdentityHistory() {
  useEditorStore.setState({ historyPast: [], historyFuture: [], canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, historyGroup: null, clipboard: null });
}
export function acceptIdentityResult(result: IdentityResult): Promise<void> {
  if (seen.has(result.operation_id)) return Promise.resolve();
  const running = pending.get(result.operation_id);
  if (running) return running;
  const promise = refreshIdentityResult(result).then(() => { seen.add(result.operation_id); }).finally(() => pending.delete(result.operation_id));
  pending.set(result.operation_id, promise);
  return promise;
}
async function refreshIdentityResult(_result: IdentityResult) {
  resetIdentityHistory();
  const editor = useEditorStore.getState();
  if (!editor.hasUnsavedChanges && !editor.savePromise) await editor.reloadCurrentPage();
  else editor.setNotice("角色引用已在外部更新。本地草稿保留，保存时须核对最新角色。");
  const drafts = { ...useCharacterDraftStore.getState().drafts };
  for (const [key, draft] of Object.entries(drafts)) {
    if (!draft.dirty && !draft.saving && !draft.identityEditing) delete drafts[key];
  }
  useCharacterDraftStore.setState({ drafts });
  await useEditorStore.getState().refreshCharacters();
  await refreshIdentityHistory();
}
export async function prepareIdentity(id: string, version: string, options: IdentityOptions) {
  await drainIdentityPage();
  return planCharacterIdentity(id, options, version);
}
export async function applyIdentity(id: string, version: string, plan: IdentityPlan) {
  useIdentityState.setState({ busy: true, error: "" });
  try {
    await drainIdentityPage();
    const result = await commitCharacterIdentity(id, plan.plan_id, version);
    // Keep the response usable even when SSE has already delivered this operation.
    let refreshed = true;
    try { await acceptIdentityResult(result); }
    catch { refreshed = false; }
    useCharacterDraftStore.getState().showCanvas();
    useEditorStore.getState().setNotice(refreshed ? "角色操作已完成；旧页面撤销和复制缓存已清空，可整笔撤销角色操作。" : "角色操作已提交，但页面刷新失败，请重新载入编辑器后核对。");
  } finally { useIdentityState.setState({ busy: false }); }
}
export async function undoIdentity() {
  const last = useIdentityState.getState().last;
  if (!last || useIdentityState.getState().busy) return;
  useIdentityState.setState({ busy: true, error: "" });
  try {
    await drainIdentityPage();
    const result = await undoCharacterOperation(last.operation_id, last.version);
    await acceptIdentityResult(result);
    useCharacterDraftStore.getState().showCanvas();
    useEditorStore.getState().setNotice("已整笔撤销角色操作。");
  } catch (error) { useIdentityState.setState({ error: (error as Error).message }); }
  finally { useIdentityState.setState({ busy: false }); }
}
