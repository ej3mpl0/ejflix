/**
 * Look of the subtitles the app draws itself, shared by the player overlay and the live
 * preview in Settings › Playback. Pure (vitest-friendly): plain style objects only.
 */
import type { SubBackground, SubPosition } from "./types";

export type SubtitleLook = {
  scale: number;
  color: string;
  background: SubBackground;
};

export type SubtitleTextStyle = {
  color: string;
  fontSize: number;
  lineHeight: number;
  backgroundColor: string;
  textShadowRadius: number;
  textShadowOffset: { width: number; height: number };
};

/** Text style for a given base font size (22 in the player, smaller in the preview). */
export function subtitleTextStyle(look: SubtitleLook, baseSize: number): SubtitleTextStyle {
  const box = look.background === "box";
  const fontSize = Math.round(baseSize * look.scale);
  return {
    color: look.color,
    fontSize,
    lineHeight: Math.round(fontSize * 1.32),
    backgroundColor: box ? "rgba(0,0,0,0.7)" : "transparent",
    textShadowRadius: box ? 0 : look.background === "shadow" ? 6 : 3,
    textShadowOffset: look.background === "shadow" ? { width: 2, height: 2 } : { width: 0, height: 0 },
  };
}

/** Share of the frame height the "raised" position lifts the lines by. */
export const RAISED_FRACTION = 0.14;

/**
 * Where the lines sit: `{ bottom }` or `{ top }` in dp. `base` is the normal distance
 * from the bottom (it grows while the controls are on screen); `top` keeps clear of the
 * title bar with `topInset`.
 */
export function subtitlePlacement(
  position: SubPosition,
  frameHeight: number,
  base: number,
  topInset: number,
): { bottom: number } | { top: number } {
  if (position === "top") return { top: Math.round(topInset) };
  if (position === "raised") return { bottom: Math.round(Math.max(base, frameHeight * RAISED_FRACTION + base * 0.5)) };
  return { bottom: Math.round(base) };
}
