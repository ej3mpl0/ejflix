/**
 * In-memory IPTV state: one entry per source with its catalog, loading flag and last
 * error (port of `IptvState` in `src-tauri/src/iptv.rs`). Refreshes run in the background
 * and announce themselves with `iptv://changed`.
 */
import type { Channel, ChannelGroup, ChannelPage, ChannelQuery, EpgNow, IptvSource, Programme } from "../../lib/types";
import { emit } from "../events";
import { shortError } from "../http";
import { LocalizedError } from "../errors";
import { nowMs } from "../util";
import { Catalog, attachEpg, buildChannels, deleteCache, readCache, writeCache } from "./catalog";
import * as epgdb from "./epgdb";
import { normalize, parseU32, type IptvChannel } from "./m3u";
import { catchupWindow } from "./catchup";
import { passwordOf, sourceOf, type StoredSource } from "./sources";
import { hidesAdult, isAdultChannel } from "../parental";

/** Cached playlists older than this are refreshed on launch (when the preference is on). */
export const STALE_AFTER_MS = 12 * 3600 * 1000;

type Entry = { catalog: Catalog | null; loading: boolean; error: string | null; errorKey: IptvSource["errorKey"] };

const entries = new Map<string, Entry>();

function entryOf(id: string): Entry {
  let entry = entries.get(id);
  if (!entry) {
    entry = { catalog: null, loading: false, error: null, errorKey: null };
    entries.set(id, entry);
  }
  return entry;
}

function catalogOf(id: string): Catalog | null {
  return entries.get(id)?.catalog ?? null;
}

/**
 * Puts every enabled source in memory (from its disk cache) and refreshes the ones
 * that are missing or stale in the background.
 */
export function ensure(sources: StoredSource[], autoRefresh: boolean, epg: boolean): void {
  const now = nowMs();
  for (const source of sources) {
    if (!source.enabled) continue;
    const entry = entryOf(source.id);
    if (entry.loading) continue;
    if (!entry.catalog) {
      const cached = readCache(source.id);
      if (cached) entry.catalog = cached;
    }
    const stale = entry.catalog ? now - entry.catalog.updatedMs > STALE_AFTER_MS : true;
    if (!entry.catalog || (stale && autoRefresh)) spawnRefresh(source, epg);
  }
}

/** Fire-and-forget refresh, deduplicated while one is already running. */
export function spawnRefresh(source: StoredSource, epg: boolean): void {
  const entry = entryOf(source.id);
  if (entry.loading) return;
  entry.loading = true;
  entry.error = null;
  entry.errorKey = null;
  emit("iptv://changed");
  // Removing the source (`forget`) or leaving the profile (`clear`) drops the entry:
  // from then on this refresh must not write its cache or guide back.
  const current = () => entries.get(source.id) === entry;
  void (async () => {
    try {
      const password = await passwordOf(source);
      const { catalog, headerEpg } = await buildChannels(source, password);
      if (!current()) return;
      // Channels are usable right away; the guide follows (loading stays true).
      entry.catalog = catalog;
      writeCache(source.id, catalog);
      emit("iptv://changed");
      if (epg) await attachEpg(catalog, source, password, headerEpg, current);
      if (!current()) return;
      catalog.updatedMs = nowMs();
      writeCache(source.id, catalog);
      entry.error = null;
      entry.errorKey = null;
    } catch (error) {
      entry.error = shortError(error);
      entry.errorKey = error instanceof LocalizedError ? { key: error.key, vars: error.vars } : null;
    } finally {
      entry.loading = false;
      emit("iptv://changed");
    }
  })();
}

/** Drops a source from memory, its cached catalog and its guide rows. */
export function forget(sourceId: string): void {
  entries.delete(sourceId);
  deleteCache(sourceId);
  epgdb.deleteProgrammes(sourceId);
}

export function clear(): void {
  entries.clear();
}

export function isLoading(): boolean {
  for (const entry of entries.values()) if (entry.loading) return true;
  return false;
}

export function views(sources: StoredSource[]): IptvSource[] {
  return sources.map((source) => {
    const entry = entries.get(source.id);
    const catalog = entry?.catalog ?? null;
    return {
      id: source.id,
      name: source.name,
      kind: source.kind,
      url: source.url,
      path: source.path,
      imported: source.imported,
      username: source.username,
      hasPassword: source.hasPassword,
      epgUrl: source.epgUrl,
      output: source.output,
      userAgent: source.userAgent,
      includeVod: source.includeVod,
      enabled: source.enabled,
      channelCount: catalog?.channels.length ?? 0,
      groupCount: catalog?.groups() ?? 0,
      epgChannels: catalog?.channelEpg.size ?? 0,
      updatedMs: catalog?.updatedMs ?? 0,
      loading: entry?.loading ?? false,
      error: entry?.error ?? null,
      errorKey: entry?.errorKey ?? null,
      epgError: catalog?.epgError ?? null,
      epgSource: catalog?.epgSource ?? null,
      account: catalog?.account ?? null,
    };
  });
}

