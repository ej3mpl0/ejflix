import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";

export type FlashKind = "play" | "pause" | "back" | "fwd";

export type Flash = {
  kind: FlashKind;
  /** Accumulated seconds for back / fwd ("10", "20"…). */
  amount: number;
  /** Changes on every show so the ripple restarts. */
  id: number;
};

/**
 * Feedback for a tap gesture: play / pause in the middle, ±N s with a ripple on the tapped
 * side (`.flash-icon`). Mount with `key={flash.id}` so every show restarts the animation.
 */
export function FlashIcon({ flash, width }: { flash: Flash; width: number }) {
  const s = useStyles();
  const t = useTheme();
  const reduced = useReducedMotion();
  const ripple = useSharedValue(reduced ? 1 : 0);
  const pop = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) return;
    ripple.value = 0;
    pop.value = 0;
    ripple.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.quad) });
    pop.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.back(1.4)) });
  }, [flash.id, reduced, ripple, pop]);

  const rippleStyle = useAnimatedStyle(() => ({
    opacity: 0.35 * (1 - ripple.value),
    transform: [{ scale: 0.55 + 0.6 * ripple.value }],
  }));
  const popStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, pop.value * 1.4),
    transform: [{ scale: 0.7 + 0.3 * pop.value }],
  }));

  const sideways = flash.kind === "back" || flash.kind === "fwd";
  const centreX = flash.kind === "back" ? width * 0.22 : flash.kind === "fwd" ? width * 0.78 : width / 2;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.root]}>
      <View style={[s.anchor, { left: centreX }]}>
        {sideways ? <Animated.View style={[s.ripple, rippleStyle]} /> : null}
        <Animated.View style={[s.disc, popStyle]}>
          {flash.kind === "play" ? <Play size={36} color={t.colors.text} fill={t.colors.text} /> : null}
          {flash.kind === "pause" ? <Pause size={36} color={t.colors.text} fill={t.colors.text} /> : null}
          {sideways ? (
            <View style={s.seek}>
              {flash.kind === "back" ? (
                <RotateCcw size={40} color={t.colors.text} strokeWidth={1.5} />
              ) : (
                <RotateCw size={40} color={t.colors.text} strokeWidth={1.5} />
              )}
              <Text style={s.amount}>{flash.amount}</Text>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { zIndex: 12, justifyContent: "center" },
  anchor: { position: "absolute", width: 0, height: 0, alignItems: "center", justifyContent: "center" },
  ripple: { position: "absolute", width: 220, height: 220, borderRadius: 110, backgroundColor: t.white(1) },
  disc: { width: 80, height: 80, borderRadius: 40, backgroundColor: t.black(0.4), alignItems: "center", justifyContent: "center" },
  seek: { alignItems: "center", justifyContent: "center" },
  amount: { ...text(11, "bold", { tabular: true }), color: t.colors.text, position: "absolute" },
}));
