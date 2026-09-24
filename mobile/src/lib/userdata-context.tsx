import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import type { LibraryEntry, Movie, ResumeEntry } from "./types";
import { libraryEntryOf, libraryToMovie } from "./addons";
import { useI18n } from "./locale-context";

export type ItemFlags = {
  favorite: boolean;
  played: boolean;
  unplayedCount: number | null;
  playedPercentage: number;
  playbackPositionTicks: number;
};

type UserDataContextValue = {
  /** Movie values overlaid with the optimistic overrides of this session. */
  flags: (movie: Movie) => ItemFlags;
  setFavorite: (movie: Movie, favorite: boolean) => Promise<void>;
  setPlayed: (movie: Movie, played: boolean) => Promise<void>;
  /** Take a title out of "Continue watching" without marking it watched. */
  removeProgress: (movie: Movie) => Promise<void>;
  /** Online titles saved to "My list", newest first. */
  onlineList: Movie[];
  /** True while a request for that id is in flight (buttons disable themselves). */
  pending: (id: string) => boolean;
  /** Bumps after every successful mutation; Home refreshes its data on it. */
  version: number;
  /** Drop the overrides once fresh server data has been loaded. */
  clearOverrides: () => void;
};

const UserDataContext = createContext<UserDataContextValue | null>(null);

export function UserDataProvider({
  onError,
  children,
}: {
  onError: (message: string) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [overrides, setOverrides] = useState<Record<string, Partial<ItemFlags>>>({});
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [version, setVersion] = useState(0);
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  const tRef = useRef(t);
  tRef.current = t;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  /** Online titles have no server: their saved / watched marks live in a local list. */
  const [library, setLibrary] = useState<LibraryEntry[]>([]);

  /** Local positions of online titles, so their cards show progress like Jellyfin ones. */
  const [addonProgress, setAddonProgress] = useState<ResumeEntry[]>([]);

  useEffect(() => {
    api
      .addonLibraryList()
      .then(setLibrary)
      .catch(() => undefined);
    const loadProgress = () => {
      api
        .addonProgressList()
        .then(setAddonProgress)
        .catch(() => undefined);
    };
    loadProgress();
    // Positions change while playing; refresh when the player closes.
    const unlisten = api.onPlayerClose(loadProgress);
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const patch = useCallback((id: string, value: Partial<ItemFlags> | null) => {
    setOverrides((current) => {
      const next = { ...current };
      if (value) next[id] = { ...(current[id] ?? {}), ...value };
      else delete next[id];
      return next;
    });
  }, []);

  const mark = useCallback((id: string, busy: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  /** Online title: flip its flag in the local list. False when the movie is not online. */
  const setOnlineFlag = useCallback(
    async (movie: Movie, flags: { saved?: boolean; watched?: boolean }, errorKey: "favoriteError" | "watchedError") => {
      const entry = libraryEntryOf(movie);
      if (!entry) return false;
      mark(movie.id, true);
      try {
        setLibrary(await api.addonLibrarySet({ entry, ...flags }));
        setVersion((n) => n + 1);
      } catch {
        onErrorRef.current(tRef.current(errorKey));
      } finally {
        mark(movie.id, false);
      }
      return true;
    },
    [mark],
  );

  const setFavorite = useCallback(
    async (movie: Movie, favorite: boolean) => {
      if (await setOnlineFlag(movie, { saved: favorite }, "favoriteError")) return;
      const previous = overridesRef.current[movie.id];
      patch(movie.id, { favorite });
      mark(movie.id, true);
      try {
        const confirmed = await api.setFavorite(movie.id, favorite);
        patch(movie.id, { favorite: confirmed });
        setVersion((n) => n + 1);
      } catch {
        patch(movie.id, previous ?? null);
        onErrorRef.current(tRef.current("favoriteError"));
      } finally {
        mark(movie.id, false);
      }
    },
    [patch, mark, setOnlineFlag],
  );

  const setPlayed = useCallback(
    async (movie: Movie, played: boolean) => {
      if (await setOnlineFlag(movie, { watched: played }, "watchedError")) return;
      const previous = overridesRef.current[movie.id];
      patch(
        movie.id,
        played
          ? { played: true, playedPercentage: 0, playbackPositionTicks: 0, unplayedCount: 0 }
          : { played: false, playedPercentage: 0, playbackPositionTicks: 0, unplayedCount: null },
      );
      mark(movie.id, true);
      try {
        const confirmed = await api.setPlayed(movie.id, played);
        patch(movie.id, { played: confirmed });
        setVersion((n) => n + 1);
      } catch {
        patch(movie.id, previous ?? null);
        onErrorRef.current(tRef.current("watchedError"));
      } finally {
        mark(movie.id, false);
      }
    },
    [patch, mark, setOnlineFlag],
  );

  const removeProgress = useCallback(
    async (movie: Movie) => {
      const key = movie.external?.videoId;
      if (!key) {
        // Jellyfin keeps the position on the item: clearing the played state resets it.
        await setPlayed(movie, false);
        return;
      }
      try {
        await api.addonProgressRemove(key);
        setAddonProgress((list) => list.filter((p) => p.key !== key));
        setVersion((n) => n + 1);
      } catch {
        onErrorRef.current(tRef.current("watchedError"));
      }
    },
    [setPlayed],
  );

  const value = useMemo<UserDataContextValue>(
    () => ({
      flags: (movie) => {
        const entry = movie.external ? library.find((e) => e.key === movie.external?.videoId) : null;
        const resume =
          movie.external && !movie.playedPercentage ? addonProgress.find((p) => p.key === movie.external?.videoId) : null;
        const resumePct = resume && resume.durationSeconds > 0 ? Math.min(100, (resume.positionSeconds / resume.durationSeconds) * 100) : 0;
        return {
          favorite: movie.external ? Boolean(entry?.saved) : movie.favorite,
          played: movie.external ? Boolean(entry?.watched) : movie.played,
          unplayedCount: movie.unplayedCount,
          playedPercentage: resumePct || movie.playedPercentage,
          playbackPositionTicks: resume ? Math.round(resume.positionSeconds * 10_000_000) : movie.playbackPositionTicks,
          ...(movie.external ? {} : (overrides[movie.id] ?? {})),
        };
      },
      setFavorite,
      setPlayed,
      removeProgress,
      onlineList: library.filter((entry) => entry.saved).map(libraryToMovie),
      pending: (id) => pendingIds.has(id),
      version,
      clearOverrides: () => setOverrides({}),
    }),
    [overrides, pendingIds, version, setFavorite, setPlayed, removeProgress, library, addonProgress],
  );

  return <UserDataContext.Provider value={value}>{children}</UserDataContext.Provider>;
}

export function useUserData(): UserDataContextValue {
  const ctx = useContext(UserDataContext);
  if (!ctx) throw new Error("useUserData requires UserDataProvider");
  return ctx;
}

/** Flags of one item with the session's optimistic overrides applied. */
export function useItemFlags(movie: Movie): ItemFlags {
  return useUserData().flags(movie);
}
