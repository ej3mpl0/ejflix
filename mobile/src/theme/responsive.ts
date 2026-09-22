import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";
import type { PosterSize } from "../lib/types";
import { useTheme } from "./ThemeProvider";

export type SizeClass = "compact" | "medium" | "expanded";

export type Layout = {
  width: number;
  height: number;
  insets: EdgeInsets;
  sizeClass: SizeClass;
  isTablet: boolean;
  /** ≥ 768 dp: two-pane Settings, LiveTv sidebar, desktop-like rail spacing. */
  wide: boolean;
  landscape: boolean;
  /** Horizontal page padding (desktop `--spacing-page: 48px`). */
  pagePad: number;
  /** Gap between rail items (desktop `--spacing-rail: 14px`). */
  rail: number;
  /** Poster width for the current poster-size preference. */
  posterW: number;
  posterH: number;
  /** Minimum poster width used to compute grid columns. */
  posterMin: number;
  /** Continue-watching / next-up card width (16:9). */
  contW: number;
  /** Episode / chapter thumb width. */
  thumbW: number;
  /** Hero height. */
  heroH: number;
  /** Poster grid: number of columns and item width for the current width. */
  grid: (minWidth?: number) => { cols: number; itemW: number };
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function posterWidth(size: PosterSize, sizeClass: SizeClass, width: number): { w: number; min: number } {
  if (sizeClass === "compact") {
    if (size === "small") return { w: clamp(width * 0.26, 96, 120), min: 96 };
    if (size === "large") return { w: clamp(width * 0.36, 128, 170), min: 128 };
    return { w: clamp(width * 0.3, 108, 140), min: 108 };
  }
  if (sizeClass === "medium") {
    if (size === "small") return { w: clamp(width * 0.145, 120, 150), min: 120 };
    if (size === "large") return { w: clamp(width * 0.2, 160, 220), min: 160 };
    return { w: clamp(width * 0.17, 140, 180), min: 140 };
  }
  if (size === "small") return { w: clamp(width * 0.125, 120, 170), min: 120 };
  if (size === "large") return { w: clamp(width * 0.195, 185, 260), min: 185 };
  return { w: clamp(width * 0.16, 150, 210), min: 150 };
}

export function computeLayout(width: number, height: number, insets: EdgeInsets, posterSize: PosterSize): Layout {
  const sizeClass: SizeClass = width < 600 ? "compact" : width < 840 ? "medium" : "expanded";
  const isTablet = Math.min(width, height) >= 600;
  const wide = width >= 768;
  const landscape = width > height;
  const pagePad = sizeClass === "compact" ? 16 : width >= 1024 ? 48 : 24;
  const rail = sizeClass === "compact" ? 10 : sizeClass === "medium" ? 12 : 14;
  const poster = posterWidth(posterSize, sizeClass, width);
  const posterW = Math.round(poster.w);
  const contW = Math.round(sizeClass === "compact" ? clamp(width * 0.62, 220, 320) : clamp(width * 0.24, 240, 320));
  const thumbW = sizeClass === "compact" ? 128 : wide ? 200 : 168;
  const heroH = Math.round(
    landscape || sizeClass === "expanded" ? Math.max(420, Math.min(0.78 * height, 720)) : Math.min(0.62 * height, 1.25 * width),
  );
  const grid = (minWidth = poster.min) => {
    const usable = width - 2 * pagePad;
    const cols = Math.max(2, Math.floor((usable + rail) / (minWidth + rail)));
    const itemW = Math.floor((usable - (cols - 1) * rail) / cols);
    return { cols, itemW };
  };
  return {
    width,
    height,
    insets,
    sizeClass,
    isTablet,
    wide,
    landscape,
    pagePad,
    rail,
    posterW,
    posterH: Math.round(posterW * 1.5),
    posterMin: poster.min,
    contW,
    thumbW,
    heroH,
    grid,
  };
}

/** Responsive metrics derived from the window size, insets and the poster-size setting. */
export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  return useMemo(
    () => computeLayout(width, height, insets, theme.posterSize),
    [width, height, insets.top, insets.bottom, insets.left, insets.right, theme.posterSize],
  );
}
