import { api } from "./api";
import { sortedVideos, videoToMovie } from "./addons";
import type { AddonMetaFull, AddonVideo, Movie, PlayQueue } from "./types";

/** Shuffle remembers this many played episodes so it does not repeat them soon. */
const SEEN_MAX = 200;

/**
 * The item as it travels inside a queue: the queue rides along through the player
 * events, so the heavy parts the player fetches again anyway are left behind.
 */
function light(movie: Movie): Movie {
  return { ...movie, cast: [], chapters: [], trickplay: null, remoteTrailers: [], queue: null };
}

export function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Films of a list that "Play all" can chain (series and episodes have their own play). */
export function playableFilms(movies: Movie[]): Movie[] {
  return movies.filter((movie) => movie.kind === "Movie" && !movie.live);
}

/**
 * First item of "Play all" (in order) or "Shuffle" over a list of films, carrying the
 * rest as its queue. Null when there is nothing to play.
 */
export function startList(movies: Movie[], shuffle: boolean): Movie | null {
  const films = playableFilms(movies);
  const order = shuffle ? shuffled(films) : films;
  const [first, ...rest] = order;
  if (!first) return null;
  return { ...first, queue: { mode: "list", items: rest.map(light) } };
}

/** Aired, non-special episodes an online series can shuffle through. */
function shufflePool(meta: AddonMetaFull, skip: Set<string>): AddonVideo[] {
  const now = Date.now();
  return sortedVideos(meta.videos).filter((video) => {
    if ((video.season ?? 0) === 0 || skip.has(video.id)) return false;
    const aired = video.released ? Date.parse(video.released) : NaN;
    return !Number.isFinite(aired) || aired <= now;
  });
}

/** A random episode of an online series: unwatched ones first. */
async function randomOnline(meta: AddonMetaFull, seen: string[]): Promise<AddonVideo | null> {
  const watched = new Set(
    (await api.addonLibraryList().catch(() => [])).filter((entry) => entry.watched).map((entry) => entry.key),
  );
  const pool = shufflePool(meta, new Set(seen));
  const fresh = pool.filter((video) => !watched.has(video.id));
  const pick = (list: AddonVideo[]) => list[Math.floor(Math.random() * list.length)] ?? null;
  return pick(fresh.length ? fresh : pool);
}

/**
 * First episode of "Shuffle" on a series. Online series need their metadata (already
 * loaded by the details page); Jellyfin series ask the server for a random episode.
 */
export async function startShuffle(series: Movie, meta?: AddonMetaFull | null): Promise<Movie | null> {
  const ext = series.external;
  if (ext) {
    const full = meta ?? (await api.addonMeta("series", ext.metaId));
    const video = await randomOnline(full, []);
    if (!video) return null;
    const episode = videoToMovie(full, video);
    return { ...episode, queue: { mode: "shuffle", seriesId: null, metaId: ext.metaId, seen: [] } };
  }
  const episode = await api.getRandomEpisode(series.id);
  return episode ? { ...episode, queue: { mode: "shuffle", seriesId: series.id, metaId: null, seen: [] } } : null;
}

/** What plays after `movie` when it came from Play all / Shuffle (null: the queue ended). */
export async function queueNext(movie: Movie): Promise<Movie | null> {
  const queue: PlayQueue | null | undefined = movie.queue;
  if (!queue) return null;
  if (queue.mode === "list") {
    const [next, ...rest] = queue.items;
    return next ? { ...next, queue: { mode: "list", items: rest } } : null;
  }
  const current = movie.external?.videoId ?? movie.id;
  const seen = [...queue.seen.filter((id) => id !== current), current].slice(-SEEN_MAX);
  const carry: PlayQueue = { ...queue, seen };
  if (queue.metaId) {
    const meta = await api.addonMeta("series", queue.metaId);
    let video = await randomOnline(meta, seen);
    // Every episode played once: start over, just not with this one again.
    if (!video) video = await randomOnline(meta, [current]);
    if (!video) return null;
    const episode = videoToMovie(meta, video);
    const prefer = movie.external?.prefer ?? null;
    return { ...episode, external: { ...episode.external!, prefer }, queue: carry };
  }
  if (!queue.seriesId) return null;
  const episode =
    (await api.getRandomEpisode(queue.seriesId, seen)) ?? (await api.getRandomEpisode(queue.seriesId, [current]));
  return episode ? { ...episode, queue: carry } : null;
}
