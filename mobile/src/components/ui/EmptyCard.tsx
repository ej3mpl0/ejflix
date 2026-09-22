import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { CardSurface } from "./CardSurface";
import { Pill } from "./Pill";

/** "Nothing here yet" block: icon disc, title, hint and an optional action. */
export function EmptyCard({
  icon: Icon,
  title,
  hint,
  actionLabel,
  onAction,
  style,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  const t = useTheme();
  return (
    <CardSurface style={[s.card, style]}>
      {Icon ? (
        <View style={s.disc}>
          <Icon size={24} color={t.colors.accent} strokeWidth={2} />
        </View>
      ) : null}
      <Text style={s.title}>{title}</Text>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
      {actionLabel && onAction ? <Pill variant="primary" size="sm" label={actionLabel} onPress={onAction} style={{ marginTop: 16 }} /> : null}
    </CardSurface>
  );
}

const useStyles = makeStyles((t) => ({
  card: { alignItems: "center", paddingVertical: 32, paddingHorizontal: 24 },
  disc: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: t.colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: { ...text(16, "semibold"), color: t.colors.text, textAlign: "center" },
  hint: { ...text(13, "regular", { lineHeight: 19 }), color: t.colors.dim, textAlign: "center", marginTop: 6, maxWidth: 360 },
}));
