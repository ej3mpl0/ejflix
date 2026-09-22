import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { makeStyles } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";

/** Quality badges ("4K", "HDR", "Dolby Atmos"…) as tiny bordered pills (`QualityBadges`). */
export function Badges({ badges, size = "sm", style }: { badges: string[]; size?: "sm" | "md"; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  if (!badges.length) return null;
  return (
    <View style={[s.row, style]}>
      {badges.map((badge) => (
        <View key={badge} style={[s.badge, size === "md" ? s.badgeMd : null]}>
          <Text style={size === "md" ? s.textMd : s.text}>{badge}</Text>
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
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeMd: { paddingHorizontal: 8, paddingVertical: 2 },
  text: { ...text(9, "semibold", { tracking: 0.08, uppercase: true, lineHeight: 13 }), color: t.colors.text },
  textMd: { ...text(11, "semibold", { tracking: 0.08, uppercase: true, lineHeight: 15 }), color: t.colors.text },
}));