export function groups(sources: StoredSource[], sourceId: string | null): ChannelGroup[] {
  const out: ChannelGroup[] = [];
  const index = new Map<string, number>();
  const hideAdult = hidesAdult();
  for (const source of sources) {
    if (!source.enabled || (sourceId !== null && sourceId !== source.id)) continue;
    const catalog = catalogOf(source.id);
    if (!catalog) continue;
    for (const channel of catalog.channels) {
      if (hideAdult && isAdultChannel(channel)) continue;
      const key = `${source.id}\u0000${channel.group}`;
      const i = index.get(key);
      if (i !== undefined) {
        out[i].count += 1;
        if (out[i].kind !== channel.kind) out[i].kind = "mixed";
      } else {
        index.set(key, out.length);
        out.push({ name: channel.group, sourceId: source.id, count: 1, kind: channel.kind });
      }
    }
  }
  return out;
}

function toView(channel: IptvChannel, catalog: Catalog, fav: Set<string>): Channel {
  return {
    id: channel.id,
    sourceId: channel.sourceId,
    name: channel.name,
    logo: channel.logo,
    group: channel.group,
    kind: channel.kind,
    number: channel.number,
    tvgId: channel.tvgId,
    favorite: fav.has(channel.id),
    epg: catalog.channelEpg.has(channel.id),
    ...(catchupWindow(channel) > 0 ? { catchupDays: catchupWindow(channel) } : {}),
  };
}

export function channels(
  sources: StoredSource[],
  query: ChannelQuery,
  favoriteIds: string[],
  recentIds: string[],
): ChannelPage {
  const fav = new Set(favoriteIds);
  const rawSearch = query.search ?? null;
  const needle = rawSearch !== null ? normalize(rawSearch) : "";
  const search = needle === "" ? null : needle;
  const number = rawSearch !== null ? parseU32(rawSearch.trim()) : null;
  const enabled = new Set(sources.filter((s) => s.enabled).map((s) => s.id));
  const wantedSource = query.sourceId ?? null;
  const hideAdult = hidesAdult();
  const matches = (channel: IptvChannel) =>
    !(hideAdult && isAdultChannel(channel)) &&
    (search === null || normalize(channel.name).includes(search) || (number !== null && channel.number === number));
  const items: Channel[] = [];
  if (query.favorites || query.recent) {
    const ids = query.favorites ? favoriteIds : recentIds;
    for (const id of ids) {
      const sourceId = sourceOf(id);
      if (sourceId === null || !enabled.has(sourceId) || (wantedSource !== null && wantedSource !== sourceId)) continue;
      const catalog = catalogOf(sourceId);
      const channel = catalog?.get(id);
      if (catalog && channel && matches(channel)) items.push(toView(channel, catalog, fav));
    }
  } else {
    for (const source of sources) {
      if (!source.enabled || (wantedSource !== null && wantedSource !== source.id)) continue;
      const catalog = catalogOf(source.id);
      if (!catalog) continue;
      for (const channel of catalog.channels) {
        if (query.group != null && channel.group !== query.group) continue;
        if (matches(channel)) items.push(toView(channel, catalog, fav));
      }
    }
  }
  const total = items.length;
  const limit = !query.limit || query.limit <= 0 ? 200 : Math.min(query.limit, 2000);
  const offset = query.offset && query.offset > 0 ? query.offset : 0;
  return { items: items.slice(offset, offset + limit), total };
}

export function find(channelId: string): { channel: IptvChannel; catalog: Catalog } | null {
  const sourceId = sourceOf(channelId);
  if (sourceId === null) return null;
  const catalog = catalogOf(sourceId);
  const channel = catalog?.get(channelId);
  return catalog && channel ? { channel, catalog } : null;
}

export function epgNow(ids: string[], now: number): Record<string, EpgNow> {
  const out: Record<string, EpgNow> = {};
  for (const id of ids.slice(0, 500)) {
    const sourceId = sourceOf(id);
    if (sourceId === null) continue;
    const xmltvId = catalogOf(sourceId)?.epgIdOf(id);
    if (xmltvId === undefined) continue;
    try {
      out[id] = epgdb.epgNow(sourceId, xmltvId, now);
    } catch (error) {
      console.warn("[iptv] epg lookup failed", error);
    }
  }
  return out;
}

export function epgChannel(id: string, now: number): Programme[] {
  const sourceId = sourceOf(id);
  if (sourceId === null) return [];
  const xmltvId = catalogOf(sourceId)?.epgIdOf(id);
  if (xmltvId === undefined) return [];
  try {
    return epgdb.epgChannel(sourceId, xmltvId, now);
  } catch (error) {
    console.warn("[iptv] epg lookup failed", error);
    return [];
  }
}

/** Channel view (favorite flag included) for the player. */
export function viewOf(channel: IptvChannel, catalog: Catalog, favoriteIds: string[]): Channel {
  return toView(channel, catalog, new Set(favoriteIds));
}
