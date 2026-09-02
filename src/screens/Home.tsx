import { useEffect, useMemo, useRef, useState } from "react";
import { Nav, libraryView, type NavView } from "../components/Nav";
import { Feed } from "../components/Feed";
import { PosterCard } from "../components/PosterCard";
import { MovieModal } from "../components/MovieModal";
import { SeriesModal } from "../components/SeriesModal";
import { HeroSkeleton, RowSkeleton } from "../components/Skeletons";
import { api } from "../lib/api";
import type { HomeData, Library, Movie, Session } from "../lib/types";
import { sessionAvatar } from "../lib/format";
import { loadAddedLibraries, saveAddedLibraries } from "../lib/libraries";
import { useI18n } from "../lib/locale-context";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function Home({
  session,
  hidden = false,
  refreshToken = 0,
  onPlay,
  onToast,
  onSwitchProfile,
  onLogout,
}: {
  session: Session;
  /** Keep the screen mounted but out of the way while the player runs. */
  hidden?: boolean;
  /** Bump to refresh the data in the background (e.g. after playback). */
  refreshToken?: number;
  onPlay: (movie: Movie) => void;
  onToast: (message: string) => void;
  onSwitchProfile: () => void;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<NavView>("home");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Movie[]>([]);
  const [selected, setSelected] = useState<Movie | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const firstRefresh = useRef(true);

  // Libraries: everything on the server, and the ids the user pinned to the header.
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [added, setAdded] = useState<string[]>(() => loadAddedLibraries(session.userId));
  const [libData, setLibData] = useState<Record<string, HomeData>>({});
  const [libLoading, setLibLoading] = useState<string | null>(null);
  const [libError, setLibError] = useState("");

  const load = async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      setData(await api.getHome());
      if (silent) setError("");
    } catch (err) {
      if (!silent) setError(errorText(err));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadLibrary = async (library: Library, silent = false) => {
    if (!silent) {
      setLibLoading(library.id);
      setLibError("");
    }
    try {
      const next = await api.getHome(library);
      setLibData((map) => ({ ...map, [library.id]: next }));
    } catch (err) {
      if (!silent) setLibError(errorText(err));
    } finally {
      if (!silent) setLibLoading((current) => (current === library.id ? null : current));
    }
  };

  useEffect(() => {
    void load();
    api
      .getLibraries()
      .then(setLibraries)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    saveAddedLibraries(session.userId, added);
  }, [session.userId, added]);

  const pinned = useMemo(
    () => added.map((id) => libraries.find((lib) => lib.id === id)).filter((lib): lib is Library => Boolean(lib)),
    [added, libraries],
  );
  const activeLibrary = view.startsWith("lib:")
    ? pinned.find((lib) => libraryView(lib.id) === view) ?? null
    : null;
  const activeData = activeLibrary ? libData[activeLibrary.id] : undefined;

  useEffect(() => {
    if (activeLibrary && !libData[activeLibrary.id]) void loadLibrary(activeLibrary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLibrary?.id]);

  // Background refresh (keeps current data, scroll and view): continue-watching
  // progress changes after every playback.
  useEffect(() => {
    if (firstRefresh.current) {
      firstRefresh.current = false;
      return;
    }
    void load(true);
    for (const id of Object.keys(libData)) {
      const library = libraries.find((lib) => lib.id === id);
      if (library) void loadLibrary(library, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      if (view === "search") setView("home");
      return;
    }
    setView("search");
    const handle = window.setTimeout(() => {
      api.searchItems(query).then(setResults).catch((err) => {
        onToast(errorText(err));
      });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, onToast]);

  const movies = useMemo(() => data?.all ?? [], [data]);

  const play = (movie: Movie) => {
    setSelected(null);
    if (movie.kind === "Series") {
      // Play on a series: resume the next episode Jellyfin suggests, else the first one.
      api
        .getSeriesNextUp(movie.id)
        .then((episode) => {
          if (episode) onPlay(episode);
          else onToast(t("noEpisodes"));
        })
        .catch((err) => onToast(errorText(err)));
      return;
    }
    onPlay(movie);
  };

  const addLibrary = (library: Library) => {
    setAdded((list) => (list.includes(library.id) ? list : [...list, library.id]));
    setQuery("");
    setView(libraryView(library.id));
  };

  const removeLibrary = (id: string) => {
    setAdded((list) => list.filter((item) => item !== id));
    setLibData((map) => {
      const { [id]: _dropped, ...rest } = map;
      return rest;
    });
    if (view === libraryView(id)) setView("home");
  };

  const seriesId =
    selected?.kind === "Series" ? selected.id : selected?.kind === "Episode" ? selected.seriesId : null;

  return (
    <div className={`h-full bg-base text-text ${hidden ? "invisible" : ""}`} aria-hidden={hidden}>
      <Nav
        userName={session.userName}
        avatarUrl={sessionAvatar(session)}
        view={view}
        onView={(next) => {
          setQuery("");
          setView(next);
        }}
        libraries={pinned}
        available={libraries}
        onAddLibrary={addLibrary}
        onRemoveLibrary={removeLibrary}
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
                <PosterCard key={movie.id} movie={movie} onOpen={setSelected} onPlay={play} delay={i * 30} />
              ))}
            </div>
            {!results.length ? <p className="text-muted">{t("noResults")}</p> : null}
          </div>
        ) : view === "movies" ? (
          <div className="px-12 pt-24 pb-16">
            <h2 className="mb-6 text-[20px] font-semibold">{t("allMovies")}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {movies.map((movie, i) => (
                <PosterCard key={movie.id} movie={movie} onOpen={setSelected} onPlay={play} delay={i * 20} />
              ))}
            </div>
          </div>
        ) : activeLibrary ? (
          activeData ? (
            <Feed
              key={activeLibrary.id}
              data={activeData}
              tv={activeLibrary.collectionType === "tvshows"}
              onOpen={setSelected}
              onPlay={play}
            />
          ) : libError && libLoading !== activeLibrary.id ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <p className="mb-4 text-lg">{t("cannotConnect")}</p>
                <p className="mb-6 text-sm text-muted">{libError}</p>
                <button
                  type="button"
                  onClick={() => void loadLibrary(activeLibrary)}
                  className="btn-press h-11 rounded-md bg-accent px-6 text-sm font-semibold hover:bg-accent-hover"
                >
                  {t("retry")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <HeroSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </>
          )
        ) : data ? (
          <Feed data={data} tv={false} onOpen={setSelected} onPlay={play} />
        ) : null}
      </div>
      {selected && seriesId ? (
        <SeriesModal
          seriesId={seriesId}
          initialSeasonId={selected.kind === "Episode" ? selected.seasonId : null}
          onClose={() => setSelected(null)}
          onPlay={play}
        />
      ) : selected ? (
        <MovieModal movie={selected} onClose={() => setSelected(null)} onPlay={play} />
      ) : null}
    </div>
  );
}
