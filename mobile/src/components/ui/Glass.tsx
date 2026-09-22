import React from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";

/**
 * Module-wide switch: set it to false on devices where the Android blur is too
 * expensive (the surfaces fall back to a solid translucent colour).
 */
let blurEnabled = true;
export function setGlassBlurEnabled(enabled: boolean) {
  blurEnabled = enabled;
}
export function isGlassBlurEnabled() {
  return blurEnabled;
}

/**
 * True on iOS 26+ built with Xcode 26: surfaces use the system Liquid Glass
 * (`UIGlassEffect`) instead of a blur plus a dark overlay. Checked once, it
 * cannot change while the app runs.
 */
export const LIQUID_GLASS = Platform.OS === "ios" && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

export type GlassProps = {
  /** `header` = `.glass-header` (rgba(28,28,30,.55) + blur 24); `pill` = `.glass-pill` (black .5 + white .2 border + blur 14). */
  variant?: "header" | "pill";
  /** Real blur behind the surface; falls back to a solid rgba when off. */
  blur?: boolean;
  /** 1 px gradient hairline at the bottom edge (`.glass-header::after`). */
  hairline?: boolean;
  /** Hairline opacity (desktop `--glass-line`, 0.6 by default). */
  hairlineOpacity?: number;
  /** Liquid Glass only: the surface reacts to touches (buttons, tab bar). */
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

const useStyles = makeStyles((t) => ({
  root: { overflow: "hidden" },
  headerFallback: { backgroundColor: "rgba(28, 28, 30, 0.92)" },
  headerOverlay: { backgroundColor: "rgba(28, 28, 30, 0.55)" },
  pill: { borderRadius: t.radii.pill, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: t.white(0.2) },
  liquidPill: { borderRadius: t.radii.pill },
  pillOverlay: { backgroundColor: t.black(0.5) },
  pillFallback: { backgroundColor: t.black(0.72) },
  hairline: { position: "absolute", left: 0, right: 0, bottom: 0, height: 1 },
}));

/** Frosted surface used by the header, the tab bar and floating pills. */
export function Glass({
  variant = "header",
  blur = true,
  hairline = false,
  hairlineOpacity = 0.6,
  interactive = false,
  style,
  children,
}: GlassProps) {
  const s = useStyles();
  const t = useTheme();
  const useBlur = blur && blurEnabled;
  const isPill = variant === "pill";
  const line = hairline ? (
    <LinearGradient
      pointerEvents="none"
      colors={[t.white(0.27), t.white(0.02)]}
      start={{ x: 0, y: 0.5 }}
      end={{ x: 1, y: 0.5 }}
      style={[s.hairline, { opacity: hairlineOpacity }]}
    />
  ) : null;

  if (LIQUID_GLASS && useBlur) {
    // The system material brings its own edge light and contrast, so neither the
    // dark overlay nor the 1 px border of the blur version is drawn; a light dark
    // tint keeps white text readable over bright artwork.
    return (
      <GlassView
        glassEffectStyle={isPill ? "clear" : "regular"}
        colorScheme="dark"
        tintColor={isPill ? t.black(0.25) : t.black(0.18)}
        isInteractive={interactive}
        style={[s.root, isPill ? s.liquidPill : null, style]}
      >
        {children}
        {line}
      </GlassView>
    );
  }

  return (
    <View
      style={[
        s.root,
        isPill ? s.pill : null,
        useBlur ? null : isPill ? s.pillFallback : s.headerFallback,
        style,
      ]}
    >
      {useBlur ? (
        <BlurView
          pointerEvents="none"
          tint="dark"
          intensity={isPill ? 14 : 40}
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {useBlur ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, isPill ? s.pillOverlay : s.headerOverlay]} /> : null}
      {children}
      {line}
    </View>
  );
}
