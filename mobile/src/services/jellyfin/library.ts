/**
 * Library queries (ported from `JellyfinClient` in `jellyfin.rs`): same endpoints,
 * query parameters, limits and ordering as the desktop app.
 */
import type { BrowseArgs, GenreRow, HomeData, Library, Movie } from "../../lib/types";
import { launchSeed, mapLimit, urlencodingLite, validItemId } from "../util";
import { jellyfin, type JellyfinSession } from "./client";
import { DETAIL_FIELDS, ITEM_FIELDS, mapItem } from "./items";
import { parseIntroSkipper, parseJellyfinSegments, type RawJellyfinSegment } from "../segments.pure";
import { BLOCKED, currentRule } from "../parental";
import { allowsRating } from "../parental.pure";
import { onSessionChange } from "../session";

function requireSession(): JellyfinSession {
  const session = jellyfin.session;
  if (!session) throw new Error("Sin servidor");
  return session;
}

function invalidItem(): Error {
  return new Error("Ítem no válido");
}

type Json = Record<string, unknown>;

function itemsOf(value: unknown): unknown[] {
  const items = value != null && typeof value === "object" ? (value as Json).Items : null;
  return Array.isArray(items) ? items : [];
}

/** Series id -> its official rating: episodes and seasons rarely carry their own. */
const seriesRatings = new Map<string, string | null>();
onSessionChange(() => seriesRatings.clear());

/**
 * Drops what the open profile's parental restriction does not allow (`parental.rs`).
 * An episode or season without a rating is judged by its series' rating.
 */
async function restrict(items: Movie[]): Promise<Movie[]> {
  const rule = currentRule();
  if (!rule) return items;
  const session = requireSession();
  const missing = [
    ...new Set(
      items
        .filter((m) => !m.officialRating && m.seriesId && validItemId(m.seriesId) && !seriesRatings.has(m.seriesId))
        .map((m) => m.seriesId as string),
    ),
  ];
  for (let i = 0; i < missing.length; i += 40) {
    const chunk = missing.slice(i, i + 40);
    try {
      const response = await jellyfin.getResponse(
        `/Users/${session.userId}/Items?Ids=${chunk.join(",")}&Fields=OfficialRating&EnableImages=false&EnableUserData=false`,
      );
      if (!response.ok) continue;
      const value: unknown = await response.json();
      for (const id of chunk) seriesRatings.set(id, null);
      for (const raw of itemsOf(value)) {
        const item = raw != null && typeof raw === "object" ? (raw as Json) : null;
        if (typeof item?.Id !== "string") continue;
        const rating = typeof item.OfficialRating === "string" && item.OfficialRating.trim() ? item.OfficialRating : null;
        seriesRatings.set(item.Id, rating);
      }
    } catch {
      /* judged without the series rating */
    }
  }
  return items.filter((m) =>
    allowsRating(rule, m.officialRating ?? (m.seriesId ? (seriesRatings.get(m.seriesId) ?? null) : null)),
  );
}

async function itemsQuery(path: string): Promise<Movie[]> {
  requireSession();
  const response = await jellyfin.getResponse(path);
  if (!response.ok) throw new Error(`Jellyfin ${path}: ${response.status}`);
  const value: unknown = await response.json();
  return restrict(itemsOf(value).map(mapItem));
}

/** Library browse with genre / year filters (Discover tab). */
export async function browseItems(args: BrowseArgs): Promise<Movie[]> {
  const session = requireSession();
  const itemType = args.type === "series" ? "Series" : "Movie";
  let sortBy: string;
  let order: string;
  switch (args.sort ?? "popular") {
    case "newest":
      [sortBy, order] = ["DateCreated,SortName", "Descending"];
      break;
    case "year":
      [sortBy, order] = ["ProductionYear,SortName", "Descending"];
      break;
    case "name":
      [sortBy, order] = ["SortName", "Ascending"];
      break;
    default:
      [sortBy, order] = ["CommunityRating,SortName", "Descending"];
  }
  const start = Math.max(0, Math.trunc(args.start ?? 0));
  const limit = Math.min(60, Math.max(1, Math.trunc(args.limit ?? 40)));
  let path = `/Users/${session.userId}/Items?IncludeItemTypes=${itemType}&Recursive=true&SortBy=${sortBy}&SortOrder=${order}&StartIndex=${start}&Limit=${limit}&Fields=${ITEM_FIELDS}&EnableImageTypes=Primary,Backdrop,Logo`;
  const genre = args.genre?.trim();
  if (genre) path += `&Genres=${urlencodingLite(genre)}`;
  const year = args.year;
  if (typeof year === "number" && Number.isInteger(year) && year >= 1880 && year <= 2100) path += `&Years=${year}`;
  if (!currentRule()) return itemsQuery(path);
  // A restricted profile can filter a whole page away; Discover would take the empty
  // page for the end of the library, so look a few pages further first.
  for (let attempt = 0, from = start; attempt < 4; attempt++, from += limit) {
    const list = await itemsQuery(path.replace(`&StartIndex=${start}&`, `&StartIndex=${from}&`));
    if (list.length) return list;
  }
  return [];
}

