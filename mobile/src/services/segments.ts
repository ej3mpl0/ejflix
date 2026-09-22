/**
 * Intro / recap / credits ranges for the "skip" prompt (ported from `segments.rs`).
 * Sources, merged per kind with the first one winning: Jellyfin media segments (with the
 * Intro Skipper endpoint as fallback), then IntroDB.app keyed by the show's IMDb id.
 * Everything is best effort: failures yield an empty list, results are cached per item
 * and IntroDB gets a global backoff when it is slow or down.
 */
import type { MediaSegment, Movie } from "../lib/types";
import { fetchWithTimeout } from "./http";
import { nowMs, validItemId } from "./util";
import { getItem, introSkipperRange, mediaSegmentsRaw, seriesImdbId } from "./jellyfin/library";
import { registerSessionCleanup } from "./session";
import {
  INTRODB_BACKOFF_MS,
  INTRODB_TIMEOUT_MS,
  INTRODB_URL,
  MAX_CACHED_ITEMS,
  fromJellyfinSegments,
  mergeSegments,
  parseIntroDb,
  sanitizeSegments,
  validImdbId,
} from "./segments.pure";

const items = new Map<string, MediaSegment[]>();
const seriesImdb = new Map<string, string | null>();
let introDbDownUntil = 0;

export function clearSegmentsCache(): void {
  items.clear();
  seriesImdb.clear();
}

registerSessionCleanup(clearSegmentsCache);

function remember(key: string, list: MediaSegment[]): MediaSegment[] {
  if (items.size >= MAX_CACHED_ITEMS) items.clear();
  items.set(key, list);
  return list;
}

function introDbDown(): boolean {
  return introDbDownUntil > nowMs();
}

function markIntroDbDown(): void {
  introDbDownUntil = nowMs() + INTRODB_BACKOFF_MS;
}

async function introDb(imdb: string, season: number, episode: number): Promise<MediaSegment[]> {
  if (introDbDown()) return [];
  const url = `${INTRODB_URL}?imdb_id=${encodeURIComponent(imdb)}&season=${season}&episode=${episode}`;
  let response: Response;
  try {
    response = await fetchWithTimeout(url, { timeoutMs: INTRODB_TIMEOUT_MS, headers: { Accept: "application/json" } });
  } catch {
    markIntroDbDown();
    return [];
  }
  if (response.status === 429 || response.status >= 500) {
    markIntroDbDown();
    return [];
  }
  if (!response.ok) return [];
  try {
    return parseIntroDb(await response.json());
  } catch {
    return [];
  }
}

async function fromJellyfin(itemId: string): Promise<MediaSegment[]> {
  let raw: Awaited<ReturnType<typeof mediaSegmentsRaw>>;
  try {
    raw = await mediaSegmentsRaw(itemId);
  } catch {
    return [];
  }
  if (raw != null) return fromJellyfinSegments(raw);
  // No MediaSegments API (server < 10.10): try the Intro Skipper plugin directly.
  const [intro, credits] = await Promise.all([introSkipperRange(itemId, false), introSkipperRange(itemId, true)]);
  const out: MediaSegment[] = [];
  if (intro) out.push({ kind: "intro", startSeconds: intro[0], endSeconds: intro[1], source: "jellyfin" });
  if (credits) out.push({ kind: "outro", startSeconds: credits[0], endSeconds: credits[1], source: "jellyfin" });
  return out;
}

async function fromIntroDb(movie: Movie): Promise<MediaSegment[]> {
  if (movie.kind !== "Episode") return [];
  const { seriesId, seasonNumber: season, episodeNumber: episode } = movie;
  if (!seriesId || season == null || episode == null) return [];
  if (season < 0 || episode <= 0) return [];
  if (introDbDown()) return [];
  let imdb: string | null;
  if (seriesImdb.has(seriesId)) {
    imdb = seriesImdb.get(seriesId) ?? null;
  } else {
    imdb = await seriesImdbId(seriesId);
    seriesImdb.set(seriesId, imdb);
  }
  if (!imdb) return [];
  return introDb(imdb, season, episode);
}

/** Intro / recap / credits ranges for an item. Never throws (empty when unknown). */
export async function getMediaSegments(itemId: string): Promise<MediaSegment[]> {
  if (!validItemId(itemId)) return [];
  const cached = items.get(itemId);
  if (cached) return cached;
  let movie: Movie;
  try {
    movie = await getItem(itemId);
  } catch {
    return [];
  }
  const [native, community] = await Promise.all([fromJellyfin(itemId), fromIntroDb(movie)]);
  const duration = movie.runtimeTicks != null ? movie.runtimeTicks / 10_000_000 : null;
  return remember(itemId, sanitizeSegments(mergeSegments(native, community), duration));
}

/** Segments for an episode known only by IMDb id (online titles): IntroDB alone. */
export async function getMediaSegmentsExternal(imdb: string, season: number, episode: number): Promise<MediaSegment[]> {
  if (!validImdbId(imdb) || !Number.isInteger(season) || !Number.isInteger(episode)) return [];
  const key = `${imdb}:${season}:${episode}`;
  const cached = items.get(key);
  if (cached) return cached;
  return remember(key, sanitizeSegments(await introDb(imdb, season, episode), null));
}
