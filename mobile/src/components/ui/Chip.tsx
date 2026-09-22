import React from "react";
import { Text, type StyleProp, type ViewStyle } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { PressableScale } from "./PressableScale";

/** Pill-shaped chip; `selected` tints it with the accent (season pickers, genre filters). */
export function Chip({
  selected = false,
  icon: Icon,
  label,
  onPress,
  onLongPress,
  disabled,
  style,
}: {
  selected?: boolean;
  icon?: LucideIcon;
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  const t = useTheme();
  const fg = selected ? t.colors.accent : t.white(0.8);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[s.base, selected ? s.selected : s.plain, disabled ? { opacity: t.opacity.disabled } : null, style]}
    >
      {Icon ? <Icon size={14} color={fg} strokeWidth={2.2} /> : null}
      <Text numberOfLines={1} style={[text(13, "medium"), { color: fg }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

const useStyles = makeStyles((t) => ({
  base: {
    height: 36,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: t.radii.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  plain: { backgroundColor: t.white(0.06), borderColor: "transparent" },
  selected: { backgroundColor: t.colors.accentSoft, borderColor: `${t.colors.accent}66` },
}));
