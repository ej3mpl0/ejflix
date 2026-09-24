import {
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
import { emptyMovie, libraryToMovie } from "./addons";
import type { CustomList, ListItem, Movie } from "./types";
import { ListPickerDialog } from "../components/ListPickerDialog";

/** Identity of a title inside a custom list; null for what cannot be listed (channels). */
export function listKeyOf(movie: Movie): string | null {
  if (movie.live) return null;
  if (movie.external) return movie.external.videoId;
  return `jf:${movie.id}`;
}

/** What a custom list keeps of a title: enough to draw its card and to open it. */
export function listItemOf(movie: Movie): Omit<ListItem, "addedMs"> | null {
  const key = listKeyOf(movie);
  if (!key) return null;
  const ext = movie.external;
  return {
    key,
    source: ext ? "online" : "jellyfin",
    type: ext ? ext.type : movie.kind,
    itemId: ext ? null : movie.id,
    metaId: ext ? ext.metaId : null,
    name: movie.name,
    seriesName: movie.seriesName,
    poster: movie.posterUrl,
    year: movie.year,
    season: ext ? ext.season : movie.seasonNumber,
    episode: ext ? ext.episode : movie.episodeNumber,
    imdb: ext ? ext.imdb : (movie.providerIds.Imdb ?? null),
  };
}

/** Card item from what the list stored (a Jellyfin item until the server answers). */
function snapshotMovie(item: ListItem): Movie {
  if (item.source === "online") {
    return libraryToMovie({
      key: item.key,
      type: item.type,
      metaId: item.metaId ?? item.key,
      name: item.name,
      seriesName: item.seriesName,
      poster: item.poster,
      background: null,
      logo: null,
      year: item.year,
      season: item.season,
      episode: item.episode,
      imdb: item.imdb,
      saved: false,
      watched: false,
      updatedMs: item.addedMs,
    });
  }
  return {
    ...emptyMovie(item.itemId ?? item.key, item.type, item.name),
    seriesName: item.seriesName,
    seasonNumber: item.season,
    episodeNumber: item.episode,
    year: item.year,
    posterUrl: item.poster,
    backdropUrl: item.poster,
  };
}

type ListsContextValue = {
  lists: CustomList[];
  /** The list's titles as cards, newest first (Jellyfin items with fresh server data). */
  moviesOf: (list: CustomList) => Movie[];
  /** Ids of the lists that hold this title. */
  listsWith: (movie: Movie) => string[];
  create: (name: string) => Promise<CustomList | null>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setItem: (id: string, movie: Movie, on: boolean) => Promise<void>;
  /** Opens the "Add to a list" dialog for a title. */
  openPicker: (movie: Movie) => void;
};

const ListsContext = createContext<ListsContextValue | null>(null);

export function CustomListsProvider({
  version,
  onError,
  children,
}: {
  /** Bumps after every watched / favourite change: server data is fetched again. */
  version: number;
  onError: (message: string) => void;
  children: ReactNode;
}) {
  const [lists, setLists] = useState<CustomList[]>([]);
  /** Fresh Jellyfin items by id; missing ones fall back to what the list stored. */
  const [resolved, setResolved] = useState<Record<string, Movie>>({});
  const [picker, setPicker] = useState<Movie | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .customListsGet()
        .then((next) => {
          if (alive) setLists(next);
        })
        .catch(() => undefined);
    void load();
    // The account brought lists from another PC.
    const unlisten = api.onAccountSynced((report) => {
      if (report.pulled.includes("lists")) void load();
    });
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, []);

  const jellyfinIds = useMemo(() => {
    const ids = new Set<string>();
    for (const list of lists) for (const item of list.items) if (item.source === "jellyfin" && item.itemId) ids.add(item.itemId);
    return [...ids].sort();
  }, [lists]);
  const idsKey = jellyfinIds.join(",");

  useEffect(() => {
    if (!jellyfinIds.length) return;
    let alive = true;
    // Without a server (or another one linked) the stored cards stay as they are.
    api
      .getItemsByIds(jellyfinIds)
      .then((items) => {
        if (alive) setResolved(Object.fromEntries(items.map((movie) => [movie.id, movie])));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, version]);

  const run = useCallback(async (job: Promise<CustomList[]>) => {
    try {
      const next = await job;
      setLists(next);
      return next;
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, []);

  const value = useMemo<ListsContextValue>(
    () => ({
      lists,
      moviesOf: (list) =>
        list.items.map((item) => (item.itemId && resolved[item.itemId]) || snapshotMovie(item)),
      listsWith: (movie) => {
        const key = listKeyOf(movie);
        return key ? lists.filter((list) => list.items.some((item) => item.key === key)).map((list) => list.id) : [];
      },
      create: async (name) => {
        const before = new Set(lists.map((list) => list.id));
        const next = await run(api.customListCreate(name));
        return next?.find((list) => !before.has(list.id)) ?? null;
      },
      rename: async (id, name) => {
        await run(api.customListRename(id, name));
      },
      remove: async (id) => {
        await run(api.customListDelete(id));
      },
      setItem: async (id, movie, on) => {
        const item = listItemOf(movie);
        if (!item) return;
        if (!movie.external) setResolved((current) => ({ ...current, [movie.id]: movie }));
        await run(api.customListSetItem(id, item, on));
      },
      openPicker: setPicker,
    }),
    [lists, resolved, run],
  );

  return (
    <ListsContext.Provider value={value}>
      {children}
      {picker ? <ListPickerDialog movie={picker} onClose={() => setPicker(null)} /> : null}
    </ListsContext.Provider>
  );
}

export function useCustomLists(): ListsContextValue {
  const ctx = useContext(ListsContext);
  if (!ctx) throw new Error("useCustomLists requires CustomListsProvider");
  return ctx;
}