/** Genre names of the whole library (movies and series). */
export async function getGenres(): Promise<string[]> {
  const session = requireSession();
  const response = await jellyfin.getResponse(
    `/Genres?IncludeItemTypes=Movie,Series&UserId=${session.userId}&Recursive=true&SortBy=SortName`,
  );
  if (!response.ok) return [];
  const value: unknown = await response.json();
  const out: string[] = [];
  for (const raw of itemsOf(value)) {
    const name = raw != null && typeof raw === "object" ? (raw as Json).Name : null;
    if (typeof name === "string") out.push(name);
  }
  return out;
}

/** Libraries (user views) ejFlix can browse: movies, TV shows, mixed or plain folders. */
export async function getLibraries(): Promise<Library[]> {
  const session = requireSession();
  const response = await jellyfin.getResponse(`/Users/${session.userId}/Views`);
  if (!response.ok) throw new Error(`Jellyfin Views: ${response.status}`);
  const value: unknown = await response.json();
  const out: Library[] = [];
  for (const raw of itemsOf(value)) {
    const view = raw != null && typeof raw === "object" ? (raw as Json) : null;
    if (!view) continue;
    const id = view.Id;
    const name = view.Name;
    if (typeof id !== "string" || !validItemId(id) || typeof name !== "string") continue;
    const collectionType = typeof view.CollectionType === "string" ? view.CollectionType : null;
    if (collectionType === null || collectionType === "movies" || collectionType === "tvshows" || collectionType === "mixed") {
      out.push({ id, name, collectionType });
    }
  }
  return out;
}

async function latestItems(session: JellyfinSession, itemType: string, parent: string): Promise<Movie[]> {
  const sort = itemType === "Series" ? "DateLastContentAdded,DateCreated,SortName" : "DateCreated,SortName";
  return itemsQuery(
    `/Users/${session.userId}/Items?IncludeItemTypes=${itemType}&Recursive=true&SortBy=${sort}&SortOrder=Descending&Limit=18&Fields=${ITEM_FIELDS}&EnableImageTypes=Primary,Backdrop,Logo${parent}`,
  );
}

async function genreRows(session: JellyfinSession, itemType: string, parent: string): Promise<GenreRow[]> {
  const response = await jellyfin.getResponse(
    `/Genres?IncludeItemTypes=${itemType}&UserId=${session.userId}&Recursive=true&SortBy=SortName${parent}`,
  );
  if (!response.ok) return [];
  const value: unknown = await response.json();
  const genres: { id: string; name: string }[] = [];
  for (const raw of itemsOf(value)) {
    const g = raw != null && typeof raw === "object" ? (raw as Json) : null;
    if (!g || typeof g.Id !== "string" || typeof g.Name !== "string") continue;
    genres.push({ id: g.Id, name: g.Name });
    if (genres.length >= 6) break;
  }
  const rows = await mapLimit(genres, 3, async ({ id, name }): Promise<GenreRow | null> => {
    let items: Movie[] = [];
    try {
      items = await itemsQuery(
        `/Users/${session.userId}/Items?GenreIds=${id}&IncludeItemTypes=${itemType}&Recursive=true&Limit=18&SortBy=CommunityRating,SortName&SortOrder=Descending&Fields=${ITEM_FIELDS}${parent}`,
      );
    } catch {
      items = [];
    }
    return items.length ? { id, name, items } : null;
  });
  return rows.filter((row): row is GenreRow => row != null);
}

/**
 * Home feed. Without a library it covers every movie the user can see; with one it is
 * scoped to that library (`ParentId`), showing series instead of movies for TV.
 */
