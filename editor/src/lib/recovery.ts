import type { ObjectFlags, RecoveryDraft } from "../types";
type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
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
export function readRecoveryDraft(project: string, pageId: string, target = storage()): RecoveryDraft | null {
  if (!project) return null;
  try {
    const raw = target?.getItem(key(project, pageId, "pending")) || target?.getItem(key(project, pageId, "draft"));
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value?.format === "soda-editor-recovery-v1" && value.projectIdentity === project && value.pageId === pageId
      && typeof value.baseVersion === "string" && typeof value.savedAt === "number" && value.page?.id === pageId
      && Array.isArray(value.page.panels) && Array.isArray(value.page.texts) ? value : null;
  } catch { return null; }
}
export function writeRecoveryDraft(draft: RecoveryDraft, pending?: RecoveryDraft | null, target = storage()): boolean {
  if (!draft.projectIdentity || !target) return false;
  try {
    if (pending) target.setItem(key(draft.projectIdentity, draft.pageId, "pending"), JSON.stringify(pending));
    target.setItem(key(draft.projectIdentity, draft.pageId, "draft"), JSON.stringify(draft)); return true;
  } catch { return false; }
}
export function clearRecoveryDraft(project: string, pageId: string, all = false, target = storage()): void {
  try { target?.removeItem(key(project, pageId, "draft")); if (all) target?.removeItem(key(project, pageId, "pending")); } catch { /* Storage can be blocked independently of editor saving. */ }
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
