import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Clock, Plus, RefreshCw, Search, Settings as SettingsIcon, Star, Tv, X } from "lucide-react";
import type { Channel, ChannelGroup, IptvSource, Movie } from "../lib/types";
import { api } from "../lib/api";
import { cn } from "../lib/format";
import { channelToMovie } from "../lib/iptv";
import { useI18n } from "../lib/locale-context";
import { ChannelCard } from "../components/ChannelCard";
import { Shimmer } from "../components/Shimmer";
import { EmptyState } from "../components/EmptyState";
import { LoadMoreButton } from "../components/LoadMoreButton";
import { Select } from "../components/Select";
import { useEpgNow } from "../hooks/useEpgNow";
import { EpgGuide } from "../components/EpgGuide";
import { SegmentedControl } from "../components/settings/SegmentedControl";

const PAGE = 120;

type Selection =
  | { type: "all" }
  | { type: "favorites" }
  | { type: "recent" }
  | { type: "group"; name: string; sourceId: string };

/**
 * TV tab: channels of every IPTV source of the profile, grouped as in the playlist,
 * with the programme on air from the guide, favorites and recently watched channels.
 */
export function LiveTv({
  sources,
  refreshToken = 0,
  onPlay,
  onError,
  onSettings,
  onAddSource,
}: {
  sources: IptvSource[];
  /** Bumped after playback: reloads the page (the Recent list changed). */
  refreshToken?: number;
  onPlay: (movie: Movie) => void;
  onError: (message: string) => void;
  /** Opens Settings › IPTV. */
  onSettings: () => void;
  /** Opens Settings › IPTV with the "add a list" form up. */
  onAddSource?: () => void;
}) {
  const { t } = useI18n();
  const enabled = useMemo(() => sources.filter((s) => s.enabled), [sources]);
  const [sourceId, setSourceId] = useState<string>("");
  const [groups, setGroups] = useState<ChannelGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState("");
  const [selection, setSelection] = useState<Selection>({ type: "all" });
  /** Channel tiles or the programme guide. */
  const [layout, setLayout] = useState<"grid" | "guide">("grid");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Channel[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const request = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const anyLoading = sources.some((s) => s.loading);
  const ready = enabled.some((s) => s.channelCount > 0);
  const names = useMemo(() => new Map(sources.map((s) => [s.id, s.name])), [sources]);

  // Debounced search.
  useEffect(() => {
    const handle = window.setTimeout(() => setQuery(search.trim()), 200);
    return () => window.clearTimeout(handle);
  }, [search]);

  // A source filter that no longer exists falls back to "all".
  useEffect(() => {
    if (sourceId && !enabled.some((s) => s.id === sourceId)) setSourceId("");
  }, [enabled, sourceId]);

  const loadGroups = useCallback(async () => {
    try {
      setGroups(await api.iptvGroups(sourceId || null));
    } catch {
      setGroups([]);
    }
  }, [sourceId]);

  const loadChannels = useCallback(
    async (first: boolean) => {
      // A next page while the first one of a new filter loads would land on the old list.
      if (!first && loading) return;
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
        if (id === request.current) onErrorRef.current(err instanceof Error ? err.message : String(err));
      } finally {
        if (id === request.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection, sourceId, query, items.length, loading],
  );

  // Reload when the playlists change (refresh finished) or the filters do.
  const channelsKey = `${selection.type}|${selection.type === "group" ? `${selection.sourceId}|${selection.name}` : ""}|${sourceId}|${query}`;
  const dataVersion = sources.map((s) => `${s.id}:${s.updatedMs}:${s.enabled}`).join(",");
  useEffect(() => {
    void loadGroups();
    void loadChannels(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelsKey, dataVersion, refreshToken]);

  // Selected group vanished (source removed or refreshed without it): back to all.
  useEffect(() => {
    if (selection.type !== "group" || !groups.length) return;
    if (!groups.some((g) => g.name === selection.name && g.sourceId === selection.sourceId)) setSelection({ type: "all" });
  }, [groups, selection]);

  // Programme guide for the channels on screen, refreshed every minute.
  const epg = useEpgNow(items);

  const play = (channel: Channel) => {
    onPlay(channelToMovie(channel, names.get(channel.sourceId) ?? ""));
  };

  const favorite = async (channel: Channel, on: boolean) => {
    setItems((list) => list.map((c) => (c.id === channel.id ? { ...c, favorite: on } : c)));
    try {
      await api.iptvFavorite(channel.id, on);
      if (selection.type === "favorites" && !on) {
        setItems((list) => list.filter((c) => c.id !== channel.id));
        setTotal((n) => Math.max(0, n - 1));
      }
    } catch (err) {
      setItems((list) => list.map((c) => (c.id === channel.id ? { ...c, favorite: !on } : c)));
      onErrorRef.current(err instanceof Error ? err.message : String(err));
    }
  };

  const refresh = () => {
    api.iptvRefresh(sourceId || null).catch((err) => onErrorRef.current(err instanceof Error ? err.message : String(err)));
  };

  const visibleGroups = useMemo(() => {
    const needle = groupFilter.trim().toLowerCase();
    return needle ? groups.filter((g) => g.name.toLowerCase().includes(needle)) : groups;
  }, [groups, groupFilter]);
  const channelTotal = enabled.reduce((n, s) => n + s.channelCount, 0);
  const groupTotal = groups.length;
  const multiSource = enabled.length > 1 && !sourceId;

  const sideButton = (label: string, active: boolean, onClick: () => void, extra?: string, icon?: ReactNode) => (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-h-10 w-full items-center gap-2.5 rounded-btn px-3 text-left text-[13px] transition-colors duration-150",
        active ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-white/6 hover:text-text",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {extra ? <span className="shrink-0 text-[11px] text-dim tabular">{extra}</span> : null}
    </button>
  );

  const grid = "grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4";

  if (!sources.length) {
    return (
      <div className="page-enter px-page pt-24 pb-16">
        <EmptyState
          large
          icon={<Tv size={26} />}
          title={t("iptvNoSources")}
          hint={t("iptvNoSourcesHint")}
          action={{ label: t("iptvAddList"), icon: <Plus size={16} />, onClick: onAddSource ?? onSettings }}
        />
      </div>
    );
  }

  return (
    <div className="page-enter px-page pt-24 pb-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-[28px] font-semibold tracking-[-0.02em]">
            <Tv size={26} className="text-accent" />
            {t("liveTv")}
          </h1>
          <p className="mt-1 text-[13px] text-dim">
            {anyLoading && !ready
              ? t("iptvLoading")
              : `${channelTotal === 1 ? t("iptvChannelsOne") : t("iptvChannels", { n: channelTotal })} · ${groupTotal === 1 ? t("iptvGroupsOne") : t("iptvGroups", { n: groupTotal })}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex items-center">
            <span className="sr-only">{t("searchChannels")}</span>
            <Search size={15} className="pointer-events-none absolute left-3 text-dim" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchChannels")}
              className="field-own-focus h-10 w-[240px] max-w-full rounded-pill bg-white/6 pr-9 pl-9 text-[13px] text-text outline-none placeholder:text-dim hover:bg-white/8 focus:bg-white/10 focus-visible:ring-2 focus-visible:ring-accent/50"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label={t("close")}
                className="absolute right-2 grid h-6 w-6 place-items-center rounded-full text-dim hover:bg-white/10 hover:text-text"
              >
                <X size={13} />
              </button>
            ) : null}
          </label>
          <SegmentedControl
            label={t("guideLayout")}
            value={layout}
            onChange={setLayout}
            options={[
              { value: "grid", label: t("guideChannels") },
              { value: "guide", label: t("guideTitle") },
            ]}
          />
          {enabled.length > 1 ? (
            <Select
              label={t("iptvSource")}
              value={sourceId}
              onChange={(next) => {
                setSourceId(next);
                setSelection({ type: "all" });
              }}
              variant="pill"
              options={[{ value: "", label: t("iptvAllSources") }, ...enabled.map((s) => ({ value: s.id, label: s.name }))]}
            />
          ) : null}
          <button
            type="button"
            onClick={refresh}
            disabled={anyLoading}
            aria-label={t("iptvRefresh")}
            title={t("iptvRefresh")}
            className="icon-hit grid h-10 w-10 place-items-center rounded-full bg-white/6 text-text hover:bg-white/10 disabled:opacity-60"
          >
            <RefreshCw size={16} className={anyLoading ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={onSettings}
            aria-label={t("iptv")}
            title={t("iptv")}
            className="icon-hit grid h-10 w-10 place-items-center rounded-full bg-white/6 text-text hover:bg-white/10"
          >
            <SettingsIcon size={16} />
          </button>
        </div>
      </div>

      {enabled.some((s) => s.error) ? (
        <div className="mb-6 rounded-card bg-danger/12 px-5 py-3 text-[13px] text-danger">
          {enabled
            .filter((s) => s.error)
            .map((s) => `${s.name}: ${s.error}`)
            .join(" · ")}
        </div>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[250px_minmax(0,1fr)] md:gap-8">
        <nav
          aria-label={t("iptvGroupsLabel")}
          // Narrow windows stack the list above the channels: cap it so the channels stay in reach.
          className="max-md:max-h-[40vh] max-md:overflow-y-auto max-md:rounded-card max-md:bg-surface max-md:p-2 md:sticky md:top-24 md:max-h-[calc(100vh-140px)] md:overflow-y-auto md:pr-1"
        >
          <div className="space-y-0.5">
            {sideButton(t("allChannels"), selection.type === "all", () => setSelection({ type: "all" }), String(channelTotal), <Tv size={15} />)}
            {sideButton(t("favorites"), selection.type === "favorites", () => setSelection({ type: "favorites" }), undefined, <Star size={15} />)}
            {sideButton(t("recent"), selection.type === "recent", () => setSelection({ type: "recent" }), undefined, <Clock size={15} />)}
          </div>
          {!groups.length && (loading || (anyLoading && !ready)) ? (
            <div className="mt-5 space-y-1.5 px-3" aria-hidden>
              <Shimmer className="mb-3 h-3 w-20 rounded" />
              {Array.from({ length: 8 }).map((_, i) => (
                <Shimmer key={i} className="h-7 rounded-btn" delay={i * 60} />
              ))}
            </div>
          ) : groups.length ? (
            <>
              <p className="mt-5 mb-2 px-3 text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">{t("iptvGroupsLabel")}</p>
              {groups.length > 20 ? (
                <input
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  placeholder={t("filterGroups")}
                  aria-label={t("filterGroups")}
                  className="field-own-focus mb-2 h-9 w-full rounded-btn bg-white/6 px-3 text-[13px] text-text outline-none placeholder:text-dim focus:bg-white/10 focus-visible:ring-2 focus-visible:ring-accent/50"
                />
              ) : null}
              <div className="space-y-0.5">
                {visibleGroups.map((g) => {
                  const active = selection.type === "group" && selection.name === g.name && selection.sourceId === g.sourceId;
                  const label = g.name || t("noGroup");
                  return sideButton(
                    multiSource ? `${label} · ${names.get(g.sourceId) ?? ""}` : label,
                    active,
                    () => setSelection({ type: "group", name: g.name, sourceId: g.sourceId }),
                    String(g.count),
                  );
                })}
              </div>
            </>
          ) : null}
        </nav>

        <div className="min-w-0">
          {(loading || (anyLoading && selection.type === "all" && !query)) && !items.length ? (
            <div className={grid}>
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i}>
                  <Shimmer className="aspect-video rounded-poster" delay={i * 40} />
                  <Shimmer className="mt-2 h-3.5 w-3/4 rounded" delay={i * 40} />
                </div>
              ))}
            </div>
          ) : items.length && layout === "guide" ? (
            <>
              <EpgGuide channels={items} onPlay={play} />
              {items.length < total ? (
                <LoadMoreButton
                  loading={loading || loadingMore}
                  onLoad={() => void loadChannels(false)}
                  remaining={total - items.length}
                />
              ) : null}
            </>
          ) : items.length ? (
            <>
              <div className={grid}>
                {items.map((channel, i) => (
                  <ChannelCard
                    key={channel.id}
                    channel={channel}
                    epg={epg[channel.id]}
                    onPlay={play}
                    onFavorite={(c, on) => void favorite(c, on)}
                    delay={Math.min(i, 24) * 15}
                  />
                ))}
              </div>
              {items.length < total ? (
                <LoadMoreButton
                  loading={loading || loadingMore}
                  onLoad={() => void loadChannels(false)}
                  remaining={total - items.length}
                />
              ) : null}
            </>
          ) : (
            <EmptyState
              title={
                selection.type === "favorites"
                  ? t("noFavoriteChannels")
                  : selection.type === "recent"
                    ? t("noRecentChannels")
                    : anyLoading
                      ? t("iptvLoading")
                      : t("noChannels")
              }
              hint={selection.type === "favorites" ? t("noFavoriteChannelsHint") : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}
