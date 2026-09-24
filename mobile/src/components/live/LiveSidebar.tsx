import React, { useMemo, useState } from "react";
import { FlatList, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Bell, Clock, Star, Tv } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import type { ChannelGroup } from "../../lib/types";
import { useI18n } from "../../lib/locale-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { PressableScale } from "../ui/PressableScale";
import { TextField } from "../ui/TextField";
import { NavListSkeleton } from "../ui/Skeletons";

/** Width of the tablet sidebar (desktop `md:grid-cols-[250px_1fr]`). */
export const SIDEBAR_WIDTH = 250;

/** More groups than this and the list gets its own filter field. */
const FILTER_FROM = 20;

export type Selection =
  | { type: "all" }
  | { type: "favorites" }
  | { type: "recent" }
  | { type: "reminders" }
  | { type: "group"; name: string; sourceId: string };

export type LiveNavListProps = {
  selection: Selection;
  onSelect: (selection: Selection) => void;
  groups: ChannelGroup[];
  /** Channels of every enabled list (shown next to "All channels"). */
  channelTotal: number;
  /** Source id → list name, to tell apart groups with the same name. */
  names: Map<string, string>;
  /** Several lists are shown at once: append the list name to each group. */
  multiSource: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Pending programme reminders (shown next to "Reminders"). */
  reminderCount?: number;
  /** The groups are loading: placeholder rows instead of the list. */
  loading?: boolean;
};

/** All / Favorites / Recent plus the groups of the playlists, as a scrolling list. */
export function LiveNavList({
  selection,
  onSelect,
  groups,
  channelTotal,
  names,
  multiSource,
  contentStyle,
  reminderCount = 0,
  loading = false,
}: LiveNavListProps) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const [filter, setFilter] = useState("");

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? groups.filter((g) => g.name.toLowerCase().includes(needle)) : groups;
  }, [groups, filter]);

  const row = (label: string, active: boolean, press: () => void, extra?: string, Icon?: LucideIcon, key?: string) => (
    <PressableScale
      key={key ?? label}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={press}
      scaleTo={0.985}
      style={[s.row, active ? s.rowActive : null]}
    >
      {Icon ? <Icon size={16} color={active ? t.colors.accent : t.colors.muted} strokeWidth={2} /> : null}
      <Text numberOfLines={1} style={[s.label, active ? s.labelActive : null]}>
        {label}
      </Text>
      {extra ? <Text style={s.count}>{extra}</Text> : null}
    </PressableScale>
  );

  const header = (
    <View>
      {row(tr("allChannels"), selection.type === "all", () => onSelect({ type: "all" }), String(channelTotal), Tv, "all")}
      {row(tr("favorites"), selection.type === "favorites", () => onSelect({ type: "favorites" }), undefined, Star, "favorites")}
      {row(tr("recent"), selection.type === "recent", () => onSelect({ type: "recent" }), undefined, Clock, "recent")}
      {row(
        tr("reminders"),
        selection.type === "reminders",
        () => onSelect({ type: "reminders" }),
        reminderCount ? String(reminderCount) : undefined,
        Bell,
        "reminders",
      )}
      {loading && !groups.length ? <NavListSkeleton /> : null}
      {groups.length ? (
        <>
          <Text style={s.section}>{tr("iptvGroupsLabel")}</Text>
          {groups.length > FILTER_FROM ? (
            <TextField
              value={filter}
              onChangeText={setFilter}
              placeholder={tr("filterGroups")}
              accessibilityLabel={tr("filterGroups")}
              autoCorrect={false}
              autoCapitalize="none"
              height={44}
              containerStyle={s.filter}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );

  return (
    <FlatList
      data={visible}
      keyExtractor={(g) => `${g.sourceId}|${g.name}`}
      ListHeaderComponent={header}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[s.content, contentStyle]}
      initialNumToRender={24}
      windowSize={9}
      extraData={selection}
      renderItem={({ item }) => {
        const active = selection.type === "group" && selection.name === item.name && selection.sourceId === item.sourceId;
        const name = item.name || tr("noGroup");
        const label = multiSource ? `${name} · ${names.get(item.sourceId) ?? ""}` : name;
        return row(label, active, () => onSelect({ type: "group", name: item.name, sourceId: item.sourceId }), String(item.count), undefined, `${item.sourceId}|${item.name}`);
      }}
    />
  );
}

/** The ≥ 768 dp sidebar: the group navigator on its own 250 dp column. */
export function LiveSidebar(props: LiveNavListProps & { style?: StyleProp<ViewStyle> }) {
  const { style, ...list } = props;
  const s = useStyles();
  const { t: tr } = useI18n();
  return (
    <View accessibilityLabel={tr("iptvGroupsLabel")} style={[s.sidebar, style]}>
      <LiveNavList {...list} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  sidebar: { width: SIDEBAR_WIDTH },
  content: { paddingBottom: 24, gap: 2 },
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    borderRadius: t.radii.btn,
  },
  rowActive: { backgroundColor: t.colors.accentSoft },
  label: { ...text(13, "regular"), color: t.colors.muted, flex: 1, minWidth: 0 },
  labelActive: { ...text(13, "semibold"), color: t.colors.accent },
  count: { ...text(11, "regular", { tabular: true }), color: t.colors.dim },
  section: { ...text(11, "semibold", { tracking: 0.08, uppercase: true }), color: t.colors.dim, paddingHorizontal: 12, marginTop: 18, marginBottom: 8 },
  filter: { marginBottom: 6 },
}));
