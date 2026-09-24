import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Compass, Download, SearchX, X } from "lucide-react";
import type { AddonCatalog, AddonInfo, BrowseSort, Movie } from "../lib/types";
import { api } from "../lib/api";
import { metaToMovie } from "../lib/addons";
import { useI18n } from "../lib/locale-context";
import { errorText } from "../lib/errors";
import { useSettings } from "../lib/settings-context";
import { PosterCard } from "../components/PosterCard";
import { Select } from "../components/Select";
import { PosterGridItemsSkeleton } from "../components/Skeletons";
import { SegmentedControl } from "../components/settings/SegmentedControl";
import { EmptyState } from "../components/EmptyState";
import { LoadMoreButton } from "../components/LoadMoreButton";
import { cn } from "../lib/format";
import { PersonFilter } from "../components/PersonFilter";
import { useParental } from "../lib/parental";

type Source = "all" | "server" | "online";
type Kind = "movie" | "series";

const SERVER_PAGE = 40;
const MAX_CATALOGS = 6;
const MAX_ONLINE_PER_PAGE = 60;
const FIRST_YEAR = 1950;
/** Minimum rating steps of the filter (community / IMDb rating, out of 10). */
const RATINGS = [5, 6, 7, 8];

function sameGenre(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Some addons list their years as genre options ("1998", "2010s"). Those are not genres. */
function isYearLike(name: string): boolean {
  return /^\d{4}s?$/.test(name.trim());
}

/** Last-resort identity for a title an addon serves without an IMDb id. */
function titleKey(movie: Movie): string {
  return `${movie.name.trim().toLowerCase()}|${movie.year ?? ""}`;
}

/**
 * Discover tab: one filter bar — type, source, year, order and genre — over a wall of
 * posters. The same filters apply to the Jellyfin library and to every addon catalog
 * that supports them; server copies win over online duplicates of the same IMDb id.
 */
/** Filters survive leaving the tab (the screen unmounts) for the rest of the session. */
let lastFilters: {
  source: Source;
  kind: Kind;
  genre: string | null;
  year: number | null;
  sort: BrowseSort;
  minRating: number | null;
  person: { id: string; name: string } | null;
} = {
  source: "all",
  kind: "movie",
  genre: null,
  year: null,
  sort: "popular",
  minRating: null,
  person: null,
};

export function Discover({
  hasServer,
  onOpen,
  onPlay,
  onError,
  onImportAddons,
}: {
  hasServer: boolean;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  onError: (message: string) => void;
  /** Settings › Addons with the import panel up (offered when there is nothing to browse). */
  onImportAddons?: () => void;
}) {
  const { t } = useI18n();
  const { settings } = useSettings();
  // A restricted profile gets short pages (Rust filters them), which do not mean the end.
  const parental = useParental();
  const restricted = useRef(false);
  restricted.current = parental?.active ?? false;
  const addonsKey = `${settings.addons.urls.join("|")}|${settings.addons.cinemeta}`;
  const [addons, setAddons] = useState<AddonInfo[] | null>(null);
  const [serverGenres, setServerGenres] = useState<string[]>([]);
  const [source, setSource] = useState<Source>(lastFilters.source);
  const [kind, setKind] = useState<Kind>(lastFilters.kind);
  const [genre, setGenre] = useState<string | null>(lastFilters.genre);
  const [year, setYear] = useState<number | null>(lastFilters.year);
  const [sort, setSort] = useState<BrowseSort>(
    !hasServer && lastFilters.sort === "newest" ? "popular" : lastFilters.sort,
  );
  const [minRating, setMinRating] = useState<number | null>(lastFilters.minRating);
  // A person only applies to the library: without the server it is not carried over.
  const [person, setPerson] = useState<{ id: string; name: string } | null>(
    hasServer && lastFilters.source !== "online" ? lastFilters.person : null,
  );
  lastFilters = { source, kind, genre, year, sort, minRating, person };
  const [items, setItems] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const request = useRef(0);
  const page = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const serverDone = useRef(false);
  const catalogSkip = useRef<Record<string, number>>({});
  const catalogDone = useRef<Record<string, boolean>>({});

  const hasAddons = (addons?.length ?? 0) > 0;
  // The source switch only shows with both sources; without it (another profile, the
  // server unlinked) a remembered "server"/"online" would leave nothing to browse.
  const activeSource: Source = hasServer && hasAddons ? source : "all";
  const useServer = hasServer && activeSource !== "online";
  // Addon catalogs cannot filter by a person: with one chosen, only the library answers.
  const useOnline = hasAddons && activeSource !== "server" && !person;
  const personFilter = hasServer && activeSource !== "online";

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
      if (!name || isYearLike(name)) return;
      if (!out.some((g) => sameGenre(g, name))) out.push(name);
    };
    if (useServer) serverGenres.forEach(push);
    if (useOnline && addons) {
      for (const c of addons.flatMap((addon) => addon.catalogs)) {
        if (c.type === kind) c.genres.forEach(push);
      }
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [serverGenres, addons, kind, useServer, useOnline]);

  const years = useMemo(() => {
    const now = new Date().getFullYear() + 1;
    const list: number[] = [];
    for (let y = now; y >= FIRST_YEAR; y--) list.push(y);
    return list;
  }, []);

  const yearOptions = useMemo(
    () => [{ value: "", label: t("anyYear") }, ...years.map((y) => ({ value: String(y), label: String(y) }))],
    [years, t],
  );

  const sortOptions = useMemo(() => {
    const list: { value: BrowseSort; label: string }[] = [{ value: "popular", label: t("sortPopular") }];
    // "Recently added" is a library notion: an addon catalog carries no date to sort by.
    if (useServer) list.push({ value: "newest", label: t("sortNewest") });
    list.push({ value: "year", label: t("sortYear") }, { value: "name", label: t("sortName") });
    return list;
  }, [useServer, t]);

  const ratingOptions = useMemo(
    () => [
      { value: "", label: t("anyRating") },
      ...RATINGS.map((r) => ({ value: String(r), label: t("ratingAtLeast", { n: r }) })),
    ],
    [t],
  );

  const genreOptions = useMemo(
    () => [{ value: "", label: t("anyGenre") }, ...genres.map((name) => ({ value: name, label: name }))],
    [genres, t],
  );

  const fetchPage = useCallback(
    async (first: boolean) => {
      // A next page while the first one of new filters loads would land on the old list.
      if (!first && loadingRef.current) return;
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
      const jobs: Promise<Movie[]>[] = [];
      if (useServer && !serverDone.current) {
        jobs.push(
          api
            .browseItems({
              type: kind,
              genre,
              year,
              sort,
              minRating,
              personId: person?.id ?? null,
              start: current * SERVER_PAGE,
              limit: SERVER_PAGE,
            })
            .then((list) => {
              // A superseded request must not touch the paging state of the current one.
              if (id === request.current && (list.length === 0 || (list.length < SERVER_PAGE && !restricted.current))) {
                serverDone.current = true;
              }
              return list;
            })
            .catch((err) => {
              if (id !== request.current) return [];
              serverDone.current = true;
              onErrorRef.current(errorText(t, err));
              return [];
            }),
        );
      } else {
        jobs.push(Promise.resolve([]));
      }
      const online: Promise<Movie[]>[] = catalogs.map((c) => {
        const key = `${c.addonUrl}|${c.id}`;
        if (catalogDone.current[key]) return Promise.resolve([]);
        const matched = genre ? c.genres.find((g) => sameGenre(g, genre)) ?? genre : undefined;
        return api
          .addonCatalog({ addonUrl: c.addonUrl, type: c.type, id: c.id, genre: matched, skip: catalogSkip.current[key] ?? 0 })
          .then((metas) => {
            if (id !== request.current) return [];
            catalogSkip.current[key] = (catalogSkip.current[key] ?? 0) + metas.length;
            if (!metas.length) catalogDone.current[key] = true;
            return metas
              .filter((m) => year == null || m.year === year)
              .filter((m) => minRating == null || (m.imdbRating ?? 0) >= minRating)
              .map(metaToMovie);
          })
          .catch(() => {
            if (id === request.current) catalogDone.current[key] = true;
            return [];
          });
      });
      const [server, ...pages] = await Promise.all([jobs[0], ...online]);
      if (id !== request.current) return;
      page.current = current + 1;
      setItems((previous) => {
        const base = first ? [] : previous;
        const seenIds = new Set(base.map((m) => m.id));
        const seenImdb = new Set(base.map((m) => m.providerIds.Imdb ?? m.external?.imdb).filter(Boolean));
        const seenTitles = new Set(base.map(titleKey));
        const out = [...base];
        const push = (movie: Movie) => {
          const imdb = movie.providerIds.Imdb ?? movie.external?.imdb ?? null;
          const title = titleKey(movie);
          if (seenIds.has(movie.id) || (imdb && seenImdb.has(imdb)) || seenTitles.has(title)) return;
          seenIds.add(movie.id);
          seenTitles.add(title);
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
    [useServer, kind, genre, year, sort, minRating, person, catalogs],
  );

  useEffect(() => {
    if (addons == null) return;
    void fetchPage(true);
  }, [fetchPage, addons]);

  // The server hands back its page already ordered; the addon catalogs arrive in their
  // own order, so anything but "popular" has to be arranged here for the merged list to
  // read straight. Loading another page can reshuffle it — the price of two sources.
  const visible = useMemo(() => {
    if (sort === "popular" || sort === "newest") return items;
    const list = [...items];
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else list.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    return list;
  }, [items, sort]);

  const grid = "grid grid-cols-[repeat(auto-fill,minmax(var(--poster-min),1fr))] gap-2";

  return (
    <div className="page-enter px-page pt-24 pb-16">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-[28px] font-semibold tracking-[-0.02em]">
            <Compass size={26} className="text-accent" />
            {t("discover")}
          </h1>
          <p className="mt-1 text-[13px] text-dim">{t("discoverHint")}</p>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2.5">
        <SegmentedControl<Kind>
          label={t("filterType")}
          value={kind}
          options={[
            { value: "movie", label: t("movies") },
            { value: "series", label: t("series") },
          ]}
          onChange={(next) => {
            setKind(next);
            setGenre(null);
          }}
        />
        {hasServer && hasAddons ? (
          <SegmentedControl<Source>
            label={t("filterSource")}
            value={source}
            options={[
              { value: "all", label: t("sourceAll") },
              { value: "server", label: t("sourceServer") },
              { value: "online", label: t("sourceOnline") },
            ]}
            onChange={(next) => {
              setSource(next);
              // Without the library there is nothing to sort by date added, nor people to pick.
              if (next === "online" && sort === "newest") setSort("popular");
              if (next === "online") setPerson(null);
            }}
          />
        ) : null}
        <Select
          value={year == null ? "" : String(year)}
          options={yearOptions}
          onChange={(v) => setYear(v ? Number(v) : null)}
          label={t("filterYear")}
        />
        <Select value={sort} options={sortOptions} onChange={setSort} label={t("sortBy")} />
        <Select
          value={genre ?? ""}
          options={genreOptions}
          onChange={(v) => setGenre(v || null)}
          label={t("filterGenre")}
        />
        <Select
          value={minRating == null ? "" : String(minRating)}
          options={ratingOptions}
          onChange={(v) => setMinRating(v ? Number(v) : null)}
          label={t("filterRating")}
        />
        {personFilter ? <PersonFilter value={person} onChange={setPerson} /> : null}
        {genre != null || year != null || sort !== "popular" || minRating != null || person != null ? (
          <button
            type="button"
            onClick={() => {
              setGenre(null);
              setYear(null);
              setSort("popular");
              setMinRating(null);
              setPerson(null);
            }}
            className="btn-press inline-flex h-10 items-center gap-1.5 rounded-pill px-3 text-[13px] font-medium text-muted hover:bg-white/8 hover:text-text"
          >
            <X size={14} />
            {t("clearFilters")}
          </button>
        ) : null}
      </div>
      {person && hasAddons && activeSource === "all" ? <p className="-mt-3 mb-5 text-[12px] text-dim">{t("personServerOnly")}</p> : null}

      {/* A filter change keeps the previous results, dimmed, until the new ones arrive. */}
      {loading && !visible.length ? (
        <div className={grid}>
          <PosterGridItemsSkeleton count={18} />
        </div>
      ) : visible.length ? (
        <>
          <div className={cn(grid, "transition-opacity duration-200", loading && "pointer-events-none opacity-50")} aria-busy={loading}>
            {visible.map((movie, i) => (
              <PosterCard
                key={movie.id}
                movie={movie}
                onOpen={onOpen}
                onPlay={onPlay}
                layout="wall"
                delay={Math.min(i, 24) * 20}
              />
            ))}
            {loadingMore ? <PosterGridItemsSkeleton count={6} /> : null}
          </div>
          {more ? (
            <LoadMoreButton loading={loading || loadingMore} onLoad={() => void fetchPage(false)} />
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={<SearchX size={26} />}
          title={t("noDiscoverResults")}
          hint={!hasServer && !hasAddons ? t("noAddonsYetHint") : undefined}
          action={
            !hasServer && !hasAddons && onImportAddons
              ? { label: t("importAddons"), icon: <Download size={16} />, onClick: onImportAddons }
              : genre != null || year != null
                ? {
                    label: t("clearFilters"),
                    icon: <X size={16} />,
                    onClick: () => {
                      setGenre(null);
                      setYear(null);
                    },
                  }
                : undefined
          }
        />
      )}
    </div>
  );
}
