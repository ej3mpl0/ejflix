import { useEffect, useMemo, useState } from "react";
import { Nav } from "../components/Nav";
import { HeroBanner } from "../components/HeroBanner";
import { PosterRow } from "../components/PosterRow";
import { PosterCard } from "../components/PosterCard";
import { MovieModal } from "../components/MovieModal";
import { HeroSkeleton, RowSkeleton } from "../components/Skeletons";
import { api } from "../lib/api";
import type { HomeData, Movie, Session } from "../lib/types";
import { sessionAvatar } from "../lib/format";
import { useI18n } from "../lib/locale-context";

type View = "home" | "movies" | "search" | "mylist";

function FilterBar({
  genres,
  years,
  genre,
  year,
  sort,
  onGenre,
  onYear,
  onSort,
  showSort,
}: {
  genres: string[];
  years: number[];
  genre: string;
  year: string;
  sort: string;
  onGenre: (v: string) => void;
  onYear: (v: string) => void;
  onSort: (v: string) => void;
  showSort?: boolean;
}) {
  const { t } = useI18n();
  const selectClass =
    "h-10 rounded-md border border-white/15 bg-black/50 px-3 text-sm text-white outline-none";
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <label className="sr-only" htmlFor="filter-genre">
        {t("filterGenre")}
      </label>
      <select id="filter-genre" className={selectClass} value={genre} onChange={(e) => onGenre(e.target.value)}>
        <option value="">{t("allGenres")}</option>
        {genres.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="filter-year">
        {t("filterYear")}
      </label>
      <select id="filter-year" className={selectClass} value={year} onChange={(e) => onYear(e.target.value)}>
        <option value="">{t("allYears")}</option>
        {years.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </select>
      {showSort ? (
        <select className={selectClass} value={sort} onChange={(e) => onSort(e.target.value)} aria-label={t("filterSort")}>
          <option value="name">{t("sortName")}</option>
          <option value="year">{t("sortYear")}</option>
          <option value="rating">{t("sortRating")}</option>
          <option value="added">{t("sortAdded")}</option>
        </select>
      ) : null}
    </div>
  );
}

function PosterGrid({ items, onOpen }: { items: Movie[]; onOpen: (m: Movie) => void }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
      {items.map((movie, i) => (
        <PosterCard key={movie.id} movie={movie} onOpen={onOpen} delay={i * 20} />
      ))}
    </div>
  );
}

