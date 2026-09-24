import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { videoToMovie } from "./addons";
import type { Movie } from "./types";
import { useUserData } from "./userdata-context";
import { useCustomLists } from "./lists-context";

/** How far back "recently aired" reaches, and how far ahead the calendar looks. */
export const DAYS_BACK = 14;
const DAYS_AHEAD = 60;
const DAY_MS = 86_400_000;
/** A new episode is one aired since the calendar was last opened, but never older than this. */
const NEW_MAX_DAYS = 7;
/** Online series looked up per load (one metadata request each). */
const MAX_ONLINE_SERIES = 30;
const CONCURRENCY = 5;
const TTL_MS = 10 * 60_000;

export type CalendarEntry = {
  episode: Movie;
  /** Air date, ms. */
  airs: number;
};

type Followed = { hasServer: boolean; jellyfin: string[]; online: string[] };

let cache: { key: string; at: number; job: Promise<CalendarEntry[]> } | null = null;
let seenCache: Promise<number> | null = null;
let cacheUser: string | null = null;
/** Hooks to tell when the calendar was just seen (the header badge clears at once). */
const seenListeners = new Set<(ms: number) => void>();

function airTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
}

function inWindow(at: number, now: number): boolean {
  return at >= now - DAYS_BACK * DAY_MS && at <= now + DAYS_AHEAD * DAY_MS;
}

async function mapLimited<T, R>(items: T[], limit: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const item = items[index++];
      out.push(await job(item));
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function fetchCalendar(followed: Followed): Promise<CalendarEntry[]> {
  const now = Date.now();
  const entries: CalendarEntry[] = [];
  const seen = new Set<string>();
  const push = (episode: Movie, airs: number) => {
    // The same show from the server and an addon: keep the server's copy (it plays locally).
    const key = `${(episode.seriesName ?? "").toLowerCase()}|${episode.seasonNumber}|${episode.episodeNumber}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ episode, airs });
  };

  if (followed.hasServer) {
    const data = await api.getCalendar(DAYS_BACK).catch(() => null);
    if (data) {
      const series = new Set([...data.followed, ...followed.jellyfin]);
      for (const episode of data.episodes) {
        const airs = airTime(episode.premiereDate);
        if (airs != null && episode.seriesId && series.has(episode.seriesId) && inWindow(airs, now)) push(episode, airs);
      }
    }
  }

  const metas = await mapLimited(followed.online.slice(0, MAX_ONLINE_SERIES), CONCURRENCY, (id) =>
    api.addonMeta("series", id).catch(() => null),
  );
  for (const meta of metas) {
    if (!meta) continue;
    for (const video of meta.videos) {
      const airs = airTime(video.released);
      if (airs == null || (video.season ?? 0) === 0 || !inWindow(airs, now)) continue;
      push(videoToMovie(meta, video), airs);
    }
  }
  return entries.sort((a, b) => a.airs - b.airs);
}

/** Forget the cached calendar (a list changed, the user asked to refresh). */
export function invalidateCalendar() {
  cache = null;
}

/** When the user last opened the calendar (ms). */
function loadSeen(): Promise<number> {
  seenCache ??= api.calendarSeenGet().catch(() => 0);
  return seenCache;
}

/** Remember that the calendar was seen now; new-episode badges count from here. */
export function markCalendarSeen(ms = Date.now()) {
  seenCache = Promise.resolve(ms);
  void api.calendarSeenSet(ms).catch(() => undefined);
  for (const listener of seenListeners) listener(ms);
}

/**
 * Episodes around today of the series the user follows: in My list or a custom list,
 * with progress, or (Jellyfin) watched lately / in "Next up". Cached for the session
 * for a few minutes, shared by Home, the header and the calendar view.
 */
export function useCalendar(hasServer: boolean, userId: string) {
  const { onlineList, flags } = useUserData();
  const { lists } = useCustomLists();
  const [progressSeries, setProgressSeries] = useState<string[] | null>(null);
  const [entries, setEntries] = useState<CalendarEntry[] | null>(null);
  const [seen, setSeen] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    // Another profile: nothing cached belongs to it.
    if (cacheUser !== userId) {
      cacheUser = userId;
      cache = null;
      seenCache = null;
    }
    api
      .addonProgressList()
      .then((list) => {
        if (alive) setProgressSeries(list.filter((entry) => entry.type === "series").map((entry) => entry.metaId));
      })
      .catch(() => {
        if (alive) setProgressSeries([]);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  const followed = useMemo<Followed>(() => {
    const online = new Set<string>();
    const jellyfin = new Set<string>();
    for (const movie of onlineList) if (movie.external?.type === "series") online.add(movie.external.metaId);
    for (const id of progressSeries ?? []) online.add(id);
    for (const list of lists) {
      for (const item of list.items) {
        if (item.source === "online" && item.type === "series" && item.metaId) online.add(item.metaId);
        if (item.source === "jellyfin" && item.type === "Series" && item.itemId) jellyfin.add(item.itemId);
      }
    }
    return { hasServer, jellyfin: [...jellyfin].sort(), online: [...online].sort() };
  }, [onlineList, progressSeries, lists, hasServer]);
  const key = `${userId}|${followed.hasServer}|${followed.jellyfin.join(",")}|${followed.online.join(",")}`;

  useEffect(() => {
    // Wait for the online progress, or the first load would miss those series.
    if (progressSeries == null) return;
    let alive = true;
    if (!cache || cache.key !== key || Date.now() - cache.at > TTL_MS) {
      cache = { key, at: Date.now(), job: fetchCalendar(followed) };
    }
    const job = cache.job;
    job
      .then((list) => {
        if (alive) setEntries(list);
      })
      .catch(() => {
        if (alive) setEntries([]);
      });
    void loadSeen().then((ms) => {
      if (alive) setSeen(ms);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, progressSeries == null]);

  useEffect(() => {
    seenListeners.add(setSeen);
    return () => {
      seenListeners.delete(setSeen);
    };
  }, []);

  const reload = useCallback(() => {
    cache = null;
    setTick((n) => n + 1);
  }, []);

  /** Aired since the last visit to the calendar (at most a week back) and not watched. */
  const isNew = useCallback(
    (entry: CalendarEntry, since = seen) => {
      if (since == null) return false;
      const now = Date.now();
      const from = Math.max(since, now - NEW_MAX_DAYS * DAY_MS);
      return entry.airs > from && entry.airs <= now && !flags(entry.episode).played;
    },
    [seen, flags],
  );

  const fresh = useMemo(
    () => (entries ?? []).filter((entry) => isNew(entry)).sort((a, b) => b.airs - a.airs),
    [entries, isNew],
  );

  return { entries, loading: entries == null, seen, isNew, fresh, reload };
}
