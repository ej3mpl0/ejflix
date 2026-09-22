import React from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";

/** Pill group of exclusive options; the active one is filled with the accent. */
export function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  label,
  size = "md",
  style,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  /** `sm` = 32 dp segments (inline in rows); `md` = 40 dp (settings). */
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  const t = useTheme();
  const h = size === "sm" ? 32 : 40;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[s.group, style]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            hitSlop={{ top: 6, bottom: 6 }}
            onPress={() => onChange(option.value)}
            style={[s.segment, { height: h }, active ? s.active : null]}
          >
            <Text numberOfLines={1} style={[text(13, "medium"), { color: active ? t.colors.onAccent : t.colors.muted }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  group: { flexDirection: "row", alignSelf: "flex-start", padding: 4, borderRadius: t.radii.pill, backgroundColor: t.white(0.06) },
  segment: { paddingHorizontal: 14, borderRadius: t.radii.pill, alignItems: "center", justifyContent: "center" },
  active: { backgroundColor: t.colors.accent },
}));
