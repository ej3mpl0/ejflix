import React, { useEffect } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useTheme } from "../../theme/ThemeProvider";

/** Thin progress bar (poster / continue-watching progress, download fill). `value` in 0..1. */
export function ProgressBar({
  value,
  height = 3,
  color,
  track,
  animated = true,
  style,
}: {
  value: number;
  height?: number;
  color?: string;
  track?: string;
  animated?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const w = useSharedValue(clamped);
  useEffect(() => {
    w.value = animated && !reduced ? withTiming(clamped, { duration: 220, easing: Easing.bezier(0.2, 0, 0, 1) }) : clamped;
  }, [animated, clamped, reduced, w]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[{ height, borderRadius: height, backgroundColor: track ?? t.white(0.2), overflow: "hidden" }, style]}
    >
      <Animated.View style={[{ height, borderRadius: height, backgroundColor: color ?? t.colors.accent }, fill]} />
    </View>
  );
}
