import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Puzzle, RotateCcw, WifiOff } from "lucide-react";
import { GlassHeader, libraryView, type NavView } from "../components/GlassHeader";
import { Feed } from "../components/Feed";
import { HeroSkeleton, RowSkeleton } from "../components/Skeletons";
import { Settings, type SettingsSectionId } from "./Settings";
import { SearchPage } from "./SearchPage";
import { Discover } from "./Discover";
import { LiveTv } from "./LiveTv";
import { DetailsPage } from "./DetailsPage";
import { ExternalDetailsPage } from "./ExternalDetailsPage";
import { StreamPicker } from "../components/StreamPicker";
import { resumeToMovie } from "../lib/addons";
import { api } from "../lib/api";
import {
  hasServer as sessionHasServer,
  type HomeData,
  type IptvSource,
  type Library,
  type Movie,
  type SavedServer,
  type Session,
} from "../lib/types";
import { sessionAvatar } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useSettings } from "../lib/settings-context";
import { useUserData } from "../lib/userdata-context";
import { useBackNavigation } from "../lib/use-back";
import { routeFor, type DetailsRoute } from "../lib/view-stack";
import { mixFeatured, useAddonFeatured } from "../hooks/useAddonFeatured";
import { EmptyState } from "../components/EmptyState";
import { SeeAllContext, type SeeAllRequest } from "../lib/see-all-context";
import { SeeAllPage } from "./SeeAllPage";
import { handlePosterArrows } from "../lib/poster-nav";
import { Shimmer } from "../components/Shimmer";
import { CalendarPage } from "./CalendarPage";
import { MyListPage } from "./MyListPage";
import { useCalendar } from "../lib/calendar";

const PAGE_EXIT_MS = 250;