export async function getHome(library: Library | null): Promise<HomeData> {
  if (library && !validItemId(library.id)) throw new Error("Biblioteca no válida");
  const session = requireSession();
  const tv = library?.collectionType === "tvshows";
  const parent = library ? `&ParentId=${library.id}` : "";
  const mainType = tv ? "Series" : "Movie";
  const resumeType = tv ? "Episode" : "Movie";
  const fields = ITEM_FIELDS;
  const resumePath = `/Users/${session.userId}/Items/Resume?IncludeItemTypes=${resumeType}&Limit=16&Fields=${fields}${parent}`;
  const allPath = `/Users/${session.userId}/Items?IncludeItemTypes=${mainType}&Recursive=true&SortBy=SortName&SortOrder=Ascending&Limit=80&Fields=${fields}&EnableImageTypes=Primary,Backdrop,Logo${parent}`;
  const nextUpPath = `/Shows/NextUp?UserId=${session.userId}&Limit=18&Fields=${fields}&EnableImageTypes=Primary,Backdrop,Logo,Thumb${parent}`;

  const [resume, nextUp, latest, all, genres] = await Promise.all([
    itemsQuery(resumePath),
    tv ? itemsQuery(nextUpPath) : Promise.resolve<Movie[]>([]),
    latestItems(session, mainType, parent),
    itemsQuery(allPath),
    genreRows(session, mainType, parent),
  ]);

  // Hero carousel: the newest items with a backdrop, rotated per app launch so the first
  // slide is not always the same title (stable within the process).
  let candidates = latest.filter((m) => m.backdropUrl != null).slice(0, 8);
  if (candidates.length === 0) candidates = all.filter((m) => m.backdropUrl != null).slice(0, 8);
  if (candidates.length === 0) {
    const first = latest[0] ?? all[0];
    if (first) candidates = [first];
  }
  if (candidates.length > 0) {
    const offset = launchSeed() % candidates.length;
    candidates = [...candidates.slice(offset), ...candidates.slice(0, offset)];
  }

  return { featured: candidates, resume, nextUp, latest, genres, all };
}

export async function getItem(id: string): Promise<Movie> {
  if (!validItemId(id)) throw invalidItem();
  const session = requireSession();
  const response = await jellyfin.getResponse(`/Users/${session.userId}/Items/${id}?Fields=${DETAIL_FIELDS}`);
  if (!response.ok) throw new Error("No se encontró la película");
  const [allowed] = await restrict([mapItem(await response.json())]);
  if (!allowed) throw new Error(BLOCKED);
  return allowed;
}

export async function getSeasons(seriesId: string): Promise<Movie[]> {
  if (!validItemId(seriesId)) throw invalidItem();
  const session = requireSession();
  return itemsQuery(`/Shows/${seriesId}/Seasons?UserId=${session.userId}&Fields=${ITEM_FIELDS}`);
}

export async function getEpisodes(seriesId: string, seasonId: string): Promise<Movie[]> {
  if (!validItemId(seriesId) || !validItemId(seasonId)) throw invalidItem();
  const session = requireSession();
  return itemsQuery(`/Shows/${seriesId}/Episodes?SeasonId=${seasonId}&UserId=${session.userId}&Fields=${ITEM_FIELDS}`);
}

/** Episode that follows `episodeId` in series order (crosses seasons), if any. */
export async function getNextEpisode(seriesId: string, episodeId: string): Promise<Movie | null> {
  if (!validItemId(seriesId) || !validItemId(episodeId)) throw invalidItem();
  const session = requireSession();
  const items = await itemsQuery(
    `/Shows/${seriesId}/Episodes?UserId=${session.userId}&StartItemId=${episodeId}&Limit=2&Fields=${ITEM_FIELDS}`,
  );
  return items.find((m) => m.id !== episodeId) ?? null;
}

/** Episode to play when pressing Play on a series: "next up", else the first episode. */
export async function getSeriesNextUp(seriesId: string): Promise<Movie | null> {
  if (!validItemId(seriesId)) throw invalidItem();
  const session = requireSession();
  let nextUp: Movie[] = [];
  try {
    nextUp = await itemsQuery(`/Shows/NextUp?UserId=${session.userId}&SeriesId=${seriesId}&Limit=1&Fields=${ITEM_FIELDS}`);
  } catch {
    nextUp = [];
  }
  if (nextUp[0]) return nextUp[0];
  const first = await itemsQuery(`/Shows/${seriesId}/Episodes?UserId=${session.userId}&Limit=1&Fields=${ITEM_FIELDS}`);
  return first[0] ?? null;
}

