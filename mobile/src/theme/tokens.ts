import { THEME_IDS, type PosterSize, type ThemeId } from "../lib/types";
import type { MessageKey } from "../lib/i18n";
import { alpha, mix } from "./color";

/**
 * Design tokens ported from `src/index.css` (`@theme` block + the twelve
 * `:root[data-theme]` palettes + `[data-amoled]`). One memoised object per
 * (theme, amoled) pair; components read it through `useTheme()`.
 */

export type BrandGradient = { angle: number; stops: string[] };

type Palette = {
  accent: string;
  onAccent: string;
  base?: string;
  surface?: string;
  panel?: string;
  hover?: string;
  press?: string;
  brand: BrandGradient;
};

const BASE = { base: "#0d0d0d", surface: "#1a1a1a", panel: "#242424", line: "#252a2a" };

/** Values copied from `index.css` lines 63–151. */
export const THEME_PALETTES: Record<ThemeId, Palette> = {
  crimson: {
    accent: "#e50914",
    onAccent: "#ffffff",
    hover: "#f6121d",
    press: "#b00710",
    brand: { angle: 180, stops: ["#f6121d", "#b00710"] },
  },
  white: { accent: "#f5f5f5", onAccent: "#0d0d0d", brand: { angle: 180, stops: ["#ffffff", "#b8bec5"] } },
  gold: {
    accent: "#e8a91c",
    onAccent: "#0d0d0d",
    base: "#0f0e0b",
    surface: "#1b1913",
    panel: "#252217",
    brand: { angle: 90, stops: ["#8a5700", "#e8a91c", "#fff1a8", "#ffd45c", "#9a6200"] },
  },
  jade: {
    accent: "#22d37c",
    onAccent: "#0d0d0d",
    base: "#0b100d",
    surface: "#151c17",
    panel: "#1e2620",
    brand: { angle: 90, stops: ["#7bf08d", "#22d37c", "#0bbf9a"] },
  },
  rose_gold: {
    accent: "#e8b4a0",
    onAccent: "#0d0d0d",
    base: "#100d0c",
    surface: "#1c1715",
    panel: "#26201d",
    brand: { angle: 90, stops: ["#b76e5a", "#e8b4a0", "#f7dccf", "#e8b4a0", "#b76e5a"] },
  },
  arctic: {
    accent: "#3185f5",
    onAccent: "#ffffff",
    base: "#0b0e14",
    surface: "#151a22",
    panel: "#1e242e",
    brand: { angle: 90, stops: ["#4de3ff", "#3185f5", "#4d55e8"] },
  },
  graphite: { accent: "#9aa3ad", onAccent: "#0d0d0d", brand: { angle: 90, stops: ["#c9d1d9", "#9aa3ad", "#6b7480"] } },
  ocean: {
    accent: "#1e88e5",
    onAccent: "#ffffff",
    base: "#0b0f14",
    surface: "#151b22",
    panel: "#1e262e",
    brand: { angle: 90, stops: ["#64b5f6", "#1e88e5", "#0d47a1"] },
  },
  violet: {
    accent: "#a044c4",
    onAccent: "#ffffff",
    base: "#0f0b12",
    surface: "#1a151e",
    panel: "#241d29",
    brand: { angle: 90, stops: ["#ce93d8", "#8e24aa", "#4a148c"] },
  },
  emerald: {
    accent: "#34c759",
    onAccent: "#0d0d0d",
    base: "#0b100c",
    surface: "#151c16",
    panel: "#1e261f",
    brand: { angle: 90, stops: ["#7ee29a", "#34c759", "#1b8f3f"] },
  },
  amber: {
    accent: "#ffb300",
    onAccent: "#0d0d0d",
    base: "#100e0a",
    surface: "#1c1913",
    panel: "#262218",
    brand: { angle: 90, stops: ["#ffe082", "#ffb300", "#ff8f00"] },
  },
  rose: {
    accent: "#ec407a",
    onAccent: "#ffffff",
    base: "#120c0f",
    surface: "#1e1519",
    panel: "#281d22",
    brand: { angle: 90, stops: ["#f8bbd0", "#ec407a", "#ad1457"] },
  },
};

