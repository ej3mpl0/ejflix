import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { makeStyles } from "../../theme/ThemeProvider";

/**
 * `.card-depth`: surface background, hairline edge (white .06) and a 1 px top
 * highlight (white .08). Radius = card unless overridden.
 */
export function CardSurface({
  radius,
  tone = "surface",
  style,
  children,
}: {
  radius?: number;
  /** Background tone. */
  tone?: "surface" | "panel" | "transparent";
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const s = useStyles();
  return (
    <View
      style={[
        s.root,
        tone === "panel" ? s.panel : tone === "transparent" ? s.transparent : null,
        radius != null ? { borderRadius: radius } : null,
        style,
      ]}
    >
      <View pointerEvents="none" style={[s.highlight, radius != null ? { borderTopLeftRadius: radius, borderTopRightRadius: radius } : null]} />
      {children}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radii.card,
    borderWidth: 1,
    borderColor: t.white(0.06),
    overflow: "hidden",
  },
  panel: { backgroundColor: t.colors.panel },
  transparent: { backgroundColor: "transparent" },
  highlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: t.white(0.08),
    borderTopLeftRadius: t.radii.card,
    borderTopRightRadius: t.radii.card,
  },
}));
