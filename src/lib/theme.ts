import type { PosterSize } from "./types";

/**
 * Appearance switches that live on `<html>`. ejFlix has one identity (white actions, a red
 * dot for what is alive), so there is no accent palette any more: the saved `theme` field is
 * ignored.
 */
export type ThemePrefs = { amoled: boolean; posterSize: PosterSize };

const CACHE_KEY = "ejflix.theme";
const DEFAULT_PREFS: ThemePrefs = { amoled: false, posterSize: "medium" };

/** Last applied prefs, cached so the first paint already has them (source of truth is Rust). */
export function readCachedTheme(): ThemePrefs {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_PREFS;
    const p = parsed as Partial<ThemePrefs>;
    return {
      amoled: p.amoled === true,
      posterSize: p.posterSize === "small" || p.posterSize === "large" ? p.posterSize : "medium",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Sets `data-amoled` / `data-poster-size` on `<html>` and caches the choice. */
export function applyTheme(prefs: ThemePrefs): void {
  const root = document.documentElement;
  delete root.dataset.theme;
  if (prefs.amoled) root.dataset.amoled = "";
  else delete root.dataset.amoled;
  root.dataset.posterSize = prefs.posterSize;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}
