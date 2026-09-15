import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Puzzle } from "lucide-react";
import { GlassHeader, libraryView, type NavView } from "../components/GlassHeader";
import { Feed } from "../components/Feed";
import { PosterCard } from "../components/PosterCard";
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
  onToast: (message: string) => void;
  /** The account changed (profile edited, server linked or unlinked). */
  onSessionChange: (session: Session) => void;
  onSwitchProfile: () => void;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const { version: userDataVersion, clearOverrides } = useUserData();
  const hasServer = sessionHasServer(session);
  const [data, setData] = useState<HomeData | null>(null);
  const [favorites, setFavorites] = useState<Movie[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<NavView>("home");
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
  const firstRefresh = useRef(true);
  const { featured: addonFeatured, catalogs: addonCatalogs } = useAddonFeatured();

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
    if (!hasServer && (view === "myserver" || view === "mylist" || view.startsWith("lib:"))) setView("home");
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

  const hero = useMemo(() => mixFeatured(data?.featured ?? [], addonFeatured), [data, addonFeatured]);

  const openView = (next: NavView) => {
    setStack([]);
    if (next !== "settings") setSettingsSection(undefined);
    if (next === view) return;
    history.current = [...history.current.slice(-(HISTORY_MAX - 1)), view];
    setView(next);
    scroller.current?.scrollTo({ top: 0 });
  };

  const back = () => {
    const previous = history.current.pop() ?? "home";
    setView(previous);
  };

  /** Settings opened on a given section (e.g. the TV tab's "configure IPTV"). */
  const openSettings = (section: SettingsSectionId) => {
    setSettingsSection(section);
    if (view === "settings") return;
    history.current = [...history.current.slice(-(HISTORY_MAX - 1)), view];
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
  useBackNavigation(hasStack || picker || view === "home" ? null : back);

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

  // Nothing at all to show (online profile without addons): point at Settings › Addons.
  const noAddons = (
    <div className="px-page pt-16">
      <div className="mx-auto max-w-[560px] rounded-card bg-surface px-8 py-12 text-center">
        <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
          <Puzzle size={26} />
        </span>
        <p className="text-[18px] font-semibold">{t("noAddonsYet")}</p>
        <p className="mt-1 text-[13px] text-dim">{t("noAddonsYetHint")}</p>
        <button
          type="button"
          onClick={() => openView("settings")}
          className="btn-press mt-6 h-11 rounded-btn bg-accent px-6 text-sm font-semibold text-on-accent hover:bg-accent-hover"
        >
          {t("goToAddons")}
        </button>
      </div>
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
            hasServer={hasServer}
            genres={data?.genres ?? []}
            onOpen={openDetails}
            onPlay={play}
            onError={onToast}
          />
        ) : view === "discover" ? (
          <Discover hasServer={hasServer} onOpen={openDetails} onPlay={play} onError={onToast} />
        ) : error ? (
          retry
        ) : homeLoading ? (
          skeleton
        ) : view === "mylist" ? (
          grid(t("myList"), favorites ?? [], { text: t("emptyList"), hint: t("emptyListHint") })
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
            empty={noAddons}
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
