import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { applyTheme, initialTheme, readThemePreference, saveThemePreference, THEME_MEDIA_QUERY, THEME_STORAGE_KEY } from "../lib/theme";

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useTheme() {
  const [theme, setTheme] = useState(initialTheme);

  useBrowserLayoutEffect(() => { applyTheme(theme); }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const system = typeof window.matchMedia === "function" ? window.matchMedia(THEME_MEDIA_QUERY) : null;
    const followSystem = () => { if (!readThemePreference()) setTheme(initialTheme()); };
    const syncOtherTab = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) setTheme(initialTheme());
    };
    system?.addEventListener("change", followSystem);
    window.addEventListener("storage", syncOtherTab);
    return () => {
      system?.removeEventListener("change", followSystem);
      window.removeEventListener("storage", syncOtherTab);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    saveThemePreference(next);
    applyTheme(next);
    setTheme(next);
  }, [theme]);

  return { theme, toggleTheme };
}