export async function searchItems(query: string): Promise<Movie[]> {
  const session = requireSession();
  const trimmed = query.trim();
  if (trimmed.length > 200) throw new Error("Búsqueda demasiado larga");
  const q = urlencodingLite(trimmed);
  if (!q) return [];
  return itemsQuery(
    `/Users/${session.userId}/Items?SearchTerm=${q}&IncludeItemTypes=Movie,Series&Recursive=true&Limit=48&Fields=${ITEM_FIELDS}`,
  );
}

/** Films and series of the library a person (cast or crew) takes part in, newest first. */
export async function personItems(personId: string): Promise<Movie[]> {
  if (!validItemId(personId)) throw new Error("Persona no válida");
  const session = requireSession();
  return itemsQuery(
    `/Users/${session.userId}/Items?PersonIds=${personId}&IncludeItemTypes=Movie,Series&Recursive=true&SortBy=ProductionYear,SortName&SortOrder=Descending&Limit=100&Fields=${ITEM_FIELDS}`,
  );
}

/** Items Jellyfin considers similar ("More like this"). */
export async function getSimilar(id: string): Promise<Movie[]> {
  if (!validItemId(id)) throw invalidItem();
  const session = requireSession();
  return itemsQuery(`/Items/${id}/Similar?UserId=${session.userId}&Limit=12&Fields=${ITEM_FIELDS}`);
}

/** Everything the user marked as favorite ("My list"), newest first. */
export async function getFavorites(): Promise<Movie[]> {
  const session = requireSession();
  return itemsQuery(
    `/Users/${session.userId}/Items?Filters=IsFavorite&Recursive=true&IncludeItemTypes=Movie,Series,Episode&SortBy=DateCreated,SortName&SortOrder=Descending&Limit=100&Fields=${ITEM_FIELDS}&EnableImageTypes=Primary,Backdrop,Logo,Thumb`,
  );
}

/** POST/DELETE a per-user flag: the 10.9+ route first, the legacy one on 404. */
async function userFlag(modern: string, legacy: string, itemId: string, on: boolean, field: string): Promise<boolean> {
  if (!validItemId(itemId)) throw invalidItem();
  const session = requireSession();
  const method = on ? "POST" : "DELETE";
  let response = await jellyfin.sendEmpty(method, `/${modern}/${itemId}?userId=${session.userId}`);
  if (response.status === 404) {
    response = await jellyfin.sendEmpty(method, `/Users/${session.userId}/${legacy}/${itemId}`);
  }
  if (!response.ok) throw new Error(`Jellyfin ${modern}: ${response.status}`);
  let value: unknown = null;
  try {
    value = await response.json();
  } catch {
    value = null;
  }
  const flag = value != null && typeof value === "object" ? (value as Json)[field] : undefined;
  return typeof flag === "boolean" ? flag : on;
}

export function setFavorite(itemId: string, favorite: boolean): Promise<boolean> {
  return userFlag("UserFavoriteItems", "FavoriteItems", itemId, favorite, "IsFavorite");
}

/** Marks an item (or every child of a season/series) as played or unplayed. */
export function setPlayed(itemId: string, played: boolean): Promise<boolean> {
  return userFlag("UserPlayedItems", "PlayedItems", itemId, played, "Played");
}

// ---- helpers for segments.ts ----

/**
 * Native media segments (Jellyfin 10.10+) as `[type, start, end]` tuples; `null` when the
 * server has no MediaSegments API (404 on older versions). Throws on other failures.
 */
export async function mediaSegmentsRaw(itemId: string): Promise<RawJellyfinSegment[] | null> {
  if (!validItemId(itemId)) throw invalidItem();
  requireSession();
  const response = await jellyfin.getResponse(`/MediaSegments/${itemId}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Jellyfin MediaSegments: ${response.status}`);
  return parseJellyfinSegments(await response.json());
}

/** Intro Skipper plugin API on servers without native segments; `null` on any failure. */
export async function introSkipperRange(itemId: string, credits: boolean): Promise<[number, number] | null> {
  if (!validItemId(itemId) || !jellyfin.session) return null;
  try {
    const response = await jellyfin.getResponse(`/Episode/${itemId}/IntroTimestamps/v1${credits ? "?mode=Credits" : ""}`);
    if (!response.ok) return null;
    return parseIntroSkipper(await response.json());
  } catch {
    return null;
  }
}

/** Series-level IMDb id (IntroDB is keyed by the show); `null` when unknown. */
export async function seriesImdbId(seriesId: string): Promise<string | null> {
  try {
    const series = await getItem(seriesId);
    const imdb = series.providerIds.Imdb;
    return imdb && imdb.startsWith("tt") ? imdb : null;
  } catch {
    return null;
  }
}
