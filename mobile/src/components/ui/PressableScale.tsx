import React, { useCallback } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, Easing } from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressableScaleProps = Omit<PressableProps, "style"> & {
  /** Scale while pressed (desktop `.btn-press` = 0.96). */
  scaleTo?: number;
  /** Extra opacity while pressed (0 = none). */
  pressOpacity?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

/**
 * Pressable that shrinks a little while touched (`.btn-press` / `.icon-hit`).
 * Honors the system reduced-motion preference.
 */
export function PressableScale({
  scaleTo = 0.96,
  pressOpacity = 0,
  style,
  onPressIn,
  onPressOut,
  disabled,
  children,
  ...rest
}: PressableScaleProps) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - scaleTo) * pressed.value }],
    opacity: 1 - pressOpacity * pressed.value,
  }));

  const handleIn = useCallback(
    (e: Parameters<NonNullable<PressableProps["onPressIn"]>>[0]) => {
      if (!disabled) pressed.value = reduced ? 1 : withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) });
      onPressIn?.(e);
    },
    [disabled, onPressIn, pressed, reduced],
  );
  const handleOut = useCallback(
    (e: Parameters<NonNullable<PressableProps["onPressOut"]>>[0]) => {
      pressed.value = reduced ? 0 : withTiming(0, { duration: 150, easing: Easing.out(Easing.quad) });
      onPressOut?.(e);
    },
    [onPressOut, pressed, reduced],
  );

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={handleIn}
      onPressOut={handleOut}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
