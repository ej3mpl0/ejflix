import { useEffect, useRef, useState } from "react";
import { History, Search, X } from "lucide-react";
import type { GenreRow, Movie } from "../lib/types";
import { api } from "../lib/api";
import { useI18n } from "../lib/locale-context";
import {
  clearSearchHistory,
  loadSearchHistory,
  pushSearchHistory,
  removeSearchHistory,
} from "../lib/search-history";
import { PosterCard } from "../components/PosterCard";
import { Chip } from "../components/Chip";
import { Shimmer } from "../components/Shimmer";
import { metaToMovie } from "../lib/addons";

const MAX_SEARCH_CATALOGS = 4;

/** Search with recent queries and a "Discover" section built from the home genres. */
export function SearchPage({
  userId,
  genres,
  onOpen,
  onPlay,
  onError,
}: {
  userId: string;
  genres: GenreRow[];
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Movie[] | null>(null);
  const [online, setOnline] = useState<Movie[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadSearchHistory(userId));
  const [genre, setGenre] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setOnline(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let alive = true;
    const handle = window.setTimeout(() => {
      api
        .searchItems(trimmed)
        .then((list) => {
          if (!alive) return;
          setResults(list);
          if (list.length) setHistory(pushSearchHistory(userId, trimmed));
        })
        .catch((err) => onError(err instanceof Error ? err.message : String(err)))
        .finally(() => {
          if (alive) setLoading(false);
        });
      // Online titles from the addon catalogs that support search (Cinemeta does).
      api
        .addonsList()
        .then(async (addons) => {
          const catalogs = addons
            .flatMap((addon) => addon.catalogs)
            .filter((c) => c.searchable && (c.type === "movie" || c.type === "series"))
            .slice(0, MAX_SEARCH_CATALOGS);
          const lists = await Promise.all(
            catalogs.map((c) =>
              api
                .addonCatalog({ addonUrl: c.addonUrl, type: c.type, id: c.id, search: trimmed })
                .catch(() => []),
            ),
          );
          if (!alive) return;
          const seen = new Set<string>();
          const merged: Movie[] = [];
          for (const meta of lists.flat()) {
            if (seen.has(meta.id)) continue;
            seen.add(meta.id);
            merged.push(metaToMovie(meta));
          }
          setOnline(merged.slice(0, 40));
        })
        .catch(() => {
          if (alive) setOnline([]);
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [query, userId, onError]);

  const active = genre ? genres.find((row) => row.id === genre) : null;
  const showDiscover = query.trim().length < 2;

  return (
    <div className="page-enter px-page pt-24 pb-16">
      <div className="relative mx-auto mb-8 max-w-[720px]">
        <Search size={20} className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-dim" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchHint")}
          aria-label={t("search")}
          className="h-14 w-full rounded-btn border border-white/10 bg-surface pr-12 pl-14 text-[16px] text-text outline-none placeholder:text-dim focus:border-accent"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={t("close")}
            className="icon-hit absolute top-1/2 right-3 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-dim hover:bg-white/8 hover:text-text"
          >
            <X size={18} />
          </button>
        ) : null}
      </div>

      {showDiscover ? (
        <>
          {history.length ? (
            <section className="mb-8">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-[18px] font-semibold">
                  <History size={18} className="text-dim" />
                  {t("recentSearches")}
                </h2>
                <button
                  type="button"
                  onClick={() => setHistory(clearSearchHistory(userId))}
                  className="text-[13px] text-dim hover:text-text"
                >
                  {t("clearHistory")}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {history.map((item) => (
                  <span key={item} className="inline-flex items-center">
                    <Chip onClick={() => setQuery(item)} className="rounded-r-none pr-2">
                      {item}
                    </Chip>
                    <button
                      type="button"
                      aria-label={`${t("close")} ${item}`}
                      onClick={() => setHistory(removeSearchHistory(userId, item))}
                      className="grid h-9 w-8 place-items-center rounded-r-pill bg-white/6 text-dim hover:bg-white/12 hover:text-text"
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            </section>
          ) : null}
          {genres.length ? (
            <section>
              <h2 className="mb-3 text-[18px] font-semibold">{t("discover")}</h2>
              <div className="no-scrollbar mb-6 flex gap-2 overflow-x-auto pb-1">
                {genres.map((row) => (
                  <Chip key={row.id} selected={genre === row.id} onClick={() => setGenre(genre === row.id ? null : row.id)}>
                    {row.name}
                  </Chip>
                ))}
              </div>
              {active ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--poster-min),1fr))] gap-rail">
                  {active.items.map((movie, i) => (
                    <PosterCard key={movie.id} movie={movie} onOpen={onOpen} onPlay={onPlay} delay={i * 20} />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      ) : (
        <section>
          <h2 className="mb-4 text-[18px] font-semibold">{t("resultsFor", { query: query.trim() })}</h2>
          {loading && !results ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--poster-min),1fr))] gap-rail">
              {Array.from({ length: 12 }).map((_, i) => (
                <Shimmer key={i} className="aspect-[2/3] rounded-poster" delay={i * 60} />
              ))}
            </div>
          ) : results && results.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--poster-min),1fr))] gap-rail">
              {results.map((movie, i) => (
                <PosterCard key={movie.id} movie={movie} onOpen={onOpen} onPlay={onPlay} delay={i * 20} />
              ))}
            </div>
          ) : results ? (
            <p className="text-muted">{t("noResults")}</p>
          ) : null}
          {online?.length ? (
            <>
              <h2 className="mt-10 mb-4 text-[18px] font-semibold">{t("online")}</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--poster-min),1fr))] gap-rail">
                {online.map((movie, i) => (
                  <PosterCard key={movie.id} movie={movie} onOpen={onOpen} onPlay={onPlay} delay={i * 20} />
                ))}
              </div>
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}
