/**
 * Aspect-ratio override of the video surface (pure helpers, no React Native imports).
 *
 * mpv on the desktop applied `video-aspect-override` / `panscan`; with expo-video the
 * same modes are expressed as the size of the `<VideoView>` box plus its `contentFit`.
 */

export const ASPECT_MODES = ["auto", "16:9", "4:3", "2.35:1", "fill"] as const;
export type AspectMode = (typeof ASPECT_MODES)[number];

export type ContentFit = "contain" | "cover" | "fill";

export type AspectBox = {
  width: number;
  height: number;
  contentFit: ContentFit;
};

const FIXED_RATIOS: Record<string, number> = {
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "2.35:1": 2.35,
};

export function isAspectMode(mode: string): mode is AspectMode {
  return (ASPECT_MODES as readonly string[]).includes(mode);
}

/** Numeric ratio of a fixed mode, `null` for `auto` / `fill` / unknown modes. */
export function aspectRatio(mode: string): number | null {
  return FIXED_RATIOS[mode] ?? null;
}

/**
 * Size and fit of the video view for `mode` inside a `width` x `height` screen.
 * - `auto`: the whole screen, letterboxed by the player (`contain`).
 * - `fill`: the whole screen, cropped to fill it (`cover`).
 * - a fixed ratio: the largest box of that ratio that fits, stretched (`fill`).
 * Unknown modes behave like `auto`; a degenerate screen returns it unchanged.
 */
export function aspectBox(mode: string, width: number, height: number): AspectBox {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  if (mode === "fill") return { width: w, height: h, contentFit: "cover" };
  const ratio = aspectRatio(mode);
  if (ratio == null || w === 0 || h === 0) return { width: w, height: h, contentFit: "contain" };
  if (w / h > ratio) {
    // Screen wider than the target: full height, pillarboxed.
    return { width: Math.round(h * ratio), height: h, contentFit: "fill" };
  }
  // Screen taller (or equal): full width, letterboxed.
  return { width: w, height: Math.round(w / ratio), contentFit: "fill" };
}
