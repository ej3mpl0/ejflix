import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GlassHeader, libraryView, type NavView } from "../components/GlassHeader";
import { Feed } from "../components/Feed";
import { PosterCard } from "../components/PosterCard";
import { HeroSkeleton, RowSkeleton } from "../components/Skeletons";
import { Settings } from "./Settings";
import { SearchPage } from "./SearchPage";
import { DetailsPage } from "./DetailsPage";
import { ExternalDetailsPage } from "./ExternalDetailsPage";
import { StreamPicker } from "../components/StreamPicker";
import { resumeToMovie } from "../lib/addons";
import { api } from "../lib/api";
import type { HomeData, Library, Movie, SavedServer, Session } from "../lib/types";
import { sessionAvatar } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useSettings } from "../lib/settings-context";
import { useUserData } from "../lib/userdata-context";
import { useBackNavigation } from "../lib/use-back";
import { routeFor, type DetailsRoute } from "../lib/view-stack";

const PAGE_EXIT_MS = 250;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const HISTORY_MAX = 10;

export function Home({
  session,
  server,
  version,
  hidden = false,
  refreshToken = 0,
  onPlay,
  onToast,
  onSwitchProfile,
  onLogout,
}: {
  session: Session;
  server: SavedServer | null;
  version: string | null;
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
  const { version: userDataVersion, clearOverrides } = useUserData();
  const [data, setData] = useState<HomeData | null>(null);
  const [favorites, setFavorites] = useState<Movie[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<NavView>("home");
  const history = useRef<NavView[]>([]);
  /** Details pages stacked over the current tab (a "More like this" click adds one). */
  const [stack, setStack] = useState<DetailsRoute[]>([]);
  /** Online title waiting for a stream to be chosen. */
  const [picker, setPicker] = useState<Movie | null>(null);
  const [onlineResume, setOnlineResume] = useState<Movie[]>([]);
  const [scrolled, setScrolled] = useState(false);
  const scrolledRef = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const firstRefresh = useRef(true);

  // Libraries: everything on the server, and the ids the user pinned to the header
  // (persisted with the profile settings).
  const { settings, update: updateSettings } = useSettings();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const added = settings.library.pinned;
  const setAdded = (next: string[]) => void updateSettings({ library: { pinned: next } });
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

  const loadFavorites = useCallback(async () => {
    try {
      setFavorites(await api.getFavorites());
    } catch {
      /* the list is optional; keep what we have */
    }
    try {
      setOnlineResume((await api.addonProgressList()).map(resumeToMovie));
    } catch {
      /* no addons or nothing remembered */
    }
  }, []);

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
    void loadFavorites();
    api
      .getLibraries()
      .then(setLibraries)
      .catch(() => undefined);
  }, [loadFavorites]);

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
  // progress changes after every playback, favorites/watched after every toggle.
  const refreshAll = useCallback(async () => {
    const jobs: Promise<unknown>[] = [load(true), loadFavorites()];
    for (const id of Object.keys(libData)) {
      const library = libraries.find((lib) => lib.id === id);
      if (library) jobs.push(loadLibrary(library, true));
    }
    await Promise.allSettled(jobs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libData, libraries, loadFavorites]);

  useEffect(() => {
    if (firstRefresh.current) {
      firstRefresh.current = false;
      return;
    }
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  useEffect(() => {
    if (userDataVersion === 0) return;
    const handle = window.setTimeout(() => {
      void refreshAll().then(clearOverrides);
    }, 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userDataVersion]);

  const movies = useMemo(() => data?.all ?? [], [data]);

  const openView = (next: NavView) => {
    setStack([]);
    if (next === view) return;
    history.current = [...history.current.slice(-(HISTORY_MAX - 1)), view];
    setView(next);
    scroller.current?.scrollTo({ top: 0 });
  };

  const back = () => {
    const previous = history.current.pop() ?? "home";
    setView(previous);
  };

  const openDetails = (movie: Movie) => {
    const route = routeFor(movie);
    setStack((current) => {
      const topRoute = current[current.length - 1];
      // Re-opening the page that is already on top just keeps it.
      if (topRoute && topRoute.id === route.id && !topRoute.leaving) return current;
      return [...current, route];
    });
  };

  const popDetails = () => {
    setStack((current) => {
      if (!current.length) return current;
      const top = current[current.length - 1];
      if (top.leaving) return current;
      return [...current.slice(0, -1), { ...top, leaving: true }];
    });
    window.setTimeout(() => {
      setStack((current) => current.filter((route) => !route.leaving));
    }, PAGE_EXIT_MS);
  };

  const hasStack = stack.length > 0;
  useBackNavigation(hasStack || picker || view === "home" ? null : back);

  const play = (movie: Movie) => {
    if (movie.external) {
      if (movie.external.stream) {
        onPlay(movie);
      } else if (movie.kind === "Series") {
        openDetails(movie);
      } else {
        setPicker(movie);
      }
      return;
    }
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
    if (!added.includes(library.id)) setAdded([...added, library.id]);
    openView(libraryView(library.id));
  };

  const removeLibrary = (id: string) => {
    setAdded(added.filter((item) => item !== id));
    setLibData((map) => {
      const { [id]: _dropped, ...rest } = map;
      return rest;
    });
    if (view === libraryView(id)) setView("home");
  };

  const retry = (
    <div className="grid h-full place-items-center px-6 text-center">
      <div>
        <p className="mb-4 text-lg">{t("cannotConnect")}</p>
        <p className="mb-6 text-sm text-muted">{error || libError}</p>
        <button
          type="button"
          onClick={() => (activeLibrary ? void loadLibrary(activeLibrary) : void load())}
          className="btn-press h-11 rounded-btn bg-accent px-6 text-sm font-semibold text-on-accent hover:bg-accent-hover"
        >
          {t("retry")}
        </button>
      </div>
    </div>
  );

  const grid = (title: string, items: Movie[], empty?: { text: string; hint: string }) => (
    <div className="page-enter px-page pt-24 pb-16">
      <h2 className="mb-6 text-[22px] font-semibold tracking-[-0.01em]">{title}</h2>
      {items.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--poster-min),1fr))] gap-rail">
          {items.map((movie, i) => (
            <PosterCard key={movie.id} movie={movie} onOpen={openDetails} onPlay={play} delay={i * 20} />
          ))}
        </div>
      ) : empty ? (
        <div className="rounded-card bg-surface px-8 py-12 text-center">
          <p className="text-[16px] font-medium">{empty.text}</p>
          <p className="mt-1 text-[13px] text-dim">{empty.hint}</p>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className={`h-full bg-base text-text ${hidden ? "invisible" : ""}`} aria-hidden={hidden}>
      <GlassHeader
        userName={session.userName}
        avatarUrl={sessionAvatar(session)}
        view={view}
        onView={openView}
        libraries={pinned}
        available={libraries}
        onAddLibrary={addLibrary}
        onRemoveLibrary={removeLibrary}
        scrolled={scrolled}
        hidden={hasStack}
        onSwitchProfile={onSwitchProfile}
        onLogout={onLogout}
      />
      <div
        ref={scroller}
        className="h-full overflow-y-auto"
        inert={hasStack}
        onScroll={(e) => {
          const y = e.currentTarget.scrollTop;
          e.currentTarget.style.setProperty("--scroll-y", String(y));
          const next = y > 24;
          if (next !== scrolledRef.current) {
            scrolledRef.current = next;
            setScrolled(next);
          }
        }}
      >
        {view === "settings" ? (
          <Settings
            session={session}
            server={server}
            version={version}
            onSwitchProfile={onSwitchProfile}
            onLogout={onLogout}
            onBack={back}
            onToast={onToast}
          />
        ) : view === "search" ? (
          <SearchPage
            userId={session.userId}
            genres={data?.genres ?? []}
            onOpen={openDetails}
            onPlay={play}
            onError={onToast}
          />
        ) : error ? (
          retry
        ) : loading ? (
          <>
            <HeroSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </>
        ) : view === "mylist" ? (
          grid(t("myList"), favorites ?? [], { text: t("emptyList"), hint: t("emptyListHint") })
        ) : view === "movies" ? (
          grid(t("allMovies"), movies)
        ) : activeLibrary ? (
          activeData ? (
            <Feed
              key={activeLibrary.id}
              data={activeData}
              tv={activeLibrary.collectionType === "tvshows"}
              onOpen={openDetails}
              onPlay={play}
            />
          ) : libError && libLoading !== activeLibrary.id ? (
            retry
          ) : (
            <>
              <HeroSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </>
          )
        ) : data ? (
          <Feed
            data={data}
            tv={false}
            myList={favorites ?? []}
            onlineResume={onlineResume}
            showAddons
            onOpen={openDetails}
            onPlay={play}
          />
        ) : null}
      </div>
      {stack.map((route, i) =>
        route.seed?.external ? (
          <ExternalDetailsPage
            key={route.key}
            route={route}
            top={i === stack.length - 1 && !picker}
            onBack={popDetails}
            onPlay={play}
          />
        ) : (
          <DetailsPage
            key={route.key}
            route={route}
            top={i === stack.length - 1 && !picker}
            onBack={popDetails}
            onPush={openDetails}
            onPlay={play}
            onOnline={(movie) => setPicker(movie)}
          />
        ),
      )}
      {picker ? (
        <StreamPicker
          movie={picker}
          onClose={() => setPicker(null)}
          onPlay={(movie, stream) => {
            setPicker(null);
            if (!movie.external) return;
            onPlay({ ...movie, external: { ...movie.external, stream } });
          }}
        />
      ) : null}
    </div>
  );
}
