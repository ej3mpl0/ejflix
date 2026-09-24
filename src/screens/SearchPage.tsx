import { useEffect, useRef, useState } from "react";
import { Compass, Globe, History, Search, SearchX, Server, X } from "lucide-react";
import type { AddonCatalog, GenreRow, Movie } from "../lib/types";
import { api } from "../lib/api";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { errorText } from "../lib/errors";
import { useSettings } from "../lib/settings-context";
import {
  clearSearchHistory,
  loadSearchHistory,
  pushSearchHistory,
  removeSearchHistory,
} from "../lib/search-history";
import { PosterCard } from "../components/PosterCard";
import { Chip } from "../components/Chip";
import { PosterGridItemsSkeleton } from "../components/Skeletons";
import { metaToMovie } from "../lib/addons";
import { EmptyState } from "../components/EmptyState";
import { SegmentedControl } from "../components/settings/SegmentedControl";

const MAX_SEARCH_CATALOGS = 6;
const DEBOUNCE_MS = 300;

/** Accents, case and punctuation dropped, so "Juego de Tronos" answers "juego de tronos". */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How well a title answers the query.
 *
 * Catalogs answer a search with whatever they have, and the wider ones pad the list
 * with titles that merely share a word. Ranking keeps those below the real answer
 * instead of dropping them, because a short query ("got") matches nothing exactly.
 */
function relevance(name: string, query: string): number {
  const title = fold(name);
  const wanted = fold(query);
  if (!wanted) return 0;
  if (title === wanted) return 4;
  if (title.startsWith(wanted)) return 3;
  if (wanted.split(" ").every((word) => title.split(" ").includes(word))) return 2;
  return title.includes(wanted) ? 1 : 0;
}

/**
 * Search across the server and the addon catalogs that support it. The box itself
 * lives in the header, so this only renders what it types: results while there is a
 * query, recent searches and genres while there is not. Results stay on screen while
 * the next query loads; the history only remembers what was actually opened.
 */
