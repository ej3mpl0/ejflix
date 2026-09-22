import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Check } from "lucide-react-native";
import type { Movie } from "../../lib/types";
import { useItemFlags } from "../../lib/userdata-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";

/** Accent check disc for watched items (poster and episode corners). */
export function WatchedBadge({ movie, size = 24, style }: { movie: Movie; size?: number; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  const t = useTheme();
  const flags = useItemFlags(movie);
  const watched = flags.played || flags.unplayedCount === 0;
  if (!watched) return null;
  return (
    <View pointerEvents="none" accessibilityElementsHidden style={[s.disc, { width: size, height: size, borderRadius: size / 2 }, style]}>
      <Check size={Math.round(size * 0.55)} color={t.colors.onAccent} strokeWidth={3} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  disc: {
    backgroundColor: t.colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
}));
