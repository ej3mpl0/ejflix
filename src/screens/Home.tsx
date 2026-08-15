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
  const [view, setView] = useState<"home" | "movies" | "search">("home");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Movie[]>([]);
  const [selected, setSelected] = useState<Movie | null>(null);
  const [scrolled, setScrolled] = useState(false);

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
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      if (view === "search") setView("home");
      return;
    }
    setView("search");
    const handle = window.setTimeout(() => {
      api.searchItems(query).then(setResults).catch((err) => {
        onToast(err instanceof Error ? err.message : String(err));
      });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, onToast]);

  const movies = useMemo(() => data?.all ?? [], [data]);

  return (
    <div className="h-full bg-base text-text">
      <Nav
        userName={session.userName}
        avatarUrl={sessionAvatar(session)}
        view={view === "search" ? "search" : view}
        onView={(next) => {
          setQuery("");
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
            <h2 className="mb-6 text-[20px] font-semibold">{t("resultsFor", { query })}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {results.map((movie, i) => (
                <PosterCard key={movie.id} movie={movie} onOpen={setSelected} delay={i * 30} />
              ))}
            </div>
            {!results.length ? <p className="text-muted">{t("noResults")}</p> : null}
          </div>
        ) : view === "movies" ? (
          <div className="px-12 pt-24 pb-16">
            <h2 className="mb-6 text-[20px] font-semibold">{t("allMovies")}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {movies.map((movie, i) => (
                <PosterCard key={movie.id} movie={movie} onOpen={setSelected} delay={i * 20} />
              ))}
            </div>
          </div>
        ) : (
          <>
            {data?.featured ? (
              <HeroBanner movie={data.featured} onPlay={onPlay} onMore={setSelected} />
            ) : (
              <div className="h-24" />
            )}
            <div className="enter enter-d4 relative z-10 -mt-6 pb-16">
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
        <MovieModal movie={selected} onClose={() => setSelected(null)} onPlay={onPlay} />
      ) : null}
    </div>
  );
}
