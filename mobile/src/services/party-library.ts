/**
 * The host's title in this phone's Jellyfin library (port of `party_find_library_item`):
 * one light request for every movie or series with its provider ids, then the episode
 * by season and number.
 */
import type { Movie } from "../lib/types";
import { jellyfin } from "./jellyfin/client";
import { getItem } from "./jellyfin/library";
import { matchesIds, type PartyTitle } from "./party.pure";
import { validItemId } from "./util";

type Json = Record<string, unknown>;

function itemsOf(value: unknown): Json[] {
  const items = value != null && typeof value === "object" ? (value as Json).Items : null;
  return Array.isArray(items) ? (items.filter((i) => i != null && typeof i === "object") as Json[]) : [];
}

function providerIdsOf(item: Json): Record<string, string> {
  const raw = item.ProviderIds;
  const out: Record<string, string> = {};
  if (raw != null && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Json)) if (typeof v === "string") out[k] = v;
  }
  return out;
}

export async function findLibraryItem(title: PartyTitle): Promise<Movie | null> {
  const session = jellyfin.session;
  if (!session || title.kind === "unsupported" || !Object.keys(title.ids).length) return null;
  const type = title.kind === "series" ? "Series" : "Movie";
  const response = await jellyfin.getResponse(
    `/Users/${session.userId}/Items?IncludeItemTypes=${type}&Recursive=true&Fields=ProviderIds&EnableImages=false&EnableUserData=false`,
  );
  if (!response.ok) return null;
  const found = itemsOf(await response.json()).find((item) => matchesIds(providerIdsOf(item), title.ids));
  const id = typeof found?.Id === "string" ? found.Id : null;
  if (!id || !validItemId(id)) return null;
  if (title.kind === "movie") return getItem(id);
  if (title.season == null || title.episode == null) return null;
  const episodes = await jellyfin.getResponse(`/Shows/${id}/Episodes?UserId=${session.userId}&EnableImages=false`);
  if (!episodes.ok) return null;
  const episode = itemsOf(await episodes.json()).find(
    (item) => item.ParentIndexNumber === title.season && item.IndexNumber === title.episode,
  );
  return typeof episode?.Id === "string" && validItemId(episode.Id) ? getItem(episode.Id) : null;
}
