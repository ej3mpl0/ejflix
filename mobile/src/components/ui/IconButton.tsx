import React from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { PressableScale } from "./PressableScale";

export type IconButtonProps = {
  icon: LucideIcon;
  /** Accessibility label (required: the button has no text). */
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  size?: number;
  /** Hit target (≥ 44 dp). */
  hit?: number;
  color?: string;
  /** `plain` = `.icon-hit`; `tonal` = white/8 disc; `glass` = black/50 disc with a hairline. */
  variant?: "plain" | "tonal" | "glass" | "accent";
  active?: boolean;
  disabled?: boolean;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Icon-only button with a 44 dp hit target and the `.icon-hit` press feedback. */
export function IconButton({
  icon: Icon,
  label,
  onPress,
  onLongPress,
  size = 22,
  hit = 44,
  color,
  variant = "plain",
  active = false,
  disabled = false,
  strokeWidth = 2,
  style,
  testID,
}: IconButtonProps) {
  const s = useStyles();
  const t = useTheme();
  const fg =
    color ?? (variant === "accent" ? t.colors.onAccent : active ? t.colors.text : variant === "plain" ? t.colors.muted : t.colors.text);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      style={[
        s.base,
        { width: hit, height: hit, borderRadius: hit / 2 },
        variant === "tonal" ? s.tonal : variant === "glass" ? s.glass : variant === "accent" ? s.accent : null,
        disabled ? { opacity: t.opacity.disabled } : null,
        style,
      ]}
    >
      <Icon size={size} color={fg} strokeWidth={strokeWidth} />
    </PressableScale>
  );
}

const useStyles = makeStyles((t) => ({
  base: { alignItems: "center", justifyContent: "center" },
  tonal: { backgroundColor: t.white(0.08) },
  glass: { backgroundColor: t.black(0.5), borderWidth: 1, borderColor: t.white(0.2) },
  accent: { backgroundColor: t.colors.accent },
}));
