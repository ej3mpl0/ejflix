import React from "react";
import { Text, View } from "react-native";
import { Sun, Volume1, Volume2, VolumeX } from "lucide-react-native";
import Animated, { FadeIn, FadeOut, useReducedMotion } from "react-native-reanimated";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { Glass } from "../ui/Glass";

export type Hud = { kind: "brightness" | "volume"; value: number };

/** Pill at the top of the screen while a vertical pan changes brightness or volume. */
export function GestureHud({ hud, top }: { hud: Hud; top: number }) {
  const s = useStyles();
  const t = useTheme();
  const reduced = useReducedMotion();
  const pct = Math.round(Math.max(0, Math.min(100, hud.value)));
  const Icon = hud.kind === "brightness" ? Sun : pct === 0 ? VolumeX : pct < 50 ? Volume1 : Volume2;
  return (
    <Animated.View
      pointerEvents="none"
      entering={reduced ? undefined : FadeIn.duration(120)}
      exiting={reduced ? undefined : FadeOut.duration(200)}
      style={[s.wrap, { top }]}
    >
      <Glass variant="pill" blur={false} style={s.pill}>
        <View style={s.inner}>
          <Icon size={18} color={t.colors.text} strokeWidth={2} />
          <View style={s.track}>
            <View style={[s.fill, { width: `${pct}%` }]} />
          </View>
          <Text style={s.value}>{pct}%</Text>
        </View>
      </Glass>
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 30 },
  pill: { borderRadius: t.radii.pill },
  inner: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, height: 40 },
  track: { width: 132, height: 4, borderRadius: 2, backgroundColor: t.white(0.2), overflow: "hidden" },
  fill: { height: 4, borderRadius: 2, backgroundColor: t.colors.text },
  value: { ...text(13, "medium", { tabular: true }), color: t.colors.text, minWidth: 40, textAlign: "right" },
}));
