import type { ThemePreference } from "../domain/types";
import { store } from "../state/store";

/**
 * UI colour theme (Phase 12). The CSS palette is driven by
 * `document.documentElement.dataset.theme`:
 *   - no attribute          → light (the default in tokens.css)
 *   - `data-theme="dark"`   → dark palette
 *
 * "system" preference resolves against `prefers-color-scheme` at apply time
 * AND follows OS changes live (listener while system is selected). The
 * theme-color meta is kept in sync so the browser chrome matches the app.
 * A tiny pre-paint copy of the resolution logic lives inline in index.html
 * (it must run before first paint; it cannot import this module).
 */

export type ResolvedTheme = "light" | "dark";

export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#0f3d33", // app-bar / theme-color light (matches meta default)
  dark: "#0e1513", // dark surface (tokens.css)
};

/** Pure resolution: light/dark win; system follows the OS query. */
export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemDark ? "dark" : "light";
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Applies a resolved theme to the document root + theme-color meta. */
export function applyTheme(preference: ThemePreference): void {
  const resolved = resolveTheme(preference, systemPrefersDark());
  const root = document.documentElement;
  if (resolved === "dark") {
    root.dataset.theme = "dark";
  } else {
    delete root.dataset.theme;
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLORS[resolved];
}

let watched: ThemePreference | null = null;
let removeSystemListener: (() => void) | null = null;

function sync(preference: ThemePreference): void {
  if (preference === watched) return;
  watched = preference;
  removeSystemListener?.();
  removeSystemListener = null;
  applyTheme(preference);
  if (preference === "system") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => applyTheme("system");
    mq.addEventListener("change", onChange);
    removeSystemListener = () => mq.removeEventListener("change", onChange);
  }
}

/**
 * Applies the stored preference now and keeps it applied whenever the store
 * changes (e.g. the تنظیمات control). Returns the store unsubscribe fn.
 */
export function registerThemeSync(): () => void {
  sync(store.get().settings.theme);
  return store.subscribe(() => sync(store.get().settings.theme));
}
