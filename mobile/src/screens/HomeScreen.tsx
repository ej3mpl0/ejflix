import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, Text, View } from "react-native";
import Animated, { useAnimatedRef, useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Puzzle, WifiOff } from "lucide-react-native";
import { api } from "../lib/api";
import { resumeToMovie } from "../lib/addons";
import { hasServer as sessionHasServer, type AddonInfo, type HomeData, type Library, type Movie } from "../lib/types";
import { useI18n } from "../lib/locale-context";
import { usePlay } from "../lib/play";
import { useSession } from "../lib/session-context";
import { useUserData } from "../lib/userdata-context";
import { mixFeatured, useAddonFeatured } from "../hooks/useAddonFeatured";
import { openDetails } from "../navigation/navigationRef";
import type { MainStackParamList } from "../navigation/types";
import { makeStyles, useTheme } from "../theme/ThemeProvider";
import { useLayout } from "../theme/responsive";
import { text } from "../theme/typography";
import { EmptyCard } from "../components/ui/EmptyCard";
import { HeroSkeleton, RowSkeleton } from "../components/ui/Skeletons";
import { TAB_BAR_HEIGHT } from "../components/ui/Toast";
import { Feed } from "../components/media/Feed";
import { PosterGrid } from "../components/media/PosterGrid";
import {
  GlassHeader,
  HEADER_ROW_HEIGHT,
  SCOPE_ROW_HEIGHT,
  ScopeChips,
  isServerScope,
  scopeLibraryId,
  type Scope,
} from "../components/shell";

/** Home without a server: every row comes from the addons. */
const EMPTY_HOME: HomeData = { featured: [], resume: [], nextUp: [], latest: [], genres: [], all: [] };

const USER_DATA_DEBOUNCE_MS = 300;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Home tab (port of the desktop `Home`): the glass header with its scope chips over a
 * single scroller showing the feed of the active scope. Server data and addon catalogs
 * are mixed in the hero; a missing server leaves an addon-only Home.
 */
