import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Compass } from "lucide-react-native";
import type { AddonCatalog, AddonInfo, BrowseSort, Movie } from "../lib/types";
import { hasServer as sessionHasServer } from "../lib/types";
import { api } from "../lib/api";
import { metaToMovie } from "../lib/addons";
import { useI18n } from "../lib/locale-context";
import { useSettings } from "../lib/settings-context";
import { useSession } from "../lib/session-context";
import { useToast } from "../lib/toast-context";
import { usePlay } from "../lib/play";
import { openDetails } from "../navigation/navigationRef";
import { makeStyles, useTheme } from "../theme/ThemeProvider";
import { useLayout } from "../theme/responsive";
import { text } from "../theme/typography";
import { Chip } from "../components/ui/Chip";
import { EmptyCard } from "../components/ui/EmptyCard";
import { Pill } from "../components/ui/Pill";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { SelectSheet } from "../components/ui/SelectSheet";
import { GridSkeleton } from "../components/ui/Skeletons";
import { TAB_BAR_HEIGHT } from "../components/ui/Toast";
import { PickerPill } from "../components/settings/LanguagePicker";
import { PosterGrid } from "../components/media/PosterGrid";

type Source = "all" | "server" | "online";
type Kind = "movie" | "series";

const SERVER_PAGE = 40;
const MAX_CATALOGS = 6;
const MAX_ONLINE_PER_PAGE = 60;
const FIRST_YEAR = 1950;

