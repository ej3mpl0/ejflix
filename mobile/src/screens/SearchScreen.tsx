import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Globe, History, Search, Server, X } from "lucide-react-native";
import type { AddonCatalog, AddonInfo, Movie } from "../lib/types";
import { hasServer as sessionHasServer } from "../lib/types";
import { api } from "../lib/api";
import { metaToMovie } from "../lib/addons";
import { useI18n } from "../lib/locale-context";
import { useSettings } from "../lib/settings-context";
import { useSession } from "../lib/session-context";
import { useToast } from "../lib/toast-context";
import { clearSearchHistory, loadSearchHistory, pushSearchHistory, removeSearchHistory } from "../lib/search-history";
import { usePlay } from "../lib/play";
import { openDetails } from "../navigation/navigationRef";
import { makeStyles, useTheme } from "../theme/ThemeProvider";
import { useLayout } from "../theme/responsive";
import { text } from "../theme/typography";
import { Chip } from "../components/ui/Chip";
import { IconButton } from "../components/ui/IconButton";
import { Spinner } from "../components/ui/Spinner";
import { GridSkeleton } from "../components/ui/Skeletons";
import { TAB_BAR_HEIGHT } from "../components/ui/Toast";
import { PosterCard } from "../components/media/PosterCard";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { EmptyCard } from "../components/ui/EmptyCard";
import { SearchX } from "lucide-react-native";

const MAX_SEARCH_CATALOGS = 4;
const DEBOUNCE_MS = 300;
const GENRE_LIMIT = 30;

function sameGenre(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function imdbOf(movie: Movie): string | null {
  return movie.providerIds.Imdb ?? movie.external?.imdb ?? null;
}

/** Poster grid without virtualization (the search result sets are small). */
function WrapGrid({ items, onOpen, onPlay }: { items: Movie[]; onOpen: (m: Movie) => void; onPlay: (m: Movie) => void }) {
  const { grid, rail } = useLayout();
  const { itemW } = grid();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: rail }}>
      {items.map((movie) => (
        <PosterCard key={movie.id} movie={movie} onOpen={onOpen} onPlay={onPlay} width={itemW} />
      ))}
    </View>
  );
}

/**
 * Search across the server and the addon catalogs that support it. Results stay on
 * screen while the next query loads; the history only remembers what was actually
 * opened or submitted with the search key.
 */