export function Home({
  session,
  onPlay,
  onToast,
  onSwitchProfile,
  onLogout,
}: {
  session: Session;
  onPlay: (movie: Movie) => void;
  onToast: (message: string) => void;
  onSwitchProfile: () => void;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Movie[]>([]);
  const [favorites, setFavorites] = useState<Movie[]>([]);
  const [library, setLibrary] = useState<Movie[]>([]);
  const [selected, setSelected] = useState<Movie | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [genre, setGenre] = useState("");
  const [year, setYear] = useState("");
  const [sort, setSort] = useState("name");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api.getHome());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    api.getFavorites().then(setFavorites).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (view !== "mylist") return;
    api.getFavorites().then(setFavorites).catch((err) => {
      onToast(err instanceof Error ? err.message : String(err));
    });
  }, [view, onToast]);

  useEffect(() => {
    if (view !== "movies") return;
    const yearNum = year ? Number(year) : null;
    api
      .getLibrary({ genre: genre || null, year: yearNum, sort })
      .then(setLibrary)
      .catch((err) => {
        onToast(err instanceof Error ? err.message : String(err));
      });
  }, [view, genre, year, sort, onToast]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      if (view === "search") setView("home");
      return;
    }
    setView("search");
    const handle = window.setTimeout(() => {
      const yearNum = year ? Number(year) : null;
      api
        .searchItems(query, genre || null, yearNum)
        .then(setResults)
        .catch((err) => {
          onToast(err instanceof Error ? err.message : String(err));
        });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, genre, year, onToast]);

  const catalog = useMemo(() => {
    const pool = [...(data?.all ?? []), ...library, ...results, ...favorites];
    const map = new Map<string, Movie>();
    for (const item of pool) map.set(item.id, item);
    return [...map.values()];
  }, [data, library, results, favorites]);

  const genres = useMemo(() => {
    const set = new Set<string>();
    for (const item of catalog) {
      for (const g of item.genres ?? []) set.add(g);
    }
    for (const row of data?.genres ?? []) set.add(row.name);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [catalog, data]);

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const item of catalog) {
      if (item.year) set.add(item.year);
    }
    return [...set].sort((a, b) => b - a);
  }, [catalog]);

  const patchMovie = (next: Movie) => {
    const apply = (list: Movie[]) => list.map((m) => (m.id === next.id ? { ...m, ...next } : m));
    setResults(apply);
    setFavorites((prev) => {
      const updated = apply(prev);
      return next.favorite ? (updated.some((m) => m.id === next.id) ? updated : [next, ...updated]) : updated.filter((m) => m.id !== next.id);
    });
    setLibrary(apply);
    setData((prev) => {
      if (!prev) return prev;
      const applyRow = (items: Movie[]) => items.map((m) => (m.id === next.id ? { ...m, ...next } : m));
      return {
        ...prev,
        featured: prev.featured?.id === next.id ? { ...prev.featured, ...next } : prev.featured,
        resume: applyRow(prev.resume),
        latest: applyRow(prev.latest),
        all: applyRow(prev.all),
        genres: prev.genres.map((row) => ({ ...row, items: applyRow(row.items) })),
      };
    });
    setSelected((prev) => (prev?.id === next.id ? { ...prev, ...next } : prev));
  };

  return (
    <div className="h-full bg-base text-text">
      <Nav
        userName={session.userName}
        avatarUrl={sessionAvatar(session)}
        view={view === "search" ? "search" : view}
        onView={(next) => {
          setQuery("");
          setGenre("");
          setYear("");
          setSort("name");
          setView(next);
        }}
        query={query}
        onQuery={setQuery}
        scrolled={scrolled}
        onSwitchProfile={onSwitchProfile}
        onLogout={onLogout}
      />
      <div
        className="h-full overflow-y-auto"
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 24)}
      >
        {error ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="mb-4 text-lg">{t("cannotConnect")}</p>
              <p className="mb-6 text-sm text-muted">{error}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="btn-press h-11 rounded-md bg-accent px-6 text-sm font-semibold hover:bg-accent-hover"
              >
                {t("retry")}
              </button>
            </div>
          </div>
        ) : loading ? (
          <>
            <HeroSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </>
        ) : view === "search" ? (
          <div className="px-12 pt-24 pb-16">
            <h2 className="mb-2 text-[20px] font-semibold">{t("resultsFor", { query })}</h2>
            <FilterBar
              genres={genres}
              years={years}
              genre={genre}
              year={year}
              sort={sort}
              onGenre={setGenre}
              onYear={setYear}
              onSort={setSort}
            />
            <PosterGrid items={results} onOpen={setSelected} />
            {!results.length ? <p className="text-muted">{t("noResults")}</p> : null}
          </div>
        ) : view === "mylist" ? (
          <div className="px-12 pt-24 pb-16">
            <h2 className="mb-6 text-[20px] font-semibold">{t("myList")}</h2>
            <PosterGrid items={favorites} onOpen={setSelected} />
            {!favorites.length ? <p className="text-muted">{t("emptyList")}</p> : null}
          </div>
        ) : view === "movies" ? (
          <div className="px-12 pt-24 pb-16">
            <h2 className="mb-2 text-[20px] font-semibold">{t("allMovies")}</h2>
            <FilterBar
              genres={genres}
              years={years}
              genre={genre}
              year={year}
              sort={sort}
              onGenre={setGenre}
              onYear={setYear}
              onSort={setSort}
              showSort
            />
            <PosterGrid items={library.length ? library : data?.all ?? []} onOpen={setSelected} />
          </div>
        ) : (
          <>
            {data?.featured ? (
              <HeroBanner movie={data.featured} onPlay={onPlay} onMore={setSelected} />
            ) : (
              <div className="h-24" />
            )}
            <div className="enter enter-d4 relative z-10 -mt-6 pb-16">
              {favorites.length ? (
                <PosterRow title={t("myList")} items={favorites} onOpen={setSelected} onPlay={onPlay} />
              ) : null}
              {data?.resume.length ? (
                <PosterRow
                  title={t("continueWatching")}
                  items={data.resume}
                  variant="continue"
                  onOpen={setSelected}
                  onPlay={onPlay}
                />
              ) : null}
              {data?.latest.length ? (
                <PosterRow
                  title={t("recentlyAdded")}
                  items={data.latest}
                  onOpen={setSelected}
                  onPlay={onPlay}
                />
              ) : null}
              {data?.genres.map((row) => (
                <PosterRow
                  key={row.id}
                  title={row.name}
                  items={row.items}
                  onOpen={setSelected}
                  onPlay={onPlay}
                />
              ))}
              {data?.all.length ? (
                <PosterRow
                  title={t("allMovies")}
                  items={data.all}
                  onOpen={setSelected}
                  onPlay={onPlay}
                />
              ) : null}
            </div>
          </>
        )}
      </div>
      {selected ? (
        <MovieModal
          movie={selected}
          onClose={() => setSelected(null)}
          onPlay={onPlay}
          onFavorite={patchMovie}
        />
      ) : null}
    </div>
  );
}
