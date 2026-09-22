import React, { useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { Check, Search } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { useI18n } from "../../lib/locale-context";
import { Sheet } from "./Sheet";
import { TextField } from "./TextField";

export type SelectOption<T extends string | number> = {
  value: T;
  label: string;
  hint?: string;
  icon?: LucideIcon;
  /** Custom leading node (flag, swatch…). */
  leading?: React.ReactNode;
  disabled?: boolean;
};

/** Bottom sheet with a list of options and a check mark on the current one. */
export function SelectSheet<T extends string | number>({
  visible,
  onClose,
  title,
  options,
  value,
  onSelect,
  searchable = false,
  side,
  snap,
  closeOnSelect = true,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  options: SelectOption<T>[];
  value: T | null;
  onSelect: (value: T) => void;
  searchable?: boolean;
  side?: "bottom" | "right";
  snap?: number | "auto";
  closeOnSelect?: boolean;
}) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <Sheet visible={visible} onClose={onClose} title={title} side={side} snap={snap ?? (searchable ? 0.8 : "auto")}>
      {searchable ? (
        <View style={s.search}>
          <TextField icon={Search} value={query} onChangeText={setQuery} placeholder={tr("search")} autoCorrect={false} height={44} returnKeyType="search" />
        </View>
      ) : null}
      <FlatList
        data={filtered}
        keyExtractor={(o) => String(o.value)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.list}
        renderItem={({ item }) => {
          const active = item.value === value;
          const Icon = item.icon;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: active, disabled: !!item.disabled }}
              disabled={item.disabled}
              onPress={() => {
                onSelect(item.value);
                if (closeOnSelect) onClose();
              }}
              style={({ pressed }) => [s.row, pressed ? s.rowPressed : null, item.disabled ? { opacity: t.opacity.disabled } : null]}
            >
              {item.leading ?? (Icon ? <Icon size={18} color={active ? t.colors.accent : t.colors.muted} strokeWidth={2} /> : null)}
              <View style={s.labels}>
                <Text numberOfLines={1} style={[s.label, active ? { color: t.colors.accent } : null]}>
                  {item.label}
                </Text>
                {item.hint ? (
                  <Text numberOfLines={1} style={s.hint}>
                    {item.hint}
                  </Text>
                ) : null}
              </View>
              {active ? <Check size={18} color={t.colors.accent} strokeWidth={2.5} /> : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={s.empty}>{tr("noResults")}</Text>}
      />
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  search: { paddingHorizontal: 16, paddingBottom: 8 },
  list: { paddingHorizontal: 8, paddingBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 52, paddingHorizontal: 14, borderRadius: t.radii.btn },
  rowPressed: { backgroundColor: t.white(0.06) },
  labels: { flex: 1, minWidth: 0 },
  label: { ...text(15, "medium"), color: t.colors.text },
  hint: { ...text(12), color: t.colors.dim, marginTop: 2 },
  empty: { ...text(14), color: t.colors.dim, textAlign: "center", paddingVertical: 24 },
}));