/** Home without a server: every row comes from the addons. */
const EMPTY_HOME: HomeData = { featured: [], resume: [], nextUp: [], latest: [], genres: [], all: [] };

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
  playFailed = 0,
  onPlay,
  onToast,
  onSessionChange,
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
  /** Bumped when the player failed to start: bring the sources sheet back. */
  playFailed?: number;
  onPlay: (movie: Movie) => void;
  onToast: (message: string, action?: { label: string; run: () => void }) => void;
  /** The account changed (profile edited, server linked or unlinked). */
  onSessionChange: (session: Session) => void;
  onSwitchProfile: () => void;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const { version: userDataVersion, clearOverrides, onlineList } = useUserData();
  const hasServer = sessionHasServer(session);
  const [data, setData] = useState<HomeData | null>(null);
  const [favorites, setFavorites] = useState<Movie[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<NavView>("home");
  /** The header owns the search box; the search view only renders what it types. */
  const [search, setSearch] = useState("");
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId | undefined>(undefined);
  /** IPTV lists of the profile (the TV tab shows up when there is at least one). */
  const [tvSources, setTvSources] = useState<IptvSource[]>([]);
  const history = useRef<NavView[]>([]);
  /** Details pages stacked over the current tab (a "More like this" click adds one). */
  const [stack, setStack] = useState<DetailsRoute[]>([]);
  /** Online title waiting for a stream to be chosen. */
  const [picker, setPicker] = useState<Movie | null>(null);
  /** The sheet a stream was launched from, so a failed start can reopen it. */
  const lastPicker = useRef<Movie | null>(null);
  const [onlineResume, setOnlineResume] = useState<Movie[]>([]);
  const [scrolled, setScrolled] = useState(false);
  const scrolledRef = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const scrollOf = useRef(new Map<NavView, number>());
  /** A row opened as a full grid, over the current view. */
  const [seeAll, setSeeAll] = useState<SeeAllRequest | null>(null);
  const firstRefresh = useRef(true);
  const { featured: addonFeatured, catalogs: addonCatalogs } = useAddonFeatured();
  /** Episodes aired since the calendar was last opened: a counter on its tab. */
  const { fresh: newEpisodes } = useCalendar(hasServer, session.userId);

  // The player could not start: put the user back in front of the other sources.
  useEffect(() => {
    if (!playFailed) return;
    const movie = lastPicker.current;
    lastPicker.current = null;
    if (movie) setPicker(movie);
  }, [playFailed]);

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
    if (!hasServer) {
      setData(EMPTY_HOME);
      setError("");
      setLoading(false);
      return;
    }
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
    if (hasServer) {
      try {
        setFavorites(await api.getFavorites());
      } catch {
        /* the list is optional; keep what we have */
      }
    } else {
      setFavorites([]);
    }
    try {
      setOnlineResume((await api.addonProgressList()).map(resumeToMovie));
    } catch {
      /* no addons or nothing remembered */
    }
  }, [hasServer]);

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
    if (hasServer) {
      api
        .getLibraries()
        .then(setLibraries)
        .catch(() => undefined);
    } else {
      setLibraries([]);
      setLibData({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadFavorites, hasServer, session.serverUrl]);

  // IPTV: sources with their loaded state, kept fresh while playlists download.
  useEffect(() => {
    let alive = true;
    const load = () => {
      api
        .iptvStatus()
        .then((status) => {
          if (alive) setTvSources(status.sources);
        })
        .catch(() => {
          if (alive) setTvSources([]);
        });
    };
    load();
    const unlisten = api.onIptvChanged(load);
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, [session.userId]);

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

  // Server tabs vanish when the server goes away (unlinked): fall back to Home.
  useEffect(() => {
    if (!hasServer && (view === "myserver" || view.startsWith("lib:"))) setView("home");
  }, [hasServer, view]);

  // The TV tab disappears with the last IPTV list.
  useEffect(() => {
    if (view === "tv" && !tvSources.length) setView("home");
  }, [tvSources.length, view]);

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

  // Lists or progress pulled from another PC by the account: refresh in the background.
  const refreshRef = useRef(refreshAll);
  refreshRef.current = refreshAll;
  useEffect(() => {
    const unlisten = api.onAccountSynced((report) => {
      if (report.pulled.some((kind) => kind === "progress" || kind === "lists")) void refreshRef.current();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const hero = useMemo(() => mixFeatured(data?.featured ?? [], addonFeatured), [data, addonFeatured]);

  /** "My list" is the server's favourites plus the online titles saved locally. */
  const myList = useMemo(() => [...onlineList, ...(favorites ?? [])], [onlineList, favorites]);

  /** Push the current view on the back stack together with where it was scrolled to. */
  const remember = () => {
    history.current = [...history.current.slice(-(HISTORY_MAX - 1)), view];
    scrollOf.current.set(view, scroller.current?.scrollTop ?? 0);
  };

  const openView = (next: NavView) => {
    setStack([]);
    setSeeAll(null);
    if (next !== "settings") setSettingsSection(undefined);
    // Leaving the search view empties the box, so the header stops showing a stale query.
    if (next !== "search") setSearch("");
    if (next === view) return;
    remember();
    setSeeAll(null);
    setView(next);
    scroller.current?.scrollTo({ top: 0 });
  };

  const back = () => {
    const previous = history.current.pop() ?? "home";
    if (previous !== "search") setSearch("");
    setView(previous);
    const top = scrollOf.current.get(previous) ?? 0;
    // Wait for the previous view to render before putting it back where it was.
    requestAnimationFrame(() => requestAnimationFrame(() => scroller.current?.scrollTo({ top })));
  };

  /** Switching to the search view without wiping what is being typed. */
  const openSearch = () => {
    if (view === "search") return;
    setStack([]);
    setSettingsSection(undefined);
    remember();
    setSeeAll(null);
    setView("search");
    scroller.current?.scrollTo({ top: 0 });
  };

  /** Settings opened on a given section (e.g. the TV tab's "configure IPTV"). */
  const openSettings = (section: SettingsSectionId) => {
    setSettingsSection(section);
    if (view === "settings") return;
    remember();
    setSeeAll(null);
    setStack([]);
    setView("settings");
    scroller.current?.scrollTo({ top: 0 });
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
  useBackNavigation(hasStack || picker || seeAll || view === "home" ? null : back);

  const play = (movie: Movie) => {
    if (movie.live) {
      onPlay(movie);
      return;
    }
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

  const removeLibrary = (id: string) => {
    setAdded(added.filter((item) => item !== id));
    setLibData((map) => {
      const { [id]: _dropped, ...rest } = map;
      return rest;
    });
    if (view === libraryView(id)) setView("home");
  };

  const retry = (
    <div className="grid h-full place-items-center px-6">
      <EmptyState
        large
        icon={<WifiOff size={26} />}
        title={t("cannotConnect")}
        hint={error || libError}
        action={{
          label: t("retry"),
          icon: <RotateCcw size={16} />,
          onClick: () => (activeLibrary ? void loadLibrary(activeLibrary) : void load()),
        }}
      />
    </div>
  );

  // Nothing at all to show (online profile without addons): point at Settings › Addons.
  const noAddons = (
    <div className="px-page pt-16">
      <EmptyState
        large
        icon={<Puzzle size={26} />}
        title={t("noAddonsYet")}
        hint={t("noAddonsYetHint")}
        action={{ label: t("goToAddons"), onClick: () => openView("settings") }}
      />
    </div>
  );

  const skeleton = (
    <>
      <HeroSkeleton />
      <RowSkeleton />
      <RowSkeleton />
    </>
  );

  // Online-only profiles: wait for the addon list so the hero does not flash empty.
  const homeLoading = loading || (!hasServer && addonCatalogs == null);

  return (
    <div className={`h-full bg-base text-text ${hidden ? "invisible" : ""}`} aria-hidden={hidden}>
      <GlassHeader
        userName={session.userName}
        avatarUrl={sessionAvatar(session)}
        mode={session.mode}
        hasServer={hasServer}
        hasTv={tvSources.length > 0}
        badges={{ calendar: newEpisodes.length }}
        view={view}
        onView={openView}
        libraries={pinned}
        onRemoveLibrary={removeLibrary}
        search={search}
        onSearch={(query) => {
          setSearch(query);
          if (query && view !== "search") openSearch();
        }}
        onSearchFocus={openSearch}
        scrolled={scrolled}
        hidden={hasStack || seeAll != null}
        onSwitchProfile={onSwitchProfile}
        onLogout={onLogout}
      />
      <SeeAllContext.Provider value={setSeeAll}>
      <div
        ref={scroller}
        className="h-full overflow-y-auto"
        inert={hasStack || seeAll != null}
        onKeyDown={(e) => handlePosterArrows(e, scroller.current)}
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
            initialSection={settingsSection}
            onSessionChange={onSessionChange}
            onSwitchProfile={onSwitchProfile}
            onLogout={onLogout}
            onBack={back}
            onToast={onToast}
          />
        ) : view === "tv" ? (
          <LiveTv sources={tvSources} refreshToken={refreshToken} onPlay={play} onError={onToast} onSettings={() => openSettings("iptv")} />
        ) : view === "search" ? (
          <SearchPage
            userId={session.userId}
            query={search}
            onQuery={setSearch}
            hasServer={hasServer}
            genres={data?.genres ?? []}
            onOpen={openDetails}
            onPlay={play}
            onError={onToast}
          />
        ) : view === "discover" ? (
          <Discover hasServer={hasServer} onOpen={openDetails} onPlay={play} onError={onToast} />
        ) : view === "calendar" ? (
          <CalendarPage userId={session.userId} hasServer={hasServer} onOpen={openDetails} onPlay={play} />
        ) : error ? (
          retry
        ) : homeLoading && view === "mylist" ? (
          // "My list" is a grid: its placeholder is one too.
          <div className="px-page pt-24 pb-16">
            <Shimmer className="mb-6 h-7 w-40 rounded" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--poster-min),1fr))] gap-rail">
              {Array.from({ length: 12 }).map((_, i) => (
                <Shimmer key={i} className="aspect-[2/3] rounded-poster" delay={i * 40} />
              ))}
            </div>
          </div>
        ) : homeLoading ? (
          skeleton
        ) : view === "mylist" ? (
          <MyListPage items={myList} hasServer={hasServer} onOpen={openDetails} onPlay={play} />
        ) : view === "myserver" && data ? (
          <Feed key="myserver" data={data} tv={false} myList={favorites ?? []} onOpen={openDetails} onPlay={play} />
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
            skeleton
          )
        ) : data ? (
          <Feed
            key="home"
            data={data}
            tv={false}
            featured={hero}
            myList={favorites ?? []}
            onlineResume={onlineResume}
            showAddons
            personal={{ userId: session.userId, hasServer }}
            empty={noAddons}
            onOpen={openDetails}
            onPlay={play}
          />
        ) : null}
      </div>
      </SeeAllContext.Provider>
      {seeAll ? (
        <SeeAllPage
          key={seeAll.title}
          request={seeAll}
          top={!hasStack && !picker}
          onBack={() => setSeeAll(null)}
          onOpen={openDetails}
          onPlay={play}
        />
      ) : null}
      {stack.map((route, i) =>
        route.seed?.external ? (
          <ExternalDetailsPage
            key={route.key}
            route={route}
            top={i === stack.length - 1 && !picker}
            onBack={popDetails}
            onOpen={openDetails}
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
          onToast={onToast}
          onClose={() => setPicker(null)}
          onPlay={(movie, stream) => {
            lastPicker.current = picker;
            setPicker(null);
            if (!movie.external) return;
            onPlay({ ...movie, external: { ...movie.external, stream } });
          }}
        />
      ) : null}
    </div>
  );
}
