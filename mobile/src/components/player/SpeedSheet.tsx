import React from "react";
import { Pressable, Text, View } from "react-native";
import { useI18n } from "../../lib/locale-context";
import { makeStyles } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { Sheet } from "../ui/Sheet";

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function formatSpeed(speed: number): string {
  return `${Number(speed.toFixed(2))}x`;
}

/** Playback-speed picker: a dotted track with the active dot enlarged (desktop `SpeedMenu`). */
export function SpeedSheet({
  visible,
  speed,
  onSelect,
  onClose,
}: {
  visible: boolean;
  speed: number;
  onSelect: (speed: number) => void;
  onClose: () => void;
}) {
  const s = useStyles();
  const { t } = useI18n();
  return (
    <Sheet visible={visible} onClose={onClose} title={t("playbackSpeed")} snap="auto">
      <View style={s.body}>
        <View style={s.track}>
          <View style={s.line} />
          <View style={s.dots}>
            {SPEEDS.map((value) => {
              const active = Math.abs(value - speed) < 0.01;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={formatSpeed(value)}
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    onSelect(value);
                    onClose();
                  }}
                  hitSlop={12}
                  style={s.stop}
                >
                  <View style={[s.dot, active ? s.dotActive : null]} />
                  <Text numberOfLines={1} style={[s.label, active ? s.labelActive : null]}>
                    {value === 1 ? t("speedNormal") : formatSpeed(value)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  body: { paddingHorizontal: 32, paddingTop: 12, paddingBottom: 28 },
  track: { height: 64, justifyContent: "flex-start" },
  line: { position: "absolute", left: 16, right: 16, top: 16, height: 1, backgroundColor: t.white(0.25) },
  dots: { flexDirection: "row", justifyContent: "space-between" },
  stop: { width: 48, alignItems: "center", gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.white(0.6), marginTop: 11 },
  dotActive: { width: 16, height: 16, borderRadius: 8, backgroundColor: t.colors.accent, marginTop: 8 },
  label: { ...text(12, "regular", { tabular: true }), color: t.white(0.7) },
  labelActive: { ...text(12, "semibold", { tabular: true }), color: t.colors.text },
}));
