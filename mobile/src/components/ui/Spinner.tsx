import React, { useEffect } from "react";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useTheme } from "../../theme/ThemeProvider";

/** Rotating ring (lucide `LoaderCircle` + `animate-spin` on the desktop). */
export function Spinner({ size = 20, color, thickness }: { size?: number; color?: string; thickness?: number }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const angle = useSharedValue(0);
  const stroke = thickness ?? Math.max(2, Math.round(size / 9));

  useEffect(() => {
    if (reduced) return;
    angle.value = 0;
    angle.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(angle);
  }, [angle, reduced]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));

  return (
    <Animated.View
      accessibilityRole="progressbar"
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: stroke,
          borderColor: color ?? t.colors.accent,
          borderTopColor: "transparent",
          borderRightColor: reduced ? color ?? t.colors.accent : "transparent",
          opacity: 0.95,
        },
        style,
      ]}
    />
  );
}
