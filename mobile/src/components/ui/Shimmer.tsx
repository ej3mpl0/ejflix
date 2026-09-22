import React, { useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withTiming } from "react-native-reanimated";
import { useTheme } from "../../theme/ThemeProvider";

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

/** Loading placeholder with a moving highlight (`.shimmer`). Size and radius from `style`. */
export function Shimmer({
  style,
  delay = 0,
  width,
  height,
  radius,
}: {
  style?: StyleProp<ViewStyle>;
  delay?: number;
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const x = useSharedValue(-1);

  useEffect(() => {
    if (reduced) return;
    x.value = -1;
    x.value = withDelay(delay, withRepeat(withTiming(1, { duration: 1400, easing: Easing.bezier(0.2, 0, 0, 1) }), -1, false));
    return () => cancelAnimation(x);
  }, [delay, reduced, x]);

  const [w, setW] = React.useState(0);
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * w }] }));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[
        { backgroundColor: t.white(0.06), overflow: "hidden", borderRadius: radius ?? 6 },
        width != null ? { width } : null,
        height != null ? { height } : null,
        style,
      ]}
    >
      {!reduced ? (
        <AnimatedGradient
          pointerEvents="none"
          colors={["transparent", t.white(0.06), "transparent"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[StyleSheet.absoluteFill, sweep]}
        />
      ) : null}
    </View>
  );
}
