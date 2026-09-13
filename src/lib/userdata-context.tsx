import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import type { Movie } from "./types";
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

  const setFavorite = useCallback(
    async (movie: Movie, favorite: boolean) => {
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
    [patch, mark],
  );

  const setPlayed = useCallback(
    async (movie: Movie, played: boolean) => {
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
    [patch, mark],
  );

  const value = useMemo<UserDataContextValue>(
    () => ({
      flags: (movie) => ({
        favorite: movie.favorite,
        played: movie.played,
        unplayedCount: movie.unplayedCount,
        playedPercentage: movie.playedPercentage,
        playbackPositionTicks: movie.playbackPositionTicks,
        ...(overrides[movie.id] ?? {}),
      }),
      setFavorite,
      setPlayed,
      pending: (id) => pendingIds.has(id),
      version,
      clearOverrides: () => setOverrides({}),
    }),
    [overrides, pendingIds, version, setFavorite, setPlayed],
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
