import type { TextStyle } from "react-native";
import { FONTS } from "./tokens";

export type Weight = "regular" | "medium" | "semibold" | "bold" | "extrabold";

const FAMILY: Record<Weight, string> = {
  regular: FONTS.regular,
  medium: FONTS.medium,
  semibold: FONTS.semibold,
  bold: FONTS.bold,
  extrabold: FONTS.extrabold,
};

/**
 * Text style helper: `text(13, "medium")` ≈ Tailwind `text-[13px] font-medium`.
 * `tracking` is in em (desktop uses `tracking-tight` = -0.025em on titles).
 */
export function text(
  size: number,
  weight: Weight = "regular",
  opts: { lineHeight?: number; tracking?: number; tabular?: boolean; uppercase?: boolean } = {},
): TextStyle {
  const style: TextStyle = {
    fontFamily: FAMILY[weight],
    fontSize: size,
    lineHeight: opts.lineHeight ?? Math.round(size * 1.35),
    includeFontPadding: false,
  };
  if (opts.tracking != null) style.letterSpacing = opts.tracking * size;
  if (opts.tabular) style.fontVariant = ["tabular-nums"];
  if (opts.uppercase) style.textTransform = "uppercase";
  return style;
}

/** Brand wordmark (Bebas Neue). */
export function brandText(size: number): TextStyle {
  return {
    fontFamily: FONTS.brand,
    fontSize: size,
    lineHeight: Math.round(size * 1.05),
    letterSpacing: size * 0.04,
    includeFontPadding: false,
  };
}