function sameGenre(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Discover tab: browse by type, genre, year and (server only) sort order across the
 * Jellyfin library and every addon catalog that supports the genre filter. Server
 * copies win over online duplicates of the same IMDb id.
 */
export function DiscoverScreen() {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { settings } = useSettings();
  const { session } = useSession();
  const { toast } = useToast();
  const play = usePlay();
  const { insets, pagePad } = useLayout();
  const hasServer = sessionHasServer(session);
  const addonsKey = `${settings.addons.urls.join("|")}|${settings.addons.cinemeta}`;
  const [addons, setAddons] = useState<AddonInfo[] | null>(null);
  const [serverGenres, setServerGenres] = useState<string[]>([]);
  const [source, setSource] = useState<Source>("all");
  const [kind, setKind] = useState<Kind>("movie");
  const [genre, setGenre] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [sort, setSort] = useState<BrowseSort>("popular");
  const [items, setItems] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sheet, setSheet] = useState<"year" | "sort" | null>(null);
  const request = useRef(0);
  const page = useRef(0);
  const serverDone = useRef(false);
  const catalogSkip = useRef<Record<string, number>>({});
  const catalogDone = useRef<Record<string, boolean>>({});
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const hasAddons = (addons?.length ?? 0) > 0;
  const useServer = hasServer && source !== "online";
  const useOnline = hasAddons && source !== "server";

  useEffect(() => {
    let alive = true;
    api
      .addonsList()
      .then((list) => {
        if (alive) setAddons(list);
      })
      .catch(() => {
        if (alive) setAddons([]);
      });
    return () => {
      alive = false;
    };
  }, [addonsKey]);

  useEffect(() => {
    if (!hasServer) return;
    let alive = true;
    api
      .getGenres()
      .then((list) => {
        if (alive) setServerGenres(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hasServer]);

  /** Catalogs of the chosen type; with a genre set, only those that can filter by it. */
  const catalogs = useMemo<AddonCatalog[]>(() => {
    if (!useOnline || !addons) return [];
    return addons
      .flatMap((addon) => addon.catalogs)
      .filter((c) => c.type === kind)
      .filter((c) => (genre ? c.genres.some((g) => sameGenre(g, genre)) : !c.requiresExtra))
      .slice(0, MAX_CATALOGS);
  }, [addons, kind, genre, useOnline]);

  const genres = useMemo(() => {
    const out: string[] = [];
    const push = (name: string) => {
      if (name && !out.some((g) => sameGenre(g, name))) out.push(name);
    };
    if (useServer) serverGenres.forEach(push);
    if (useOnline && addons) {
      for (const c of addons.flatMap((addon) => addon.catalogs)) {
        if (c.type === kind) c.genres.forEach(push);
      }
    }
    // Some catalogs (Cinemeta's "by year") expose years as genre options. Keep them, but
    // behind the real genres: on a phone they would otherwise fill the whole chip row.
    const isYear = (name: string) => /^\d{4}$/.test(name);
    return out.sort((a, b) => {
      const ya = isYear(a);
      const yb = isYear(b);
      if (ya !== yb) return ya ? 1 : -1;
      return ya ? Number(b) - Number(a) : a.localeCompare(b);
    });
  }, [serverGenres, addons, kind, useServer, useOnline]);

  const years = useMemo(() => {
    const now = new Date().getFullYear() + 1;
    const list: number[] = [];
    for (let y = now; y >= FIRST_YEAR; y--) list.push(y);
    return list;
  }, []);

  const fetchPage = useCallback(
    async (first: boolean) => {
      const id = ++request.current;
      if (first) {
        page.current = 0;
        serverDone.current = !useServer;
        catalogSkip.current = {};
        catalogDone.current = {};
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      const current = page.current;
      const serverJob: Promise<Movie[]> =
        useServer && !serverDone.current
          ? api
              .browseItems({ type: kind, genre, year, sort, start: current * SERVER_PAGE, limit: SERVER_PAGE })
              .then((list) => {
                if (list.length < SERVER_PAGE) serverDone.current = true;
                return list;
              })
              .catch((err) => {
                serverDone.current = true;
                toastRef.current(err instanceof Error ? err.message : String(err));
                return [];
              })
          : Promise.resolve([]);
      const online: Promise<Movie[]>[] = catalogs.map((c) => {
        const key = `${c.addonUrl}|${c.id}`;
        if (catalogDone.current[key]) return Promise.resolve([]);
        const matched = genre ? (c.genres.find((g) => sameGenre(g, genre)) ?? genre) : undefined;
        return api
          .addonCatalog({ addonUrl: c.addonUrl, type: c.type, id: c.id, genre: matched, skip: catalogSkip.current[key] ?? 0 })
          .then((metas) => {
            catalogSkip.current[key] = (catalogSkip.current[key] ?? 0) + metas.length;
            if (!metas.length) catalogDone.current[key] = true;
            return metas.filter((m) => year == null || m.year === year).map(metaToMovie);
          })
          .catch(() => {
            catalogDone.current[key] = true;
            return [];
          });
      });
      const [server, ...pages] = await Promise.all([serverJob, ...online]);
      if (id !== request.current) return;
      page.current = current + 1;
      setItems((previous) => {
        const base = first ? [] : previous;
        const seenIds = new Set(base.map((m) => m.id));
        const seenImdb = new Set(base.map((m) => m.providerIds.Imdb ?? m.external?.imdb).filter(Boolean));
        const out = [...base];
        const push = (movie: Movie) => {
          const imdb = movie.providerIds.Imdb ?? movie.external?.imdb ?? null;
          if (seenIds.has(movie.id) || (imdb && seenImdb.has(imdb))) return;
          seenIds.add(movie.id);
          if (imdb) seenImdb.add(imdb);
          out.push(movie);
        };
        server.forEach(push);
        // Interleave the catalogs so one addon does not swamp the page.
        const max = Math.max(...pages.map((p) => p.length), 0);
        let added = 0;
        for (let i = 0; i < max && added < MAX_ONLINE_PER_PAGE; i++) {
          for (const list of pages) {
            if (list[i]) {
              push(list[i]);
              added++;
            }
          }
        }
        return out;
      });
      const onlineLeft = catalogs.some((c) => !catalogDone.current[`${c.addonUrl}|${c.id}`]);
      setMore(!serverDone.current || onlineLeft);
      setLoading(false);
      setLoadingMore(false);
    },
    [useServer, kind, genre, year, sort, catalogs],
  );

  useEffect(() => {
    if (addons == null) return;
    void fetchPage(true);
  }, [fetchPage, addons]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !more) return;
    void fetchPage(false);
  }, [fetchPage, loading, loadingMore, more]);

  const onOpen = useCallback((movie: Movie) => openDetails(movie), []);
  const onPlay = useCallback((movie: Movie) => void play(movie), [play]);

  const sortLabel: Record<BrowseSort, string> = {
    popular: tr("sortPopular"),
    newest: tr("sortNewest"),
    year: tr("sortYear"),
    name: tr("sortName"),
  };

  const header = (
    <View style={{ paddingTop: insets.top + 20, paddingBottom: 20 }}>
      <View style={[s.titleRow, { paddingHorizontal: pagePad }]}>
        <Compass size={26} color={t.colors.accent} strokeWidth={2.2} />
        <Text style={s.title}>{tr("discover")}</Text>
      </View>
      <Text style={[s.hint, { paddingHorizontal: pagePad }]}>{tr("discoverHint")}</Text>

      <View style={[s.filters, { paddingHorizontal: pagePad }]}>
        {hasServer && hasAddons ? (
          <SegmentedControl<Source>
            label={tr("discover")}
            value={source}
            options={[
              { value: "all", label: tr("sourceAll") },
              { value: "server", label: tr("sourceServer") },
              { value: "online", label: tr("sourceOnline") },
            ]}
            onChange={setSource}
          />
        ) : null}
        <SegmentedControl<Kind>
          label={tr("discover")}
          value={kind}
          options={[
            { value: "movie", label: tr("movies") },
            { value: "series", label: tr("series") },
          ]}
          onChange={(next) => {
            setKind(next);
            setGenre(null);
          }}
        />
        <PickerPill label={tr("year")} value={year == null ? tr("anyYear") : String(year)} onPress={() => setSheet("year")} />
        {useServer ? <PickerPill label={tr("sortBy")} value={sortLabel[sort]} onPress={() => setSheet("sort")} /> : null}
      </View>

      {genres.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={s.genreScroll} contentContainerStyle={[s.genreRow, { paddingHorizontal: pagePad }]}>
          <Chip selected={genre == null} label={tr("anyGenre")} onPress={() => setGenre(null)} />
          {genres.map((name) => (
            <Chip key={name} selected={genre != null && sameGenre(genre, name)} label={name} onPress={() => setGenre(name)} />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );

  const bottomPad = TAB_BAR_HEIGHT + insets.bottom + 24;

  const footer = (
    <View style={[s.footer, { paddingBottom: bottomPad }]}>
      {more ? <Pill pill label={tr("loadMore")} loading={loadingMore} onPress={loadMore} /> : null}
    </View>
  );

  const sheets = (
    <>
      <SelectSheet<string>
        visible={sheet === "year"}
        onClose={() => setSheet(null)}
        title={tr("year")}
        searchable
        value={year == null ? "" : String(year)}
        options={[{ value: "", label: tr("anyYear") }, ...years.map((y) => ({ value: String(y), label: String(y) }))]}
        onSelect={(v) => setYear(v ? Number(v) : null)}
      />
      <SelectSheet<BrowseSort>
        visible={sheet === "sort"}
        onClose={() => setSheet(null)}
        title={tr("sortBy")}
        value={sort}
        options={(["popular", "newest", "year", "name"] as BrowseSort[]).map((v) => ({ value: v, label: sortLabel[v] }))}
        onSelect={setSort}
      />
    </>
  );

  if (loading || !items.length) {
    return (
      <View style={s.root}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: bottomPad }}>
          {header}
          {loading ? (
            <GridSkeleton rows={3} />
          ) : (
            <View style={{ paddingHorizontal: pagePad }}>
              <EmptyCard icon={Compass} title={tr("noDiscoverResults")} hint={!hasServer && !hasAddons ? tr("noAddonsYetHint") : undefined} />
            </View>
          )}
        </ScrollView>
        {sheets}
      </View>
    );
  }

  return (
    <View style={s.root}>
      <PosterGrid items={items} onOpen={onOpen} onPlay={onPlay} header={header} footer={footer} onEndReached={loadMore} />
      {sheets}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.base },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { ...text(28, "semibold", { tracking: -0.02 }), color: t.colors.text },
  hint: { ...text(13), color: t.colors.dim, marginTop: 4 },
  filters: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 18 },
  genreScroll: { marginTop: 14, flexGrow: 0 },
  genreRow: { flexDirection: "row", gap: 8, paddingBottom: 2 },
  footer: { alignItems: "center", paddingTop: 28 },
}));