/** Swatch table for the theme picker (was `src/lib/theme.ts`). */
export const THEMES: ReadonlyArray<{ id: ThemeId; accent: string; stops: string[]; labelKey: MessageKey }> = [
  { id: "crimson", accent: "#e50914", stops: ["#f6121d", "#b00710"], labelKey: "themeCrimson" },
  { id: "white", accent: "#f5f5f5", stops: ["#ffffff", "#b8bec5"], labelKey: "themeWhite" },
  { id: "gold", accent: "#e8a91c", stops: ["#8a5700", "#e8a91c", "#fff1a8", "#ffd45c", "#9a6200"], labelKey: "themeGold" },
  { id: "jade", accent: "#22d37c", stops: ["#7bf08d", "#22d37c", "#0bbf9a"], labelKey: "themeJade" },
  { id: "rose_gold", accent: "#e8b4a0", stops: ["#b76e5a", "#e8b4a0", "#f7dccf", "#e8b4a0", "#b76e5a"], labelKey: "themeRoseGold" },
  { id: "arctic", accent: "#3185f5", stops: ["#4de3ff", "#3185f5", "#4d55e8"], labelKey: "themeArctic" },
  { id: "graphite", accent: "#9aa3ad", stops: ["#c9d1d9", "#9aa3ad", "#6b7480"], labelKey: "themeGraphite" },
  { id: "ocean", accent: "#1e88e5", stops: ["#64b5f6", "#1e88e5", "#0d47a1"], labelKey: "themeOcean" },
  { id: "violet", accent: "#a044c4", stops: ["#ce93d8", "#8e24aa", "#4a148c"], labelKey: "themeViolet" },
  { id: "emerald", accent: "#34c759", stops: ["#7ee29a", "#34c759", "#1b8f3f"], labelKey: "themeEmerald" },
  { id: "amber", accent: "#ffb300", stops: ["#ffe082", "#ffb300", "#ff8f00"], labelKey: "themeAmber" },
  { id: "rose", accent: "#ec407a", stops: ["#f8bbd0", "#ec407a", "#ad1457"], labelKey: "themeRose" },
];

export type ThemeColors = {
  base: string;
  surface: string;
  panel: string;
  line: string;
  text: string;
  muted: string;
  dim: string;
  accent: string;
  onAccent: string;
  accentHover: string;
  accentPress: string;
  accentSoft: string;
  star: string;
  success: string;
  warning: string;
  brand: BrandGradient;
};

export type Theme = {
  id: ThemeId;
  amoled: boolean;
  posterSize: PosterSize;
  colors: ThemeColors;
  radii: { poster: number; card: number; btn: number; pill: number; hero: number };
  spacing: { section: number; rail: number };
  fonts: { regular: string; medium: string; semibold: string; bold: string; extrabold: string; brand: string };
  durations: { fast: number; normal: number; sheet: number; slow: number; cinematic: number };
  opacity: { disabled: number; secondary: number; muted: number; selected: number; scrim: number };
  /** rgba(255,255,255,a) — the ubiquitous `bg-white/6`, `bg-white/10`… */
  white: (a: number) => string;
  black: (a: number) => string;
  /** 1px inner outline used on images and cards (`.img-outline`). */
  outline: string;
};

export const FONTS = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  extrabold: "Inter_800ExtraBold",
  brand: "BebasNeue_400Regular",
} as const;

export type ThemePrefs = { theme: ThemeId; amoled: boolean; posterSize: PosterSize };

export const DEFAULT_THEME_PREFS: ThemePrefs = { theme: "crimson", amoled: false, posterSize: "medium" };

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

const cache = new Map<string, Theme>();

export function buildTheme(prefs: ThemePrefs): Theme {
  const key = `${prefs.theme}|${prefs.amoled ? 1 : 0}|${prefs.posterSize}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const palette = THEME_PALETTES[prefs.theme] ?? THEME_PALETTES.crimson;
  const accent = palette.accent;
  const colors: ThemeColors = {
    base: prefs.amoled ? "#000000" : palette.base ?? BASE.base,
    surface: prefs.amoled ? "#0a0a0a" : palette.surface ?? BASE.surface,
    panel: prefs.amoled ? "#121212" : palette.panel ?? BASE.panel,
    line: BASE.line,
    text: "#f5f7f8",
    muted: "#b8bec5",
    dim: "#969ca3",
    accent,
    onAccent: palette.onAccent,
    accentHover: palette.hover ?? mix(accent, "#ffffff", 0.12),
    accentPress: palette.press ?? mix(accent, "#000000", 0.2),
    accentSoft: alpha(accent, 0.15),
    star: "#ffd45c",
    success: "#66bb6a",
    warning: "#ffc857",
    brand: palette.brand,
  };
  const theme: Theme = {
    id: prefs.theme,
    amoled: prefs.amoled,
    posterSize: prefs.posterSize,
    colors,
    radii: { poster: 12, card: 24, btn: 16, pill: 40, hero: 28 },
    spacing: { section: 24, rail: 14 },
    fonts: FONTS,
    durations: { fast: 150, normal: 220, sheet: 300, slow: 400, cinematic: 700 },
    opacity: { disabled: 0.38, secondary: 0.7, muted: 0.6, selected: 0.15, scrim: 0.56 },
    white: (a: number) => `rgba(255, 255, 255, ${a})`,
    black: (a: number) => `rgba(0, 0, 0, ${a})`,
    outline: "rgba(255, 255, 255, 0.1)",
  };
  cache.set(key, theme);
  return theme;
}

export const DEFAULT_THEME = buildTheme(DEFAULT_THEME_PREFS);
