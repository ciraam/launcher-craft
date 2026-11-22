import type { ThemeMode } from "@/types/launcher";

const THEME_STORAGE_KEY = "craft_ro_theme_pref";

export function readCachedTheme(): ThemeMode {
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === "dark" || val === "light" || val === "system") {
      return val;
    }
  } catch {
    // ignore storage errors
  }
  return "dark";
}

export function writeCachedTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore storage errors
  }
}

export function resolveEffectiveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode === "dark" || mode === "light") return mode;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
}

export function applyThemeToDocument(mode: ThemeMode): "dark" | "light" {
  const effective = resolveEffectiveTheme(mode);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.classList.toggle("dark", effective === "dark");
    root.classList.toggle("light", effective === "light");
    root.style.colorScheme = effective;
  }
  writeCachedTheme(mode);
  return effective;
}