export function SearchScreen() {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { settings } = useSettings();
  const { session } = useSession();
  const { toast } = useToast();
  const play = usePlay();
  const { insets, pagePad } = useLayout();
  const userId = session?.userId ?? "anonymous";
  const hasServer = sessionHasServer(session);
  const addonsKey = `${settings.addons.urls.join("|")}|${settings.addons.cinemeta}`;
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Movie[]>([]);
  const [online, setOnline] = useState<Movie[]>([]);
  const [searched, setSearched] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadSearchHistory(userId));
  const [addons, setAddons] = useState<AddonInfo[]>([]);
  const [serverGenres, setServerGenres] = useState<string[]>([]);
  const [genre, setGenre] = useState<string | null>(null);
  const [genreItems, setGenreItems] = useState<Movie[] | null>(null);
  /** Movies / series filter over the results (both sources). */
  const [kind, setKind] = useState<"all" | "Movie" | "Series">("all");
  const request = useRef(0);
  const genreRequest = useRef(0);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useFocusEffect(
    useCallback(() => {
      const handle = setTimeout(() => inputRef.current?.focus(), 350);
      return () => clearTimeout(handle);
    }, []),
  );

  useEffect(() => {
    setHistory(loadSearchHistory(userId));
  }, [userId]);

  // Addon catalogs, resolved once instead of on every keystroke.
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

  const catalogs = useMemo<AddonCatalog[]>(
    () =>
      addons
        .flatMap((addon) => addon.catalogs)
        .filter((c) => c.searchable && (c.type === "movie" || c.type === "series"))
        .slice(0, MAX_SEARCH_CATALOGS),
    [addons],
  );

  const genres = useMemo(() => {
    const out: string[] = [];
    const push = (name: string) => {
      if (name && !out.some((g) => sameGenre(g, name))) out.push(name);
    };
    if (hasServer) serverGenres.forEach(push);
    for (const c of addons.flatMap((addon) => addon.catalogs)) {
      if (c.type === "movie" || c.type === "series") c.genres.forEach(push);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [serverGenres, addons, hasServer]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      request.current++;
      setResults([]);
      setOnline([]);
      setSearched("");
      setLoading(false);
      return;
    }
    const id = ++request.current;
    setLoading(true);
    const handle = setTimeout(async () => {
      const serverJob = hasServer
        ? api.searchItems(trimmed).catch((err) => {
            toastRef.current(err instanceof Error ? err.message : String(err));
            return [] as Movie[];
          })
        : Promise.resolve([] as Movie[]);
      const onlineJob = Promise.all(
        catalogs.map((c) => api.addonCatalog({ addonUrl: c.addonUrl, type: c.type, id: c.id, search: trimmed }).catch(() => [])),
      );
      const [server, lists] = await Promise.all([serverJob, onlineJob]);
      if (id !== request.current) return;
      const known = new Set(server.map((m) => m.providerIds.Imdb).filter(Boolean));
      const seen = new Set<string>();
      const merged: Movie[] = [];
      for (const meta of lists.flat()) {
        if (seen.has(meta.id) || (meta.imdb && known.has(meta.imdb))) continue;
        seen.add(meta.id);
        merged.push(metaToMovie(meta));
      }
      setResults(server);
      setOnline(merged.slice(0, 40));
      setSearched(trimmed);
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, hasServer, catalogs]);

  // Genre browsing while idle: the server (movies + series) and one catalog per type.
  useEffect(() => {
    if (!genre) {
      genreRequest.current++;
      setGenreItems(null);
      return;
    }
    const id = ++genreRequest.current;
    setGenreItems(null);
    const jobs: Promise<Movie[]>[] = [];
    if (hasServer) {
      for (const type of ["movie", "series"] as const) {
        jobs.push(api.browseItems({ type, genre, limit: GENRE_LIMIT }).catch(() => []));
      }
    }
    for (const type of ["movie", "series"]) {
      const catalog = addons.flatMap((a) => a.catalogs).find((c) => c.type === type && c.genres.some((g) => sameGenre(g, genre)));
      if (!catalog) continue;
      const matched = catalog.genres.find((g) => sameGenre(g, genre)) ?? genre;
      jobs.push(
        api
          .addonCatalog({ addonUrl: catalog.addonUrl, type: catalog.type, id: catalog.id, genre: matched })
          .then((metas) => metas.slice(0, GENRE_LIMIT).map(metaToMovie))
          .catch(() => []),
      );
    }
    void Promise.all(jobs).then((lists) => {
      if (id !== genreRequest.current) return;
      const seenIds = new Set<string>();
      const seenImdb = new Set<string>();
      const out: Movie[] = [];
      for (const movie of lists.flat()) {
        const imdb = imdbOf(movie);
        if (seenIds.has(movie.id) || (imdb && seenImdb.has(imdb))) continue;
        seenIds.add(movie.id);
        if (imdb) seenImdb.add(imdb);
        out.push(movie);
      }
      setGenreItems(out);
    });
  }, [genre, hasServer, addons]);

  const remember = useCallback(() => {
    const trimmed = query.trim();
    if (trimmed.length >= 2) setHistory(pushSearchHistory(userId, trimmed));
  }, [query, userId]);
  const open = useCallback(
    (movie: Movie) => {
      remember();
      openDetails(movie);
    },
    [remember],
  );
  const playItem = useCallback(
    (movie: Movie) => {
      remember();
      void play(movie);
    },
    [remember, play],
  );
  const openIdle = useCallback((movie: Movie) => openDetails(movie), []);
  const playIdle = useCallback((movie: Movie) => void play(movie), [play]);

  const showDiscover = query.trim().length < 2;
  const nothing = !!searched && !loading && !results.length && !online.length;
  const ofKind = (list: Movie[]) => (kind === "all" ? list : list.filter((movie) => movie.kind === kind));
  const shownResults = ofKind(results);
  const shownOnline = ofKind(online);
  const kinds = new Set([...results, ...online].map((movie) => movie.kind));
  const canFilter = kinds.has("Movie") && kinds.has("Series");
  const bottomPad = TAB_BAR_HEIGHT + insets.bottom + 24;

  return (
    <View style={s.root}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 16, paddingHorizontal: pagePad, paddingBottom: bottomPad }]}
      >
        <View style={s.field}>
          <Search size={20} color={t.colors.dim} strokeWidth={2} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder={tr("searchHint")}
            placeholderTextColor={t.colors.dim}
            accessibilityLabel={tr("search")}
            selectionColor={t.colors.accent}
            cursorColor={t.colors.accent}
            keyboardAppearance="dark"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            onSubmitEditing={remember}
            style={[s.input, text(16), { color: t.colors.text }]}
          />
          {loading ? <Spinner size={18} color={t.colors.dim} /> : null}
          {query ? (
            <IconButton
              icon={X}
              label={tr("close")}
              size={18}
              hit={40}
              onPress={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            />
          ) : null}
        </View>

        {showDiscover ? (
          <>
            {history.length ? (
              <View style={s.section}>
                <View style={s.sectionHeader}>
                  <History size={18} color={t.colors.dim} strokeWidth={2} />
                  <Text style={s.sectionTitle}>{tr("recentSearches")}</Text>
                  <View style={{ flex: 1 }} />
                  <Pressable accessibilityRole="button" onPress={() => setHistory(clearSearchHistory(userId))} hitSlop={8} style={({ pressed }) => [s.clear, pressed ? { opacity: 0.6 } : null]}>
                    <Text style={s.clearText}>{tr("clearHistory")}</Text>
                  </Pressable>
                </View>
                <View style={s.chips}>
                  {history.map((item) => (
                    <View key={item} style={s.recent}>
                      <Pressable accessibilityRole="button" accessibilityLabel={item} onPress={() => setQuery(item)} style={({ pressed }) => [s.recentLabel, pressed ? s.recentPressed : null]}>
                        <Text numberOfLines={1} style={s.recentText}>
                          {item}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${tr("close")} ${item}`}
                        onPress={() => setHistory(removeSearchHistory(userId, item))}
                        style={({ pressed }) => [s.recentRemove, pressed ? s.recentPressed : null]}
                      >
                        <X size={13} color={t.colors.dim} strokeWidth={2.2} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            {genres.length ? (
              <View style={s.section}>
                <Text style={[s.sectionTitle, { marginBottom: 12 }]}>{tr("genres")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginHorizontal: -pagePad }} contentContainerStyle={[s.genreRow, { paddingHorizontal: pagePad }]}>
                  {genres.map((name) => (
                    <Chip key={name} selected={genre != null && sameGenre(genre, name)} label={name} onPress={() => setGenre(genre != null && sameGenre(genre, name) ? null : name)} />
                  ))}
                </ScrollView>
                {genre ? (
                  <View style={{ marginTop: 20, marginHorizontal: -pagePad }}>
                    {genreItems == null ? (
                      <GridSkeleton rows={2} />
                    ) : genreItems.length ? (
                      <View style={{ paddingHorizontal: pagePad }}>
                        <WrapGrid items={genreItems} onOpen={openIdle} onPlay={playIdle} />
                      </View>
                    ) : (
                      <Text style={[s.empty, { paddingHorizontal: pagePad }]}>{tr("noResults")}</Text>
                    )}
                  </View>
                ) : null}
              </View>
            ) : null}
          </>
        ) : (
          <View style={[s.section, loading && searched ? { opacity: 0.7 } : null]}>
            {!searched && loading ? (
              <View style={{ marginHorizontal: -pagePad }}>
                <GridSkeleton rows={2} />
              </View>
            ) : null}
            <Text accessibilityLiveRegion="polite" style={{ height: 0, opacity: 0 }}>
              {searched && !loading ? tr("resultsCount", { n: results.length + online.length }) : ""}
            </Text>
            {canFilter ? (
              <View style={{ marginBottom: 20 }}>
                <SegmentedControl
                  label={tr("filterType")}
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: "all", label: tr("sourceAll") },
                    { value: "Movie", label: tr("movies") },
                    { value: "Series", label: tr("series") },
                  ]}
                />
              </View>
            ) : null}
            {shownResults.length ? (
              <View style={{ marginBottom: shownOnline.length ? 32 : 0 }}>
                <View style={s.sectionHeader}>
                  <Server size={17} color={t.colors.dim} strokeWidth={2} />
                  <Text style={s.sectionTitle}>{tr("myServer")}</Text>
                  <Text style={s.count}>{shownResults.length}</Text>
                </View>
                <WrapGrid items={shownResults} onOpen={open} onPlay={playItem} />
              </View>
            ) : null}
            {shownOnline.length ? (
              <View>
                <View style={s.sectionHeader}>
                  <Globe size={17} color={t.colors.dim} strokeWidth={2} />
                  <Text style={s.sectionTitle}>{tr("online")}</Text>
                  <Text style={s.count}>{shownOnline.length}</Text>
                </View>
                <WrapGrid items={shownOnline} onOpen={open} onPlay={playItem} />
              </View>
            ) : null}
            {nothing ? <EmptyCard icon={SearchX} title={tr("noResults")} hint={tr("noResultsHint")} /> : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.base },
  scroll: { flexGrow: 1 },
  field: {
    height: 56,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 20,
    paddingRight: 8,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.white(0.1),
    backgroundColor: t.colors.surface,
  },
  input: { flex: 1, minWidth: 0, height: "100%", paddingVertical: 0 },
  section: { marginTop: 28 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  sectionTitle: { ...text(18, "semibold", { tracking: -0.01 }), color: t.colors.text },
  count: { ...text(13, "regular", { tabular: true }), color: t.colors.dim },
  clear: { minHeight: 44, justifyContent: "center" },
  clearText: { ...text(13), color: t.colors.dim },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  recent: { flexDirection: "row", alignItems: "stretch", height: 36, borderRadius: t.radii.pill, backgroundColor: t.white(0.06), overflow: "hidden" },
  recentLabel: { justifyContent: "center", paddingLeft: 14, paddingRight: 6, maxWidth: 220 },
  recentText: { ...text(13, "medium"), color: t.white(0.8) },
  recentRemove: { width: 36, alignItems: "center", justifyContent: "center" },
  recentPressed: { backgroundColor: t.white(0.08) },
  genreRow: { flexDirection: "row", gap: 8, paddingBottom: 2 },
  empty: { ...text(15), color: t.colors.muted, paddingVertical: 8 },
}));
