import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { makeStyles } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";

/** Small uppercase pills: "1080P", "5.1", "HDR"… (`QualityBadge.tsx`). */
export function QualityBadges({
  badges,
  size = "md",
  style,
}: {
  badges: string[];
  /** `sm` for card corners. */
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  if (!badges.length) return null;
  return (
    <View style={[s.row, style]}>
      {badges.map((badge) => (
        <View key={badge} style={[s.badge, size === "sm" ? s.badgeSm : null]}>
          <Text style={[s.label, size === "sm" ? s.labelSm : null]}>{badge}</Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  badge: {
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.white(0.15),
    backgroundColor: t.white(0.05),
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeSm: { paddingHorizontal: 6, paddingVertical: 1 },
  label: { ...text(11, "semibold", { tracking: 0.08, uppercase: true, lineHeight: 15 }), color: t.colors.text },
  labelSm: { ...text(9, "semibold", { tracking: 0.08, uppercase: true, lineHeight: 12 }) },
}));
