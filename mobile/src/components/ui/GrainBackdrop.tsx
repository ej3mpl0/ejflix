import React, { useMemo } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Defs, Pattern, RadialGradient, Rect, Stop } from "react-native-svg";
import { useTheme } from "../../theme/ThemeProvider";

/** Deterministic pseudo-random speckles for the grain tile. */
function speckles(seed: number, count: number, size: number) {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  return Array.from({ length: count }, () => ({ x: rnd() * size, y: rnd() * size, o: 0.35 + rnd() * 0.65 }));
}

/**
 * Auth-screen backdrop: base colour, a radial accent glow (desktop
 * `radial-gradient(900px circle at 50% 10%, accent 16%, transparent 60%)`),
 * an optional vignette and a faint noise tile (`.grain`).
 */
export function GrainBackdrop({
  glow = 0.16,
  cx = 0.5,
  cy = 0.1,
  radius = 0.62,
  noise = true,
  vignette = false,
}: {
  /** Peak opacity of the accent glow. */
  glow?: number;
  /** Glow centre (fractions of the width / height). */
  cx?: number;
  cy?: number;
  /** Glow radius as a fraction of the width. */
  radius?: number;
  noise?: boolean;
  vignette?: boolean;
}) {
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  const dots = useMemo(() => speckles(7, 90, 48), []);
  const r = Math.max(width, height * 0.8) * radius;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.base }]}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="glow" gradientUnits="userSpaceOnUse" cx={width * cx} cy={height * cy} r={r}>
            <Stop offset="0" stopColor={t.colors.accent} stopOpacity={glow} />
            <Stop offset="0.55" stopColor={t.colors.accent} stopOpacity={glow * 0.35} />
            <Stop offset="1" stopColor={t.colors.accent} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="vignette" gradientUnits="userSpaceOnUse" cx={width / 2} cy={height / 2} r={Math.max(width, height) * 0.75}>
            <Stop offset="0.4" stopColor={t.colors.base} stopOpacity={0} />
            <Stop offset="1" stopColor={t.colors.base} stopOpacity={1} />
          </RadialGradient>
          <Pattern id="grain" patternUnits="userSpaceOnUse" width={48} height={48}>
            {dots.map((d, i) => (
              <Rect key={i} x={d.x} y={d.y} width={1} height={1} fill="#ffffff" opacity={d.o} />
            ))}
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#glow)" />
        {vignette ? <Rect x={0} y={0} width={width} height={height} fill="url(#vignette)" /> : null}
        {noise ? <Rect x={0} y={0} width={width} height={height} fill="url(#grain)" opacity={0.045} /> : null}
      </Svg>
    </View>
  );
}
