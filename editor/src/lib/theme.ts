export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "soda-editor-theme";
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";
const THEME_COLORS: Record<Theme, string> = { light: "#f4f0e6", dark: "#222520" };
type ThemeStorage = Pick<Storage, "getItem" | "setItem">;
type SystemTheme = (query: string) => { matches: boolean };

function browserStorage(): ThemeStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; }
  catch { return undefined; }
}

export function readThemePreference(storage = browserStorage()): Theme | null {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch { return null; }
}

export function initialTheme(storage = browserStorage(), matchMedia?: SystemTheme): Theme {
  const saved = readThemePreference(storage);
  if (saved) return saved;
  try {
    const system = matchMedia || (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : undefined);
    return system?.(THEME_MEDIA_QUERY).matches ? "dark" : "light";
  } catch { return "light"; }
}

export function saveThemePreference(theme: Theme, storage = browserStorage()): void {
  try { storage?.setItem(THEME_STORAGE_KEY, theme); }
  catch { /* The theme remains usable when browser storage is blocked. */ }
}

export function applyTheme(theme: Theme, targetDocument = typeof document === "undefined" ? undefined : document): void {
  if (!targetDocument) return;
  targetDocument.documentElement.dataset.theme = theme;
  targetDocument.documentElement.style.colorScheme = theme;
  targetDocument.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}
