import React, { useEffect } from "react";
import { View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import type { LucideIcon } from "lucide-react-native";

/**
 * Two stacked icons that crossfade (`.icon-swap`): play/pause, heart on/off…
 * `on` = show `iconOn`.
 */
export function IconSwap({
  on,
  iconOn: IconOn,
  iconOff: IconOff,
  size = 22,
  color = "#ffffff",
  colorOn,
  strokeWidth = 2,
  fillOn = false,
}: {
  on: boolean;
  iconOn: LucideIcon;
  iconOff: LucideIcon;
  size?: number;
  color?: string;
  /** Colour of the "on" icon (defaults to `color`). */
  colorOn?: string;
  strokeWidth?: number;
  /** Fill the "on" icon with its colour (favorite heart). */
  fillOn?: boolean;
}) {
  const reduced = useReducedMotion();
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    v.value = reduced ? (on ? 1 : 0) : withTiming(on ? 1 : 0, { duration: 180, easing: Easing.bezier(0.2, 0, 0, 1) });
  }, [on, reduced, v]);

  const styleOn = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scale: 0.25 + 0.75 * v.value }] }));
  const styleOff = useAnimatedStyle(() => ({ opacity: 1 - v.value, transform: [{ scale: 1 - 0.75 * v.value }] }));
  const onColor = colorOn ?? color;

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[{ position: "absolute", inset: 0 }, styleOff]}>
        <IconOff size={size} color={color} strokeWidth={strokeWidth} />
      </Animated.View>
      <Animated.View style={[{ position: "absolute", inset: 0 }, styleOn]}>
        <IconOn size={size} color={onColor} strokeWidth={strokeWidth} fill={fillOn ? onColor : "none"} />
      </Animated.View>
    </View>
  );
}
