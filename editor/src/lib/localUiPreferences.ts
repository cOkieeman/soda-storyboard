export function readUiPreference<T>(key: string, fallback: T): T {
  try { const value = JSON.parse(localStorage.getItem(key) || "null"); return value === null ? fallback : value as T; }
  catch { return fallback; }
}
export function saveUiPreference(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Editing remains available when optional preferences cannot be stored. */ }
}
