import type { ObjectFlags, RecoveryDraft } from "../types";
import { v4 as uuidv4 } from "uuid";
type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> & Partial<Pick<Storage, "length" | "key">>;
// A document gets a fresh owner even when a duplicated tab copies sessionStorage.
// Drafts stay in localStorage so a new document can recover after a crash or reload.
const recoveryClientId = uuidv4();
function storage(): BrowserStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}
function key(project: string, pageId: string, kind: string): string {
  return "soda-editor-v1:" + encodeURIComponent(project) + ":" + encodeURIComponent(pageId) + ":" + kind;
}
export async function discoverProjectIdentity(): Promise<string> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch("/api/health", { signal: controller.signal });
    if (!response.ok) return "";
    const health = await response.json();
    if (typeof health.project_dir !== "string" || !health.project_dir) return "";
    const path = health.project_dir.replace(/\\/g, "/").replace(/\/+$/, "");
    return "directory:" + (/^[a-z]:\//i.test(path) ? path.toLowerCase() : path);
  } catch { return ""; } finally { clearTimeout(timer); }
}
function parseDraft(raw: string | null | undefined, project: string, pageId: string): RecoveryDraft | null {
  try {
    const value = JSON.parse(raw || "null");
    return value?.format === "soda-editor-recovery-v1" && value.projectIdentity === project && value.pageId === pageId
      && typeof value.baseVersion === "string" && Number.isFinite(value.savedAt) && value.page?.id === pageId
      && Array.isArray(value.page.panels) && Array.isArray(value.page.texts) ? value : null;
  } catch { return null; }
}
export function readRecoveryDraft(project: string, pageId: string, target = storage(), clientId = recoveryClientId): RecoveryDraft | null {
  if (!project) return null;
  try {
    const prefixes = { pending: key(project, pageId, "pending"), draft: key(project, pageId, "draft") };
    const own = parseDraft(target?.getItem(prefixes.pending + ":" + clientId), project, pageId)
      || parseDraft(target?.getItem(prefixes.draft + ":" + clientId), project, pageId);
    if (own) return own;
    const owners = new Map<string, { pending?: RecoveryDraft; draft?: RecoveryDraft }>();
    // Legacy shared keys are a separate owner. Reading never takes or deletes them.
    const keys = [prefixes.pending, prefixes.draft];
    for (let index = 0; index < (target?.length || 0); index++) {
      const name = target?.key?.(index);
      if (name) keys.push(name);
    }
    for (const name of keys) {
      for (const kind of ["pending", "draft"] as const) {
        const prefix = prefixes[kind];
        if (name !== prefix && !name.startsWith(prefix + ":")) continue;
        const value = parseDraft(target?.getItem(name), project, pageId);
        if (!value) continue;
        const owner = name.slice(prefix.length), drafts = owners.get(owner) || {};
        drafts[kind] = value;
        owners.set(owner, drafts);
      }
    }
    return [...owners.values()].map(drafts => drafts.pending || drafts.draft!)
      .sort((a, b) => b.savedAt - a.savedAt)[0] || null;
  } catch { return null; }
}
export function writeRecoveryDraft(draft: RecoveryDraft, pending?: RecoveryDraft | null, target = storage(), clientId = recoveryClientId): boolean {
  if (!draft.projectIdentity || !target) return false;
  try {
    if (pending) target.setItem(key(draft.projectIdentity, draft.pageId, "pending") + ":" + clientId, JSON.stringify(pending));
    target.setItem(key(draft.projectIdentity, draft.pageId, "draft") + ":" + clientId, JSON.stringify(draft)); return true;
  } catch { return false; }
}
export function clearRecoveryDraft(project: string, pageId: string, all = false, target = storage(), clientId = recoveryClientId): void {
  try {
    target?.removeItem(key(project, pageId, "draft") + ":" + clientId);
    if (all) target?.removeItem(key(project, pageId, "pending") + ":" + clientId);
  } catch { /* Storage can be blocked independently of editor saving. */ }
}
export function readObjectFlags(project: string, pageId: string, target = storage()): Record<string, ObjectFlags> {
  if (!project) return {};
  try {
    const value = JSON.parse(target?.getItem(key(project, pageId, "flags")) || "{}");
    return Object.fromEntries(Object.entries(value).filter(([name, flag]) => /^(panel|text|figure|overlay):/.test(name) && !!flag && typeof flag === "object")
      .map(([name, flag]) => [name, { locked: (flag as ObjectFlags).locked === true, hidden: (flag as ObjectFlags).hidden === true }]));
  } catch { return {}; }
}
export function writeObjectFlags(project: string, pageId: string, flags: Record<string, ObjectFlags>, target = storage()): boolean {
  if (!project || !target) return false;
  try { target.setItem(key(project, pageId, "flags"), JSON.stringify(flags)); return true; } catch { return false; }
}
