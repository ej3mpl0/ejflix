import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { CalendarClock, CircleAlert, LayoutGrid, ListFilter, RefreshCw, Search, Settings as SettingsIcon, Tv, X } from "lucide-react-native";
import type { Channel, ChannelGroup, EpgNow, IptvStatus } from "../lib/types";
import { api } from "../lib/api";
import { channelToMovie } from "../lib/iptv";
import { useI18n } from "../lib/locale-context";
import { useToast } from "../lib/toast-context";
import { usePlay } from "../lib/play";
import type { MainStackParamList } from "../navigation/types";
import { makeStyles, useTheme } from "../theme/ThemeProvider";
import { useLayout } from "../theme/responsive";
import { text } from "../theme/typography";
import { EmptyCard } from "../components/ui/EmptyCard";
import { IconButton } from "../components/ui/IconButton";
import { Pill } from "../components/ui/Pill";
import { SelectSheet } from "../components/ui/SelectSheet";
import { Shimmer } from "../components/ui/Shimmer";
import { Spinner } from "../components/ui/Spinner";
import { TextField } from "../components/ui/TextField";
import { TAB_BAR_HEIGHT } from "../components/ui/Toast";
import { ChannelCard, EpgGuide, GroupsSheet, LiveSidebar, SIDEBAR_WIDTH, type Selection } from "../components/live";

const PAGE = 120;
const EPG_REFRESH_MS = 60_000;
/** Gap between the tablet sidebar and the grid. */
const SIDEBAR_GAP = 24;
const SEARCH_DEBOUNCE_MS = 200;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Pill labels are laid out at their natural width: keep long group names short. */
function short(value: string, max = 22): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * TV tab: channels of every IPTV list of the profile, grouped as in the playlist,
 * with the programme on air from the guide, favorites and recently watched channels.
 * Tablets (≥ 768 dp) get the desktop sidebar; phones pick the group in a sheet.
 */
