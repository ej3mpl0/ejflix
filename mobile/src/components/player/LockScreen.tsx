import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LockOpen } from "lucide-react-native";
import Animated, { FadeIn, FadeOut, useReducedMotion } from "react-native-reanimated";
import { useI18n } from "../../lib/locale-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { PressableScale } from "../ui/PressableScale";

/**
 * Covers the video while the controls are locked. A tap anywhere shows the unlock circle
 * for a moment (`hint`); tapping the circle unlocks.
 */
export function LockScreen({ hint, onUnlock, onHint }: { hint: boolean; onUnlock: () => void; onHint: () => void }) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const reduced = useReducedMotion();
  return (
    <View style={[StyleSheet.absoluteFill, s.root]}>
      <Pressable accessibilityLabel={tr("unlock")} style={StyleSheet.absoluteFill} onPress={onHint} />
      {hint ? (
        <Animated.View
          pointerEvents="box-none"
          entering={reduced ? undefined : FadeIn.duration(200)}
          exiting={reduced ? undefined : FadeOut.duration(200)}
          style={s.centre}
        >
          <PressableScale accessibilityRole="button" accessibilityLabel={tr("unlock")} onPress={onUnlock} style={s.button}>
            <View style={s.circle}>
              <LockOpen size={30} color={t.colors.text} strokeWidth={1.75} />
            </View>
            <View style={s.label}>
              <Text style={s.labelText}>{tr("tapToUnlock")}</Text>
            </View>
          </PressableScale>
        </Animated.View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { zIndex: 40 },
  centre: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  button: { alignItems: "center", gap: 12 },
  circle: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 1,
    borderColor: t.white(0.2),
    backgroundColor: t.black(0.6),
    alignItems: "center",
    justifyContent: "center",
  },
  label: { borderRadius: t.radii.pill, backgroundColor: t.black(0.6), paddingHorizontal: 12, paddingVertical: 4 },
  labelText: { ...text(13, "medium"), color: t.colors.text },
}));
