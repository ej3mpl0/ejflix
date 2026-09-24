import React, { useEffect } from "react";
import { Pressable } from "react-native";
import Animated, { Easing, interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useTheme } from "../../theme/ThemeProvider";
import { haptic } from "../../lib/haptics";

const W = 48;
const H = 28;
const KNOB = 20;

/** Switch: accent track + white knob (desktop `settings/Toggle.tsx`). Hit target 44 dp. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const on = useSharedValue(checked ? 1 : 0);

  useEffect(() => {
    on.value = reduced ? (checked ? 1 : 0) : withTiming(checked ? 1 : 0, { duration: 200, easing: Easing.bezier(0.2, 0, 0, 1) });
  }, [checked, on, reduced]);

  const trackOff = t.white(0.15);
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], [trackOff, t.colors.accent]),
  }));
  const knob = useAnimatedStyle(() => ({
    transform: [{ translateX: on.value * (W - KNOB - 8) }],
    backgroundColor: interpolateColor(on.value, [0, 1], ["#ffffff", t.colors.onAccent]),
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      onPress={() => {
        haptic("selection");
        onChange(!checked);
      }}
      style={{ minHeight: 44, justifyContent: "center", opacity: disabled ? t.opacity.disabled : 1 }}
    >
      <Animated.View style={[{ width: W, height: H, borderRadius: H / 2, justifyContent: "center" }, track]}>
        <Animated.View
          style={[
            {
              width: KNOB,
              height: KNOB,
              borderRadius: KNOB / 2,
              marginLeft: 4,
              shadowColor: "#000",
              shadowOpacity: 0.4,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
              elevation: 2,
            },
            knob,
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}
