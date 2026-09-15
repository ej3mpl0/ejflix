import { useEffect, useRef, useState } from "react";
import { Globe, History, LoaderCircle, Search, Server, X } from "lucide-react";
import type { AddonCatalog, GenreRow, Movie } from "../lib/types";
import { api } from "../lib/api";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useSettings } from "../lib/settings-context";
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
const DEBOUNCE_MS = 300;

/**
 * Search across the server and the addon catalogs that support it. Results stay on
 * screen while the next query loads; the history only remembers what was actually
 * opened or submitted with Enter.
 */
export function SearchPage({
  userId,
  hasServer,
  genres,
  onOpen,
  onPlay,
  onError,
}: {
  userId: string;
  hasServer: boolean;
  genres: GenreRow[];
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const { settings } = useSettings();
  const addonsKey = `${settings.addons.urls.join("|")}|${settings.addons.cinemeta}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Movie[]>([]);
  const [online, setOnline] = useState<Movie[]>([]);
  const [searched, setSearched] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadSearchHistory(userId));
  const [genre, setGenre] = useState<string | null>(null);
  const [catalogs, setCatalogs] = useState<AddonCatalog[]>([]);
  const request = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Searchable addon catalogs, resolved once instead of on every keystroke.
  useEffect(() => {
    let alive = true;
    api
      .addonsList()
      .then((addons) => {
        if (!alive) return;
        setCatalogs(
          addons
            .flatMap((addon) => addon.catalogs)
            .filter((c) => c.searchable && (c.type === "movie" || c.type === "series"))
            .slice(0, MAX_SEARCH_CATALOGS),
        );
      })
      .catch(() => {
        if (alive) setCatalogs([]);
      });
    return () => {
      alive = false;
    };
  }, [addonsKey]);

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
    const handle = window.setTimeout(async () => {
      const serverJob = hasServer
        ? api.searchItems(trimmed).catch((err) => {
            onErrorRef.current(err instanceof Error ? err.message : String(err));
            return [] as Movie[];
          })
        : Promise.resolve([] as Movie[]);
      const onlineJob = Promise.all(
        catalogs.map((c) =>
          api
            .addonCatalog({ addonUrl: c.addonUrl, type: c.type, id: c.id, search: trimmed })
            .catch(() => []),
        ),
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
    return () => window.clearTimeout(handle);
  }, [query, hasServer, catalogs]);

  const remember = () => {
    const trimmed = query.trim();
    if (trimmed.length >= 2) setHistory(pushSearchHistory(userId, trimmed));
  };
  const open = (movie: Movie) => {
    remember();
    onOpen(movie);
  };
  const play = (movie: Movie) => {
    remember();
    onPlay(movie);
  };

  const active = genre ? genres.find((row) => row.id === genre) : null;
  const showDiscover = query.trim().length < 2;
  const grid = "grid grid-cols-[repeat(auto-fill,minmax(var(--poster-min),1fr))] gap-rail";
  const nothing = searched && !loading && !results.length && !online.length;

  return (
    <div className="page-enter px-page pt-24 pb-16">
      <form
        className={cn(
          "mx-auto mb-8 flex h-14 max-w-[720px] items-center gap-3 rounded-pill border border-white/10 bg-surface pr-2 pl-5 transition-colors duration-150",
        )}
        onSubmit={(e) => {
          e.preventDefault();
          remember();
        }}
      >
        <Search size={20} className="shrink-0 text-dim" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchHint")}
          aria-label={t("search")}
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-text outline-none placeholder:text-dim"
        />
        {loading ? <LoaderCircle size={18} className="shrink-0 animate-spin text-dim" aria-label={t("searching")} /> : null}
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label={t("close")}
            className="icon-hit grid h-10 w-10 shrink-0 place-items-center rounded-full text-dim hover:bg-white/8 hover:text-text"
          >
            <X size={18} />
          </button>
        ) : null}
      </form>

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
                  <span key={item} className="inline-flex h-9 items-stretch overflow-hidden rounded-pill bg-white/6">
                    <button
                      type="button"
                      onClick={() => setQuery(item)}
                      className="btn-press inline-flex items-center pl-3.5 pr-2 text-[13px] font-medium text-text/80 hover:bg-white/8 hover:text-text"
                    >
                      {item}
                    </button>
                    <button
                      type="button"
                      aria-label={`${t("close")} ${item}`}
                      onClick={() => setHistory(removeSearchHistory(userId, item))}
                      className="grid w-8 place-items-center text-dim hover:bg-white/12 hover:text-text"
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
              <h2 className="mb-3 text-[18px] font-semibold">{t("genres")}</h2>
              <div className="no-scrollbar mb-6 flex gap-2 overflow-x-auto pb-1">
                {genres.map((row) => (
                  <Chip key={row.id} selected={genre === row.id} onClick={() => setGenre(genre === row.id ? null : row.id)}>
                    {row.name}
                  </Chip>
                ))}
              </div>
              {active ? (
                <div className={grid}>
                  {active.items.map((movie, i) => (
                    <PosterCard key={movie.id} movie={movie} onOpen={onOpen} onPlay={onPlay} delay={i * 20} />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      ) : (
        <section className={cn("transition-opacity duration-200", loading && searched && "opacity-70")}>
          {!searched && loading ? (
            <div className={grid}>
              {Array.from({ length: 12 }).map((_, i) => (
                <Shimmer key={i} className="aspect-[2/3] rounded-poster" delay={i * 60} />
              ))}
            </div>
          ) : null}
          {results.length ? (
            <>
              <h2 className="mb-4 flex items-center gap-2 text-[18px] font-semibold">
                <Server size={17} className="text-dim" />
                {t("myServer")}
                <span className="text-[13px] font-normal text-dim tabular">{results.length}</span>
              </h2>
              <div className={grid}>
                {results.map((movie, i) => (
                  <PosterCard key={movie.id} movie={movie} onOpen={open} onPlay={play} delay={i * 20} />
                ))}
              </div>
            </>
          ) : null}
          {online.length ? (
            <>
              <h2 className={cn("mb-4 flex items-center gap-2 text-[18px] font-semibold", results.length > 0 && "mt-10")}>
                <Globe size={17} className="text-dim" />
                {t("online")}
                <span className="text-[13px] font-normal text-dim tabular">{online.length}</span>
              </h2>
              <div className={grid}>
                {online.map((movie, i) => (
                  <PosterCard key={movie.id} movie={movie} onOpen={open} onPlay={play} delay={i * 20} />
                ))}
              </div>
            </>
          ) : null}
          {nothing ? <p className="text-muted">{t("noResults")}</p> : null}
        </section>
      )}
    </div>
  );
}