export function LiveTvScreen() {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { toast } = useToast();
  const play = usePlay();
  const layout = useLayout();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { wide, sizeClass, pagePad, rail, insets } = layout;

  /** Channel tiles or the programme guide. */
  const [layoutMode, setLayoutMode] = useState<"grid" | "guide">("grid");
  const [status, setStatus] = useState<IptvStatus | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [groups, setGroups] = useState<ChannelGroup[]>([]);
  const [selection, setSelection] = useState<Selection>({ type: "all" });
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Channel[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [epg, setEpg] = useState<Record<string, EpgNow>>({});
  const [sheet, setSheet] = useState<"source" | "groups" | null>(null);

  const request = useRef(0);
  const alive = useRef(true);
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const sources = status?.sources ?? [];
  const enabled = useMemo(() => sources.filter((src) => src.enabled), [status]);
  const names = useMemo(() => new Map(sources.map((src) => [src.id, src.name])), [status]);
  const namesRef = useRef(names);
  namesRef.current = names;
  const anyLoading = (status?.loading ?? false) || sources.some((src) => src.loading);
  const ready = enabled.some((src) => src.channelCount > 0);
  const channelTotal = enabled.reduce((n, src) => n + src.channelCount, 0);
  const multiSource = enabled.length > 1 && !sourceId;

  // ---- lists ----

  const loadStatus = useCallback(async () => {
    try {
      const next = await api.iptvStatus();
      if (alive.current) setStatus(next);
    } catch {
      if (alive.current) setStatus({ sources: [], loading: false });
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const unlisten = api.onIptvChanged(() => void loadStatus());
    return () => {
      void unlisten.then((fn) => fn()).catch(() => undefined);
    };
  }, [loadStatus]);

  // Debounced search.
  useEffect(() => {
    const handle = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [search]);

  // A list filter that no longer exists falls back to "all lists".
  const enabledKey = enabled.map((src) => src.id).join(",");
  useEffect(() => {
    if (sourceId && !enabled.some((src) => src.id === sourceId)) setSourceId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey, sourceId]);

  const loadGroups = useCallback(async () => {
    try {
      const next = await api.iptvGroups(sourceId || null);
      if (alive.current) setGroups(next);
    } catch {
      if (alive.current) setGroups([]);
    }
  }, [sourceId]);

  const loadChannels = useCallback(
    async (first: boolean) => {
      const id = ++request.current;
      if (first) setLoading(true);
      else setLoadingMore(true);
      try {
        const page = await api.iptvChannels({
          sourceId: selection.type === "group" ? selection.sourceId : sourceId || null,
          group: selection.type === "group" ? selection.name : null,
          search: query || null,
          favorites: selection.type === "favorites",
          recent: selection.type === "recent",
          offset: first ? 0 : items.length,
          limit: PAGE,
        });
        if (id !== request.current) return;
        setItems((previous) => (first ? page.items : [...previous, ...page.items]));
        setTotal(page.total);
      } catch (err) {
        if (id === request.current) toastRef.current(errorText(err));
      } finally {
        if (id === request.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [selection, sourceId, query, items.length],
  );

  const loadRef = useRef({ groups: loadGroups, channels: loadChannels });
  loadRef.current = { groups: loadGroups, channels: loadChannels };

  // Reload when the playlists change (a refresh finished) or the filters do.
  const channelsKey = `${selection.type}|${selection.type === "group" ? `${selection.sourceId}|${selection.name}` : ""}|${sourceId}|${query}`;
  const dataVersion = sources.map((src) => `${src.id}:${src.updatedMs}:${src.enabled}`).join(",");
  const hasStatus = status != null;
  useEffect(() => {
    if (!hasStatus) return;
    void loadRef.current.groups();
    void loadRef.current.channels(true);
  }, [channelsKey, dataVersion, hasStatus]);

  // The selected group vanished (list removed or refreshed without it): back to all.
  useEffect(() => {
    if (selection.type !== "group" || !groups.length) return;
    if (!groups.some((g) => g.name === selection.name && g.sourceId === selection.sourceId)) setSelection({ type: "all" });
  }, [groups, selection]);

  // ---- programme guide ----

  const ids = useMemo(() => items.filter((c) => c.epg).map((c) => c.id), [items]);
  const idsKey = ids.join(",");
  const idsRef = useRef<string[]>(ids);
  idsRef.current = ids;

  const loadEpg = useCallback(() => {
    const list = idsRef.current;
    if (!list.length) return;
    api
      .iptvEpgNow(list)
      .then((map) => {
        if (alive.current) setEpg((previous) => ({ ...previous, ...map }));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadEpg();
    const handle = setInterval(loadEpg, EPG_REFRESH_MS);
    return () => clearInterval(handle);
  }, [idsKey, loadEpg]);

  // Back on screen: fresh guide, and fresh "Recent" (something may have been watched).
  const onFocus = useRef<() => void>(() => undefined);
  onFocus.current = () => {
    loadEpg();
    if (selectionRef.current.type === "recent") void loadRef.current.channels(true);
  };
  useFocusEffect(
    useCallback(() => {
      onFocus.current();
    }, []),
  );

  // ---- actions ----

  const playChannel = useCallback(
    (channel: Channel) => {
      play(channelToMovie(channel, namesRef.current.get(channel.sourceId) ?? ""));
    },
    [play],
  );

  const favorite = useCallback((channel: Channel, on: boolean) => {
    setItems((list) => list.map((c) => (c.id === channel.id ? { ...c, favorite: on } : c)));
    api
      .iptvFavorite(channel.id, on)
      .then(() => {
        if (selectionRef.current.type === "favorites" && !on) {
          setItems((list) => list.filter((c) => c.id !== channel.id));
          setTotal((n) => Math.max(0, n - 1));
        }
      })
      .catch((err: unknown) => {
        setItems((list) => list.map((c) => (c.id === channel.id ? { ...c, favorite: !on } : c)));
        toastRef.current(errorText(err));
      });
  }, []);

  const refresh = useCallback(() => {
    api.iptvRefresh(sourceId || null).catch((err: unknown) => toastRef.current(errorText(err)));
  }, [sourceId]);

  const openSettings = useCallback(() => navigation.navigate("SettingsSection", { section: "iptv" }), [navigation]);

  // ---- geometry ----

  const gridMin = sizeClass === "compact" ? 160 : 200;
  const { cols, itemW } = useMemo(() => {
    if (!wide) return layout.grid(gridMin);
    const usable = layout.width - 2 * pagePad - SIDEBAR_WIDTH - SIDEBAR_GAP;
    const columns = Math.max(1, Math.floor((usable + rail) / (gridMin + rail)));
    return { cols: columns, itemW: Math.floor((usable - (columns - 1) * rail) / columns) };
  }, [layout, wide, gridMin, pagePad, rail]);
  const gridPad = wide ? 0 : pagePad;
  const bottomPad = TAB_BAR_HEIGHT + insets.bottom + 24;

  const renderItem = useCallback(
    ({ item }: { item: Channel }) => (
      <ChannelCard channel={item} epg={epg[item.id]} width={itemW} onPlay={playChannel} onFavorite={favorite} />
    ),
    [epg, itemW, playChannel, favorite],
  );

  // ---- chrome ----

  const sourceLabel = sourceId ? (names.get(sourceId) ?? tr("iptvAllSources")) : tr("iptvAllSources");
  const selectionLabel =
    selection.type === "all"
      ? tr("allChannels")
      : selection.type === "favorites"
        ? tr("favorites")
        : selection.type === "recent"
          ? tr("recent")
          : selection.name || tr("noGroup");

  const errorLines = enabled.filter((src) => src.error).map((src) => `${src.name}: ${src.error}`);
  const epgErrorLines = enabled.filter((src) => !src.error && src.epgError).map((src) => `${src.name}: ${tr("iptvEpgError")}`);

  const searchField = (
    <TextField
      icon={Search}
      value={search}
      onChangeText={setSearch}
      placeholder={tr("searchChannels")}
      accessibilityLabel={tr("searchChannels")}
      autoCorrect={false}
      autoCapitalize="none"
      returnKeyType="search"
      height={48}
      containerStyle={wide ? s.searchWide : s.searchFull}
      right={search ? <IconButton icon={X} label={tr("close")} hit={40} size={16} onPress={() => setSearch("")} /> : undefined}
    />
  );

  const controls = (
    <>
      <Pill
        pill
        icon={layoutMode === "guide" ? LayoutGrid : CalendarClock}
        label={layoutMode === "guide" ? tr("guideChannels") : tr("guideTitle")}
        accessibilityLabel={tr("guideLayout")}
        onPress={() => setLayoutMode((mode) => (mode === "guide" ? "grid" : "guide"))}
      />
      {enabled.length > 1 ? (
        <Pill pill icon={ListFilter} label={short(sourceLabel)} accessibilityLabel={`${tr("iptvSource")}: ${sourceLabel}`} onPress={() => setSheet("source")} />
      ) : null}
      {!wide ? (
        <Pill
          pill
          icon={LayoutGrid}
          label={short(selectionLabel)}
          accessibilityLabel={`${tr("iptvGroupsLabel")}: ${selectionLabel}`}
          onPress={() => setSheet("groups")}
        />
      ) : null}
      {anyLoading ? (
        <View style={s.busy}>
          <Spinner size={18} />
        </View>
      ) : (
        <IconButton icon={RefreshCw} label={tr("iptvRefresh")} variant="tonal" size={18} onPress={refresh} />
      )}
      <IconButton icon={SettingsIcon} label={tr("iptv")} variant="tonal" size={18} onPress={openSettings} />
    </>
  );

  const header = (
    <View style={[s.header, { paddingTop: insets.top + 20, paddingHorizontal: pagePad }]}>
      <View style={s.headRow}>
        <View style={s.titleBox}>
          <View style={s.titleRow}>
            <Tv size={26} color={t.colors.accent} strokeWidth={2.2} />
            <Text style={s.title}>{tr("liveTv")}</Text>
          </View>
          <Text style={s.hint}>
            {anyLoading && !ready
              ? tr("iptvLoading")
              : `${tr("iptvChannels", { n: channelTotal })} · ${tr("iptvGroups", { n: groups.length })}`}
          </Text>
        </View>
        {wide ? <View style={s.actions}>{searchField}{controls}</View> : null}
      </View>
      {!wide ? (
        <View style={s.filters}>
          {searchField}
          <View style={s.chipRow}>{controls}</View>
        </View>
      ) : null}
      {errorLines.length ? (
        <View style={[s.banner, s.bannerError]}>
          <CircleAlert size={15} color={t.colors.accent} strokeWidth={2} />
          <Text style={[s.bannerText, s.bannerTextError]}>{errorLines.join(" · ")}</Text>
        </View>
      ) : null}
      {epgErrorLines.length ? (
        <View style={s.banner}>
          <Text style={s.bannerText}>{epgErrorLines.join(" · ")}</Text>
        </View>
      ) : null}
      {anyLoading && ready ? (
        <View style={s.banner}>
          <Spinner size={14} color={t.colors.muted} />
          <Text style={s.bannerText}>{tr("iptvLoading")}</Text>
        </View>
      ) : null}
    </View>
  );

  const skeleton = (
    <View style={[s.skeleton, { paddingHorizontal: gridPad, gap: rail }]}>
      {Array.from({ length: cols * 3 }).map((_, i) => (
        <View key={i} style={{ width: itemW }}>
          <Shimmer width={itemW} height={Math.round((itemW * 9) / 16)} radius={t.radii.poster} delay={(i % cols) * 60} />
          <Shimmer width={Math.round(itemW * 0.7)} height={12} radius={6} delay={(i % cols) * 60} style={s.skeletonLine} />
        </View>
      ))}
    </View>
  );

  const empty = (
    <View style={[s.empty, { paddingHorizontal: gridPad }]}>
      <Text style={s.emptyTitle}>
        {selection.type === "favorites"
          ? tr("noFavoriteChannels")
          : selection.type === "recent"
            ? tr("noRecentChannels")
            : anyLoading
              ? tr("iptvLoading")
              : tr("noChannels")}
      </Text>
      {selection.type === "favorites" ? <Text style={s.emptyHint}>{tr("noFavoriteChannelsHint")}</Text> : null}
    </View>
  );

  const footer =
    items.length < total ? (
      <View style={s.footer}>
        <Pill pill label={`${tr("loadMore")} (${total - items.length})`} loading={loadingMore} onPress={() => void loadChannels(false)} />
      </View>
    ) : null;

  const sheets = (
    <>
      <SelectSheet<string>
        visible={sheet === "source"}
        onClose={() => setSheet(null)}
        title={tr("iptvSource")}
        value={sourceId}
        options={[
          { value: "", label: tr("iptvAllSources") },
          ...enabled.map((src) => ({ value: src.id, label: src.name, hint: tr("iptvChannels", { n: src.channelCount }) })),
        ]}
        onSelect={(value) => {
          setSourceId(value);
          setSelection({ type: "all" });
        }}
      />
      <GroupsSheet
        visible={sheet === "groups"}
        onClose={() => setSheet(null)}
        selection={selection}
        onSelect={setSelection}
        groups={groups}
        channelTotal={channelTotal}
        names={names}
        multiSource={multiSource}
      />
    </>
  );

  if (status && !sources.length) {
    return (
      <View style={s.root}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.noSources, { paddingTop: insets.top + 48, paddingBottom: bottomPad, paddingHorizontal: pagePad }]}
        >
          <EmptyCard
            icon={Tv}
            title={tr("iptvNoSources")}
            hint={tr("iptvNoSourcesHint")}
            actionLabel={tr("iptvGoToSettings")}
            onAction={openSettings}
            style={s.noSourcesCard}
          />
        </ScrollView>
      </View>
    );
  }

  const grid = layoutMode === "guide" ? (
    <EpgGuide
      channels={items}
      onPlay={playChannel}
      header={wide ? undefined : header}
      footer={footer}
      contentPadding={{ horizontal: gridPad, bottom: bottomPad }}
    />
  ) : (
    <FlatList
      key={`live-${cols}`}
      data={items}
      keyExtractor={(channel) => channel.id}
      renderItem={renderItem}
      numColumns={cols}
      columnWrapperStyle={cols > 1 ? { gap: rail } : undefined}
      ListHeaderComponent={wide ? undefined : header}
      ListEmptyComponent={loading ? skeleton : empty}
      ListFooterComponent={footer}
      contentContainerStyle={{ paddingHorizontal: gridPad, rowGap: rail + 6, paddingBottom: bottomPad }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      initialNumToRender={cols * 4}
      maxToRenderPerBatch={cols * 3}
      windowSize={7}
      removeClippedSubviews
      extraData={epg}
      style={wide ? s.gridPane : undefined}
    />
  );

  return (
    <View style={s.root}>
      {wide ? (
        <>
          {header}
          <View style={[s.panes, { paddingHorizontal: pagePad, gap: SIDEBAR_GAP }]}>
            <LiveSidebar
              selection={selection}
              onSelect={setSelection}
              groups={groups}
              channelTotal={channelTotal}
              names={names}
              multiSource={multiSource}
              contentStyle={{ paddingBottom: bottomPad }}
            />
            {grid}
          </View>
        </>
      ) : (
        grid
      )}
      {sheets}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.base },
  header: { paddingBottom: 18 },
  headRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 },
  titleBox: { minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { ...text(28, "semibold", { tracking: -0.02 }), color: t.colors.text },
  hint: { ...text(13), color: t.colors.dim, marginTop: 4 },
  actions: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
  filters: { marginTop: 16, gap: 10 },
  chipRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  searchWide: { width: 240 },
  searchFull: { width: "100%" },
  busy: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: t.white(0.08) },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: t.radii.btn,
    backgroundColor: t.white(0.06),
  },
  bannerError: { backgroundColor: "rgba(255, 107, 107, 0.12)" },
  bannerText: { ...text(13, "regular", { lineHeight: 18 }), color: t.colors.muted, flex: 1 },
  bannerTextError: { color: t.colors.danger },
  panes: { flex: 1, flexDirection: "row" },
  gridPane: { flex: 1 },
  skeleton: { flexDirection: "row", flexWrap: "wrap" },
  skeletonLine: { marginTop: 8 },
  empty: { paddingVertical: 40, alignItems: "center" },
  emptyTitle: { ...text(16, "medium"), color: t.colors.text, textAlign: "center" },
  emptyHint: { ...text(13), color: t.colors.dim, textAlign: "center", marginTop: 6 },
  footer: { alignItems: "center", paddingTop: 28 },
  noSources: { flexGrow: 1, alignItems: "center" },
  noSourcesCard: { width: "100%", maxWidth: 560 },
}));
