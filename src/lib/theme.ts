import { THEME_IDS, type PosterSize, type ThemeId } from "./types";
import type { MessageKey } from "./i18n";

/**
 * Accent palettes (Nuvio style). The CSS lives in `index.css` under
 * `:root[data-theme="…"]`; this table only feeds the theme picker swatches.
 */
export const THEMES: ReadonlyArray<{ id: ThemeId; accent: string; gradient: string; labelKey: MessageKey }> = [
  { id: "crimson", accent: "#e50914", gradient: "linear-gradient(135deg,#f6121d,#b00710)", labelKey: "themeCrimson" },
  { id: "white", accent: "#f5f5f5", gradient: "linear-gradient(135deg,#ffffff,#b8bec5)", labelKey: "themeWhite" },
  { id: "gold", accent: "#e8a91c", gradient: "linear-gradient(135deg,#8a5700,#e8a91c,#fff1a8,#ffd45c,#9a6200)", labelKey: "themeGold" },
  { id: "jade", accent: "#22d37c", gradient: "linear-gradient(135deg,#7bf08d,#22d37c,#0bbf9a)", labelKey: "themeJade" },
  { id: "rose_gold", accent: "#e8b4a0", gradient: "linear-gradient(135deg,#b76e5a,#e8b4a0,#f7dccf,#e8b4a0,#b76e5a)", labelKey: "themeRoseGold" },
  { id: "arctic", accent: "#3185f5", gradient: "linear-gradient(135deg,#4de3ff,#3185f5,#4d55e8)", labelKey: "themeArctic" },
  { id: "graphite", accent: "#9aa3ad", gradient: "linear-gradient(135deg,#c9d1d9,#9aa3ad,#6b7480)", labelKey: "themeGraphite" },
  { id: "ocean", accent: "#1e88e5", gradient: "linear-gradient(135deg,#64b5f6,#1e88e5,#0d47a1)", labelKey: "themeOcean" },
  { id: "violet", accent: "#a044c4", gradient: "linear-gradient(135deg,#ce93d8,#8e24aa,#4a148c)", labelKey: "themeViolet" },
  { id: "emerald", accent: "#34c759", gradient: "linear-gradient(135deg,#7ee29a,#34c759,#1b8f3f)", labelKey: "themeEmerald" },
  { id: "amber", accent: "#ffb300", gradient: "linear-gradient(135deg,#ffe082,#ffb300,#ff8f00)", labelKey: "themeAmber" },
  { id: "rose", accent: "#ec407a", gradient: "linear-gradient(135deg,#f8bbd0,#ec407a,#ad1457)", labelKey: "themeRose" },
];

export type ThemePrefs = { theme: ThemeId; amoled: boolean; posterSize: PosterSize };

const CACHE_KEY = "ejflix.theme";
const DEFAULT_PREFS: ThemePrefs = { theme: "crimson", amoled: false, posterSize: "medium" };

function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

/** Last applied theme, cached so the first paint is already themed (source of truth is Rust). */
export function readCachedTheme(): ThemePrefs {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_PREFS;
    const p = parsed as Partial<ThemePrefs>;
    return {
      theme: isThemeId(p.theme) ? p.theme : DEFAULT_PREFS.theme,
      amoled: p.amoled === true,
      posterSize: p.posterSize === "small" || p.posterSize === "large" ? p.posterSize : "medium",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Sets `data-theme` / `data-amoled` / `data-poster-size` on `<html>` and caches the choice. */
export function applyTheme(prefs: ThemePrefs): void {
  const root = document.documentElement;
  root.dataset.theme = prefs.theme;
  if (prefs.amoled) root.dataset.amoled = "";
  else delete root.dataset.amoled;
  root.dataset.posterSize = prefs.posterSize;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}
