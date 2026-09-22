import React from "react";
import { Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Check } from "lucide-react-native";
import type { ThemeId } from "../../lib/types";
import { useI18n } from "../../lib/locale-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { THEMES } from "../../theme/tokens";
import { text } from "../../theme/typography";
import { gradientPoints } from "../ui/Logo";

const CELL = 84;
const DISC = 44;

/** Grid of theme swatches: 44 dp gradient discs (135°) with a ring on the active one. */
export function ThemePicker({ value, onChange }: { value: ThemeId; onChange: (id: ThemeId) => void }) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { start, end } = gradientPoints(135);
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={tr("theme")} style={s.grid}>
      {THEMES.map((theme) => {
        const active = theme.id === value;
        const stops = (theme.stops.length > 1 ? theme.stops : [theme.stops[0], theme.stops[0]]) as [string, string, ...string[]];
        return (
          <Pressable
            key={theme.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            accessibilityLabel={tr(theme.labelKey)}
            onPress={() => onChange(theme.id)}
            style={({ pressed }) => [s.cell, pressed ? s.cellPressed : null]}
          >
            <View style={[s.ring, active ? s.ringOn : null]}>
              <LinearGradient colors={stops} start={start} end={end} style={s.disc}>
                <View pointerEvents="none" style={s.discHighlight} />
                {active ? <Check size={18} color="rgba(0, 0, 0, 0.8)" strokeWidth={3} /> : null}
              </LinearGradient>
            </View>
            <Text numberOfLines={1} style={[s.label, active ? { color: t.colors.text, fontFamily: t.fonts.semibold } : null]}>
              {tr(theme.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginHorizontal: -8 },
  cell: { width: CELL, alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 12 },
  cellPressed: { backgroundColor: t.white(0.05) },
  ring: { width: DISC + 8, height: DISC + 8, borderRadius: (DISC + 8) / 2, borderWidth: 2, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  ringOn: { borderColor: "#ffffff" },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    overflow: "hidden",
  },
  discHighlight: { position: "absolute", top: 0, left: 0, right: 0, height: 1, backgroundColor: t.white(0.25) },
  label: { ...text(12), color: t.colors.muted, maxWidth: CELL - 4 },
}));