export function SearchPage({
  userId,
  query,
  onQuery,
  hasServer,
  genres,
  onOpen,
  onPlay,
  onError,
  onDiscover,
}: {
  userId: string;
  /** What the header's search box holds. */
  query: string;
  onQuery: (query: string) => void;
  hasServer: boolean;
  genres: GenreRow[];
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  onError: (message: string) => void;
  /** Browse Discover instead (offered when a search finds nothing). */
  onDiscover?: () => void;
}) {
  const { t } = useI18n();
  const { settings } = useSettings();
  const addonsKey = `${settings.addons.urls.join("|")}|${settings.addons.cinemeta}`;
  const [results, setResults] = useState<Movie[]>([]);
  const [online, setOnline] = useState<Movie[]>([]);
  const [searched, setSearched] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadSearchHistory(userId));
  const [genre, setGenre] = useState<string | null>(null);
  /** Movies / series filter over the results (both sources). */
  const [kind, setKind] = useState<"all" | "Movie" | "Series">("all");
  const [catalogs, setCatalogs] = useState<AddonCatalog[]>([]);
  const request = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const lastError = useRef("");

  // Searchable addon catalogs, resolved once instead of on every keystroke.
  useEffect(() => {
    let alive = true;
    api
      .addonsList()
      .then((addons) => {
        if (!alive) return;
        // The user's own catalogs lead: they rank better and answer in the user's own
        // language. Cinemeta comes last, for the titles they do not carry.
        const searchable = [...addons]
          .sort((a, b) => Number(a.builtin) - Number(b.builtin))
          .flatMap((addon) => addon.catalogs)
          .filter((c) => c.searchable && (c.type === "movie" || c.type === "series"));
        setCatalogs(searchable.slice(0, MAX_SEARCH_CATALOGS));
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
        ? api
            .searchItems(trimmed)
            .then((list) => {
              lastError.current = "";
              return list;
            })
            .catch((err) => {
              // Once per failure streak, not on every keystroke.
              const message = errorText(t, err);
              if (message !== lastError.current) onErrorRef.current(message);
              lastError.current = message;
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
      for (const movie of lists.flat().map(metaToMovie)) {
        const imdb = movie.external?.imdb;
        if (seen.has(movie.id) || (imdb && known.has(imdb))) continue;
        seen.add(movie.id);
        merged.push(movie);
      }
      // Catalogs answer a search of one type with everything they have of the other,
      // so drop what does not answer the query at all -- unless nothing does, which is
      // what happens with an abbreviation or a cast name.
      const scored = merged.map((movie) => ({ movie, score: relevance(movie.name, trimmed) }));
      const answering = scored.filter((entry) => entry.score > 0);
      const ranked = answering.length ? answering : scored;
      // Stable sort: catalogs that answered precisely keep their own order at the top.
      ranked.sort((a, b) => b.score - a.score);
      merged.length = 0;
      merged.push(...ranked.map((entry) => entry.movie));
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
  const kinds = new Set([...results, ...online].map((movie) => movie.kind));
  const canFilter = kinds.has("Movie") && kinds.has("Series");
  // The filter only applies while it is on screen: a query with one kind shows everything.
  const shownKind = canFilter ? kind : "all";
  const ofKind = (list: Movie[]) => (shownKind === "all" ? list : list.filter((movie) => movie.kind === shownKind));
  const shownResults = ofKind(results);
  const shownOnline = ofKind(online);
  const nothing = searched && !loading && !shownResults.length && !shownOnline.length;
  // Nothing found: earlier searches, a shorter query and the genres to try instead.
  const shorter = searched.split(/\s+/).length > 1 ? searched.split(/\s+/).slice(0, -1).join(" ") : "";
  const suggestions = nothing
    ? [
        ...(shorter.length >= 2 ? [{ label: shorter, icon: <Search size={13} />, run: () => onQuery(shorter) }] : []),
        ...history
          .filter((item) => item.toLowerCase() !== searched.toLowerCase() && item !== shorter)
          .slice(0, 4)
          .map((item) => ({ label: item, icon: <History size={13} />, run: () => onQuery(item) })),
        ...genres.slice(0, 5).map((row) => ({
          label: row.name,
          icon: undefined,
          run: () => {
            onQuery("");
            setGenre(row.id);
          },
        })),
      ]
    : [];

  return (
    <div className="page-enter px-page pt-24 pb-16">
      {showDiscover ? (
        <h1 className="mb-6 text-[28px] font-semibold tracking-[-0.02em]">{t("search")}</h1>
      ) : (
        <h1 className="mb-6 flex items-center gap-3 text-[22px] font-semibold tracking-[-0.01em]">
          <span className="truncate">{t("resultsFor", { query: searched || query })}</span>
          {loading ? (
            <span role="status" aria-label={t("searching")} className="shimmer relative h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-white/10" />
          ) : null}
        </h1>
      )}
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
                      onClick={() => onQuery(item)}
                      className="btn-press inline-flex items-center pl-3.5 pr-2 text-[13px] font-medium text-text/80 hover:bg-white/8 hover:text-text"
                    >
                      {item}
                    </button>
                    <button
                      type="button"
                      aria-label={`${t("removeFromHistory")}: ${item}`}
                      title={t("removeFromHistory")}
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
                    <PosterCard key={movie.id} movie={movie} onOpen={onOpen} onPlay={onPlay} layout="grid" delay={i * 20} />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      ) : (
        <section className={cn("transition-opacity duration-200", loading && searched && "opacity-70")}>
          {/* Announced to screen readers once a search settles. */}
          <p className="sr-only" role="status" aria-live="polite">
            {searched && !loading ? (shownResults.length + shownOnline.length === 1 ? t("resultsCountOne") : t("resultsCount", { n: shownResults.length + shownOnline.length })) : ""}
          </p>
          {canFilter ? (
            <div className="mb-6">
              <SegmentedControl
                label={t("filterType")}
                value={kind}
                onChange={setKind}
                options={[
                  { value: "all", label: t("sourceAll") },
                  { value: "Movie", label: t("movies") },
                  { value: "Series", label: t("series") },
                ]}
              />
            </div>
          ) : null}
          {!searched && loading ? (
            <div className={grid}>
              <PosterGridItemsSkeleton count={12} titles />
            </div>
          ) : null}
          {shownResults.length ? (
            <>
              <h2 className="mb-4 flex items-center gap-2 text-[18px] font-semibold">
                <Server size={17} className="text-dim" />
                {t("myServer")}
                <span className="text-[13px] font-normal text-dim tabular">{shownResults.length}</span>
              </h2>
              <div className={grid}>
                {shownResults.map((movie, i) => (
                  <PosterCard key={movie.id} movie={movie} onOpen={open} onPlay={play} layout="grid" delay={i * 20} />
                ))}
              </div>
            </>
          ) : null}
          {shownOnline.length ? (
            <>
              <h2 className={cn("mb-4 flex items-center gap-2 text-[18px] font-semibold", shownResults.length > 0 && "mt-10")}>
                <Globe size={17} className="text-dim" />
                {t("online")}
                <span className="text-[13px] font-normal text-dim tabular">{shownOnline.length}</span>
              </h2>
              <div className={grid}>
                {shownOnline.map((movie, i) => (
                  <PosterCard key={movie.id} movie={movie} onOpen={open} onPlay={play} layout="grid" delay={i * 20} />
                ))}
              </div>
            </>
          ) : null}
          {nothing ? (
            <EmptyState
              icon={<SearchX size={26} />}
              title={t("noResults")}
              hint={t("noResultsHint")}
              large
              action={onDiscover ? { label: t("exploreAction"), icon: <Compass size={16} />, onClick: onDiscover } : undefined}
            >
              {suggestions.length ? (
                <div className="mt-6">
                  <p className="mb-2 text-[12px] font-semibold tracking-[0.08em] text-dim uppercase">{t("searchSuggestions")}</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {suggestions.map((item) => (
                      <Chip key={item.label} icon={item.icon} onClick={item.run}>
                        {item.label}
                      </Chip>
                    ))}
                  </div>
                </div>
              ) : null}
            </EmptyState>
          ) : null}
        </section>
      )}
    </div>
  );
}
