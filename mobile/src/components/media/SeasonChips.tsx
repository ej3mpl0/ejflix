import React, { useEffect, useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import { useI18n } from "../../lib/locale-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { PressableScale } from "../ui/PressableScale";

export type SeasonChip = {
  id: string;
  name: string;
  /** Episode count shown after the name. */
  count?: number | null;
};

/** Horizontal season picker; scrolls the selected chip into view. Hidden with one season. */
export function SeasonChips({
  seasons,
  value,
  onChange,
  padHorizontal = 0,
}: {
  seasons: SeasonChip[];
  value: string | null;
  onChange: (id: string) => void;
  /** Bleed padding when the list runs edge to edge. */
  padHorizontal?: number;
}) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const scroller = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!value) return;
    const x = offsets.current[value];
    if (x != null) scroller.current?.scrollTo({ x: Math.max(0, x - 24), animated: true });
  }, [value]);

  if (seasons.length <= 1) return null;
  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      accessibilityLabel={tr("seasons")}
      contentContainerStyle={[s.row, { paddingHorizontal: padHorizontal }]}
    >
      {seasons.map((season) => {
        const selected = season.id === value;
        const fg = selected ? t.colors.accent : t.white(0.8);
        return (
          <PressableScale
            key={season.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(season.id)}
            onLayout={(e) => {
              offsets.current[season.id] = e.nativeEvent.layout.x;
            }}
            style={[s.chip, selected ? s.selected : s.plain]}
          >
            <Text numberOfLines={1} style={[s.label, { color: fg }]}>
              {season.name}
            </Text>
            {season.count ? (
              <Text style={[s.count, { color: fg }]}>{season.count}</Text>
            ) : null}
          </PressableScale>
        );
      })}
      <View style={{ width: 8 }} />
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  row: { flexDirection: "row", gap: 8, paddingBottom: 4 },
  chip: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  plain: { backgroundColor: t.white(0.06), borderColor: "transparent" },
  selected: { backgroundColor: t.colors.accentSoft, borderColor: `${t.colors.accent}66` },
  label: { ...text(14, "medium") },
  count: { ...text(11, "regular", { tabular: true }), opacity: 0.7 },
}));