export function HomeScreen() {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { session } = useSession();
  const { version: userDataVersion, clearOverrides, onlineList } = useUserData();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const layout = useLayout();
  const play = usePlay();
  const server = sessionHasServer(session);

  const [scope, setScope] = useState<Scope>("home");
  const [home, setHome] = useState<HomeData | null>(null);
  const [libData, setLibData] = useState<Record<string, HomeData>>({});
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [addons, setAddons] = useState<AddonInfo[] | null>(null);
  const [favorites, setFavorites] = useState<Movie[]>([]);
  /** "My list" is the server's favourites plus the online titles saved locally. */
  const myList = useMemo(() => [...onlineList, ...favorites], [onlineList, favorites]);
  const [onlineResume, setOnlineResume] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  /** Bumped by "retry" so a failed library feed is fetched again. */
  const [libToken, setLibToken] = useState(0);

  const scrollY = useSharedValue(0);
  const scroller = useAnimatedRef<Animated.ScrollView>();
  const { featured: addonFeatured, catalogs: addonCatalogs } = useAddonFeatured();
  const librariesRef = useRef<Library[]>([]);
  librariesRef.current = libraries;
  /** Libraries whose feed was loaded at least once (refreshed in the background). */
  const loadedLibs = useRef<string[]>([]);
  const firstToken = useRef(true);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  /**
   * Loads everything the current profile can show. `silent` keeps the visible data
   * (and the scroll position) while progress, favorites and watched flags refresh.
   */
  const refreshAll = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError("");
      }
      const jobs: Promise<unknown>[] = [
        api
          .addonsList()
          .then(setAddons)
          .catch(() => setAddons([])),
        api
          .addonProgressList()
          .then((list) => setOnlineResume(list.map(resumeToMovie)))
          .catch(() => undefined),
      ];
      if (server) {
        jobs.push(
          api
            .getHome()
            .then((data) => {
              setHome(data);
              setError("");
            })
            .catch((err) => {
              if (!silent) setError(errorText(err));
            }),
          api
            .getLibraries()
            .then(setLibraries)
            .catch(() => undefined),
          api
            .getFavorites()
            .then(setFavorites)
            .catch(() => undefined),
        );
        for (const id of loadedLibs.current) {
          const library = librariesRef.current.find((lib) => lib.id === id);
          if (!library) continue;
          jobs.push(
            api
              .getHome(library)
              .then((data) => setLibData((map) => ({ ...map, [id]: data })))
              .catch(() => undefined),
          );
        }
      } else {
        setHome(EMPTY_HOME);
        setLibraries([]);
        setLibData({});
        setFavorites([]);
        setError("");
      }
      await Promise.allSettled(jobs);
      if (!silent) setLoading(false);
    },
    [server],
  );

  useEffect(() => {
    void refreshAll();
  }, [refreshAll, session?.serverUrl]);

  // The server scopes vanish when the server goes away (unlinked): fall back to Home.
  useEffect(() => {
    if (!server && isServerScope(scope)) setScope("home");
  }, [server, scope]);

  // Every scope opens at the top (the scroller is shared between them).
  useEffect(() => {
    scroller.current?.scrollTo({ y: 0, animated: false });
    scrollY.value = 0;
  }, [scope, scroller, scrollY]);

  const activeLibrary = useMemo(() => {
    const id = scopeLibraryId(scope);
    return id ? (libraries.find((lib) => lib.id === id) ?? null) : null;
  }, [scope, libraries]);
  const activeId = activeLibrary?.id ?? null;
  const activeData = activeId ? libData[activeId] : undefined;

  useEffect(() => {
    if (!activeLibrary || libData[activeLibrary.id]) return undefined;
    let alive = true;
    const library = activeLibrary;
    setError("");
    api
      .getHome(library)
      .then((data) => {
        if (!alive) return;
        if (!loadedLibs.current.includes(library.id)) loadedLibs.current.push(library.id);
        setLibData((map) => ({ ...map, [library.id]: data }));
      })
      .catch((err) => {
        if (alive) setError(errorText(err));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, libToken]);

  // Continue watching changes after every playback.
  useEffect(() => {
    const unlisten = api.onPlayerClose(() => setRefreshToken((n) => n + 1));
    return () => {
      void unlisten.then((fn) => fn()).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (firstToken.current) {
      firstToken.current = false;
      return;
    }
    void refreshAll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  // Favorites / watched toggles: reload once the burst of taps settled.
  useEffect(() => {
    if (userDataVersion === 0) return undefined;
    const handle = setTimeout(() => {
      void refreshAll(true).then(clearOverrides);
    }, USER_DATA_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userDataVersion]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refreshAll(true).finally(() => setRefreshing(false));
  }, [refreshAll]);

  const hero = useMemo(() => mixFeatured(home?.featured ?? [], addonFeatured), [home, addonFeatured]);
  const onOpen = useCallback((movie: Movie) => openDetails(movie), []);
  const onPlay = useCallback((movie: Movie) => play(movie), [play]);
  const retry = useCallback(() => {
    if (activeLibrary) {
      setError("");
      setLibData((map) => {
        const { [activeLibrary.id]: _dropped, ...rest } = map;
        return rest;
      });
      setLibToken((n) => n + 1);
      return;
    }
    void refreshAll();
  }, [activeLibrary, refreshAll]);

  const headerH = layout.insets.top + HEADER_ROW_HEIGHT + (server ? SCOPE_ROW_HEIGHT : 0);
  const bottomPad = TAB_BAR_HEIGHT + layout.insets.bottom + 24;
  // Online-only profiles: wait for the addon list so the hero does not flash empty.
  const busy = activeLibrary ? activeData == null && !error : loading || (!server && addonCatalogs == null);

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={t.colors.accent}
      colors={[t.colors.accent]}
      progressBackgroundColor={t.colors.surface}
      progressViewOffset={headerH}
    />
  );

  const header = (
    <GlassHeader scrollY={scrollY}>
      {server ? <ScopeChips scope={scope} onScope={setScope} libraries={libraries} /> : null}
    </GlassHeader>
  );

  if (scope === "mylist") {
    return (
      <View style={s.root}>
        <PosterGrid
          items={myList}
          onOpen={onOpen}
          onPlay={onPlay}
          extraData={userDataVersion}
          header={
            <View style={{ paddingTop: headerH + 20, paddingBottom: 16 }}>
              <Text style={s.gridTitle}>{tr("myList")}</Text>
            </View>
          }
          empty={<EmptyCard title={tr("emptyList")} hint={tr("emptyListHint")} />}
          contentContainerStyle={{ paddingBottom: bottomPad }}
          onScroll={onScroll}
          refreshControl={refreshControl}
        />
        {header}
      </View>
    );
  }

  const noAddons = (
    <View style={{ paddingHorizontal: layout.pagePad }}>
      <EmptyCard
        icon={Puzzle}
        title={tr("noAddonsYet")}
        hint={tr("noAddonsYetHint")}
        actionLabel={tr("goToAddons")}
        onAction={() => navigation.navigate("SettingsSection", { section: "addons" })}
      />
    </View>
  );

  let body: React.ReactNode = null;
  if (error && !activeData && (activeLibrary || !home)) {
    body = (
      <View style={{ paddingTop: headerH + 48, paddingHorizontal: layout.pagePad }}>
        <EmptyCard icon={WifiOff} title={tr("cannotConnect")} hint={error} actionLabel={tr("retry")} onAction={retry} />
      </View>
    );
  } else if (busy) {
    body = (
      <>
        <HeroSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </>
    );
  } else if (activeLibrary && activeData) {
    body = (
      <Feed
        key={activeLibrary.id}
        data={activeData}
        tv={activeLibrary.collectionType === "tvshows"}
        topInset={headerH + 12}
        scrollY={scrollY}
        onOpen={onOpen}
        onPlay={onPlay}
      />
    );
  } else if (home) {
    const main = scope === "home";
    body = (
      <Feed
        key={main ? "home" : "myserver"}
        data={home}
        tv={false}
        featured={main ? hero : undefined}
        myList={myList}
        onlineResume={main ? onlineResume : []}
        showAddons={main}
        empty={main && !addons?.length ? noAddons : null}
        topInset={headerH + 12}
        scrollY={scrollY}
        onOpen={onOpen}
        onPlay={onPlay}
      />
    );
  }

  return (
    <View style={s.root}>
      <Animated.ScrollView
        ref={scroller}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomPad }}
        refreshControl={refreshControl}
      >
        {body}
      </Animated.ScrollView>
      {header}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.base },
  gridTitle: { ...text(26, "semibold", { tracking: -0.02 }), color: t.colors.text },
}));
