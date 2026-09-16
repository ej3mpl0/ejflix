import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Compass, LoaderCircle } from "lucide-react";
import type { AddonCatalog, AddonInfo, BrowseSort, Movie } from "../lib/types";
import { api } from "../lib/api";
import { metaToMovie } from "../lib/addons";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useSettings } from "../lib/settings-context";
import { PosterCard } from "../components/PosterCard";
import { Select } from "../components/Select";
import { Shimmer } from "../components/Shimmer";
import { SegmentedControl } from "../components/settings/SegmentedControl";

type Source = "all" | "server" | "online";
type Kind = "movie" | "series";

const SERVER_PAGE = 40;
const MAX_CATALOGS = 6;
const MAX_ONLINE_PER_PAGE = 60;
const FIRST_YEAR = 1950;

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
export function Discover({
  hasServer,
  onOpen,
  onPlay,
  onError,
}: {
  hasServer: boolean;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const { settings } = useSettings();
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
  const request = useRef(0);
  const page = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const serverDone = useRef(false);
  const catalogSkip = useRef<Record<string, number>>({});
  const catalogDone = useRef<Record<string, boolean>>({});

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

  const genreOptions = useMemo(
    () => [{ value: "", label: t("anyGenre") }, ...genres.map((name) => ({ value: name, label: name }))],
    [genres, t],
  );

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
      const jobs: Promise<Movie[]>[] = [];
      if (useServer && !serverDone.current) {
        jobs.push(
          api
            .browseItems({ type: kind, genre, year, sort, start: current * SERVER_PAGE, limit: SERVER_PAGE })
            .then((list) => {
              if (list.length < SERVER_PAGE) serverDone.current = true;
              return list;
            })
            .catch((err) => {
              serverDone.current = true;
              onErrorRef.current(err instanceof Error ? err.message : String(err));
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
            catalogSkip.current[key] = (catalogSkip.current[key] ?? 0) + metas.length;
            if (!metas.length) catalogDone.current[key] = true;
            return metas.filter((m) => year == null || m.year === year).map(metaToMovie);
          })
          .catch(() => {
            catalogDone.current[key] = true;
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
    [useServer, kind, genre, year, sort, catalogs],
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
          label={t("discover")}
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
            label={t("discover")}
            value={source}
            options={[
              { value: "all", label: t("sourceAll") },
              { value: "server", label: t("sourceServer") },
              { value: "online", label: t("sourceOnline") },
            ]}
            onChange={(next) => {
              setSource(next);
              // Without the library there is nothing to sort by date added.
              if (next === "online" && sort === "newest") setSort("popular");
            }}
          />
        ) : null}
        <Select
          value={year == null ? "" : String(year)}
          options={yearOptions}
          onChange={(v) => setYear(v ? Number(v) : null)}
          label={t("anyYear")}
        />
        <Select value={sort} options={sortOptions} onChange={setSort} label={t("sortPopular")} />
        <Select
          value={genre ?? ""}
          options={genreOptions}
          onChange={(v) => setGenre(v || null)}
          label={t("anyGenre")}
        />
      </div>

      {loading ? (
        <div className={grid}>
          {Array.from({ length: 18 }).map((_, i) => (
            <Shimmer key={i} className="aspect-[2/3] rounded-poster" delay={i * 40} />
          ))}
        </div>
      ) : visible.length ? (
        <>
          <div className={grid}>
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
          </div>
          {more ? (
            <div className="mt-10 flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void fetchPage(false)}
                className={cn(
                  "btn-press inline-flex h-11 items-center gap-2 rounded-pill bg-white/10 px-6 text-[14px] font-semibold hover:bg-white/16 disabled:opacity-60",
                )}
              >
                {loadingMore ? <LoaderCircle size={16} className="animate-spin" /> : null}
                {t("loadMore")}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="rounded-card bg-surface px-8 py-12 text-center">
          <p className="text-[16px] font-medium">{t("noDiscoverResults")}</p>
          {!hasServer && !hasAddons ? <p className="mt-1 text-[13px] text-dim">{t("noAddonsYetHint")}</p> : null}
        </div>
      )}
    </div>
  );
}
