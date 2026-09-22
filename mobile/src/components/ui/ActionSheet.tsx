import React from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import type { LucideIcon } from "lucide-react-native";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { Sheet } from "./Sheet";

export type SheetAction = {
  key: string;
  label: string;
  icon?: LucideIcon;
  hint?: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Custom trailing node (toggle, badge). */
  trailing?: React.ReactNode;
  onPress: () => void;
};

/**
 * Long-press menu: optional header (thumb / title / subtitle) and rows of
 * icon + label. Closes after a row is pressed unless `keepOpen`.
 */
export function ActionSheet({
  visible,
  onClose,
  title,
  subtitle,
  thumb,
  thumbAspect = 2 / 3,
  actions,
  keepOpen = false,
  side,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Image URL or a custom node. */
  thumb?: string | React.ReactNode | null;
  thumbAspect?: number;
  actions: SheetAction[];
  keepOpen?: boolean;
  side?: "bottom" | "right";
}) {
  const s = useStyles();
  const t = useTheme();
  const thumbH = 72;
  return (
    <Sheet visible={visible} onClose={onClose} side={side} snap="auto">
      {title || thumb ? (
        <View style={s.header}>
          {typeof thumb === "string" ? (
            <Image source={{ uri: thumb }} contentFit="cover" transition={150} style={[s.thumb, { height: thumbH, width: Math.round(thumbH * thumbAspect) }]} />
          ) : (
            thumb ?? null
          )}
          <View style={s.headerText}>
            {title ? (
              <Text numberOfLines={2} style={s.title}>
                {title}
              </Text>
            ) : null}
            {subtitle ? (
              <Text numberOfLines={1} style={s.subtitle}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
      <View style={s.list}>
        {actions.map((a) => {
          const Icon = a.icon;
          const color = a.destructive ? t.colors.accent : t.colors.text;
          return (
            <Pressable
              key={a.key}
              accessibilityRole="button"
              accessibilityState={{ disabled: !!a.disabled }}
              disabled={a.disabled}
              onPress={() => {
                a.onPress();
                if (!keepOpen) onClose();
              }}
              style={({ pressed }) => [s.row, pressed ? s.rowPressed : null, a.disabled ? { opacity: t.opacity.disabled } : null]}
            >
              {Icon ? (
                <View style={s.iconDisc}>
                  <Icon size={18} color={color} strokeWidth={2} />
                </View>
              ) : null}
              <View style={s.labels}>
                <Text numberOfLines={1} style={[s.label, { color }]}>
                  {a.label}
                </Text>
                {a.hint ? (
                  <Text numberOfLines={1} style={s.hint}>
                    {a.hint}
                  </Text>
                ) : null}
              </View>
              {a.trailing}
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  header: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 12 },
  thumb: { borderRadius: 8, backgroundColor: t.white(0.06) },
  headerText: { flex: 1, minWidth: 0 },
  title: { ...text(16, "semibold", { tracking: -0.01 }), color: t.colors.text },
  subtitle: { ...text(13), color: t.colors.dim, marginTop: 3 },
  list: { paddingHorizontal: 8, paddingBottom: 8, borderTopWidth: 1, borderTopColor: t.white(0.06), paddingTop: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 54, paddingHorizontal: 12, borderRadius: t.radii.btn },
  rowPressed: { backgroundColor: t.white(0.06) },
  iconDisc: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.white(0.08), alignItems: "center", justifyContent: "center" },
  labels: { flex: 1, minWidth: 0 },
  label: { ...text(15, "medium") },
  hint: { ...text(12), color: t.colors.dim, marginTop: 2 },
}));
