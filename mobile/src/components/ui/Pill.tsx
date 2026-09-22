import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { PressableScale } from "./PressableScale";
import { Spinner } from "./Spinner";

export type PillVariant = "primary" | "tonal" | "ghost";
export type PillSize = "sm" | "md" | "lg";

export type PillProps = {
  variant?: PillVariant;
  size?: PillSize;
  /** Fully rounded (hero / details actions); otherwise the button radius. */
  pill?: boolean;
  icon?: LucideIcon;
  /** Custom node instead of a lucide icon. */
  iconNode?: React.ReactNode;
  label?: string;
  children?: React.ReactNode;
  disabled?: boolean;
  /** Replaces the icon with a spinner and disables the button. */
  loading?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Stretch to the parent width. */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
};

const SIZES: Record<PillSize, { h: number; px: number; fs: number; icon: number; gap: number }> = {
  sm: { h: 36, px: 16, fs: 13, icon: 15, gap: 6 },
  md: { h: 44, px: 20, fs: 14, icon: 17, gap: 8 },
  lg: { h: 48, px: 28, fs: 15, icon: 18, gap: 8 },
};

/** Button primitive: accent-filled `primary`, translucent `tonal`, borderless `ghost`. */
export function Pill({
  variant = "tonal",
  size = "md",
  pill = false,
  icon: Icon,
  iconNode,
  label,
  children,
  disabled = false,
  loading = false,
  onPress,
  onLongPress,
  block = false,
  style,
  accessibilityLabel,
  testID,
}: PillProps) {
  const s = useStyles();
  const t = useTheme();
  const dims = SIZES[size];
  const fg = variant === "primary" ? t.colors.onAccent : t.colors.text;
  const inactive = disabled || loading;
  const content = label ?? (typeof children === "string" ? children : null);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? content ?? undefined}
      accessibilityState={{ disabled: inactive }}
      disabled={inactive}
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      style={[
        s.base,
        variant === "primary" ? s.primary : variant === "tonal" ? s.tonal : s.ghost,
        { height: dims.h, paddingHorizontal: dims.px, borderRadius: pill ? t.radii.pill : t.radii.btn, gap: dims.gap },
        block ? s.block : null,
        inactive ? { opacity: t.opacity.disabled } : null,
        style,
      ]}
    >
      {loading ? (
        <Spinner size={dims.icon} color={fg} />
      ) : Icon ? (
        <Icon size={dims.icon} color={fg} strokeWidth={2.2} />
      ) : (
        iconNode ?? null
      )}
      {content != null ? (
        <Text numberOfLines={1} style={[text(dims.fs, "semibold"), { color: fg }]}>
          {content}
        </Text>
      ) : (
        <View>{typeof children === "string" ? null : children}</View>
      )}
    </PressableScale>
  );
}

const useStyles = makeStyles((t) => ({
  base: { flexDirection: "row", alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
  block: { alignSelf: "stretch", width: "100%" },
  primary: { backgroundColor: t.colors.accent },
  tonal: { backgroundColor: t.white(0.12) },
  ghost: { backgroundColor: "transparent" },
}));
