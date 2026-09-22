import React, { Children } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { CardSurface } from "../ui/CardSurface";

/**
 * Settings card (desktop `settings/SettingsSection.tsx`): surface with the card
 * radius, a title, an optional description and rows separated by hairlines.
 */
export function SettingsSection({
  title,
  description,
  children,
  style,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  const rows = Children.toArray(children);
  return (
    <CardSurface radius={24} style={[s.card, style]}>
      <Text style={s.title}>{title}</Text>
      {description ? <Text style={s.description}>{description}</Text> : null}
      <View style={s.rows}>
        {rows.map((row, i) => (
          <View key={i} style={i > 0 ? s.divider : null}>
            {row}
          </View>
        ))}
      </View>
    </CardSurface>
  );
}

/**
 * One setting: label (+ hint) on the left, the control on the right. Omit `label` when
 * the section title already names the control. `stacked` puts
 * the control under the label (wide controls: theme grid, segmented controls on phones).
 * With `onPress` the whole row is tappable and shows a chevron (navigation rows).
 */
export function SettingsRow({
  label,
  hint,
  description,
  children,
  stacked = false,
  onPress,
  accessibilityLabel,
}: {
  label?: string;
  hint?: string;
  /** Alias of `hint`. */
  description?: string;
  children?: React.ReactNode;
  stacked?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const s = useStyles();
  const t = useTheme();
  const sub = hint ?? description;
  const body = (
    <>
      {label || sub ? (
        <View style={stacked ? s.labelsStacked : s.labels}>
          {label ? <Text style={s.label}>{label}</Text> : null}
          {sub ? <Text style={s.hint}>{sub}</Text> : null}
        </View>
      ) : null}
      {stacked ? (
        <View style={label || sub ? s.stackedControl : undefined}>{children}</View>
      ) : (
        <View style={s.control}>{children}</View>
      )}
      {onPress ? <ChevronRight size={18} color={t.colors.dim} strokeWidth={2} /> : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        onPress={onPress}
        style={({ pressed }) => [s.row, pressed ? s.rowPressed : null]}
      >
        {body}
      </Pressable>
    );
  }
  return <View style={stacked ? s.stacked : s.row}>{body}</View>;
}

/** Plain block inside a section (lists, forms) that keeps the row padding. */
export function SettingsBlock({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  return <View style={[s.block, style]}>{children}</View>;
}

const useStyles = makeStyles((t) => ({
  card: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  title: { ...text(17, "semibold", { tracking: -0.01 }), color: t.colors.text },
  description: { ...text(13, "regular", { lineHeight: 18 }), color: t.colors.dim, marginTop: 4 },
  rows: { marginTop: 8 },
  divider: { borderTopWidth: 1, borderTopColor: t.white(0.06) },
  row: { flexDirection: "row", alignItems: "center", gap: 16, minHeight: 56, paddingVertical: 12, marginHorizontal: -8, paddingHorizontal: 8, borderRadius: t.radii.btn },
  rowPressed: { backgroundColor: t.white(0.05) },
  stacked: { paddingVertical: 14 },
  labels: { flex: 1, minWidth: 0 },
  labelsStacked: { minWidth: 0 },
  label: { ...text(14, "medium"), color: t.colors.text },
  hint: { ...text(12, "regular", { lineHeight: 16 }), color: t.colors.dim, marginTop: 2 },
  control: { flexShrink: 0, alignItems: "flex-end", maxWidth: "60%" },
  stackedControl: { marginTop: 12 },
  block: { paddingVertical: 12 },
}));
