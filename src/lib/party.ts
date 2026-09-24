import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "./api";
import { externalRefForJellyfin, metaFullToMovie, videoToMovie } from "./addons";
import type { MessageKey } from "./i18n";
import type { ExternalRef, Movie } from "./types";

/**
 * Watch party. Rust keeps the socket (Supabase Realtime) and the member list; this module
 * holds what the windows share: the commands, the title descriptor the host sends and the
 * guests resolve, and the pure sync arithmetic (clock offset, drift correction).
 */

export type PartyMember = { id: string; name: string; avatar: string | null; host: boolean };

export type PartyStatus = {
  active: boolean;
  phase: "idle" | "connecting" | "live" | "reconnecting" | "ended";
  code: string;
  host: boolean;
  selfId: string;
  members: PartyMember[];
  title: PartyTitle | null;
  private: boolean;
  hostAway: boolean;
  /** Host setting: everyone may pause, play and seek. */
  open: boolean;
  /** `party:*` code of why it ended or could not start. */
  error: string | null;
};

export type PartyMessage = { event: string; from: string; fromHost: boolean; data: unknown };

/** What the host is playing, in terms another library or another set of addons can find. */
export type PartyTitle = {
  /** Identity of the title: a new key means the host moved on (next episode...). */
  key: string;
  kind: "movie" | "series" | "unsupported";
  name: string;
  seriesName: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
  ids: { imdb?: string; tmdb?: string; tvdb?: string };
  /** Stremio identity, when there is one (online titles, or a Jellyfin item with an IMDb id). */
  addon: {
    type: "movie" | "series";
    metaId: string;
    videoId: string;
    prefer: ExternalRef["prefer"];
  } | null;
};

/** Host heartbeat: where its player is, by its own clock. */
export type PartySync = {
  key: string;
  pos: number;
  paused: boolean;
  rate: number;
  /** Host clock (ms) when `pos` was true. */
  at: number;
  /** Guests may pause, play and seek too. */
  open: boolean;
};

/** A guest asking the host to act (only honoured while the host lets everyone control). */
export type PartyControl = { action: "play" | "pause" | "seek"; pos?: number };

export const PARTY_REACTIONS = ["😂", "😮", "😍", "👏", "😢", "🔥"] as const;
export const CHAT_MAX = 200;
export const HEARTBEAT_MS = 5000;

export const partyApi = {
  status: () => invoke<PartyStatus>("party_status"),
  start: (name: string, avatar: string | null) => invoke<PartyStatus>("party_start", { name, avatar }),
  join: (code: string, name: string, avatar: string | null) => invoke<PartyStatus>("party_join", { code, name, avatar }),
  leave: () => invoke<void>("party_leave"),
  send: (event: string, data: unknown) => invoke<void>("party_send", { event, data }),
  setTitle: (title: PartyTitle) => invoke<void>("party_set_title", { title }),
  setOpen: (open: boolean) => invoke<void>("party_set_open", { open }),
  setPause: (paused: boolean) => invoke<void>("party_player_pause", { paused }),
  findLibraryItem: (kind: string, ids: PartyTitle["ids"], season: number | null, episode: number | null) =>
    invoke<Movie | null>("party_find_library_item", { kind, ids, season, episode }),
  onStatus: (handler: (status: PartyStatus) => void): Promise<UnlistenFn> =>
    listen<PartyStatus>("party://status", (e) => handler(e.payload)),
  onMessage: (handler: (message: PartyMessage) => void): Promise<UnlistenFn> =>
    listen<PartyMessage>("party://message", (e) => handler(e.payload)),
};

/** Name and avatar the others see: the profile's (only preset avatars travel). */
async function identity(): Promise<{ name: string; avatar: string | null }> {
  const session = await api.sessionCurrent().catch(() => null);
  const avatar = session?.avatarUrl?.startsWith("preset:") ? session.avatarUrl : null;
  return { name: session?.userName ?? "ejFlix", avatar };
}

export async function startParty(): Promise<PartyStatus> {
  const me = await identity();
  return partyApi.start(me.name, me.avatar);
}

export async function joinParty(code: string): Promise<PartyStatus> {
  const me = await identity();
  return partyApi.join(code, me.name, me.avatar);
}

/** Message key for a `party:*` error (Rust sends codes, not sentences). */
export function partyErrorKey(error: string | null | undefined): MessageKey {
  switch (error) {
    case "party:bad_code":
      return "partyErrBadCode";
    case "party:not_found":
      return "partyErrNotFound";
    case "party:host_ended":
      return "partyErrHostEnded";
    case "party:host_left":
      return "partyErrHostLeft";
    case "party:needs_account":
      return "partyErrNeedsAccount";
    case "party:denied":
      return "partyErrDenied";
    case "party:offline":
      return "partyErrOffline";
    case "party:rate_limited":
      return "partyErrRateLimited";
    default:
      return "partyErrGeneric";
  }
}

export function partyErrorOf(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : "";
}

// ---- title descriptor ----

function cleanIds(source: Record<string, string | null | undefined>): PartyTitle["ids"] {
  const ids: PartyTitle["ids"] = {};
  for (const [key, value] of Object.entries(source)) {
    const k = key.toLowerCase();
    if (!value || !(k === "imdb" || k === "tmdb" || k === "tvdb")) continue;
    if (k === "imdb" && !value.startsWith("tt")) continue;
    (ids as Record<string, string>)[k] = value;
  }
  return ids;
}

function titleKey(kind: string, ids: PartyTitle["ids"], addon: PartyTitle["addon"], name: string, season: number | null, episode: number | null) {
  const id = ids.imdb ?? (ids.tmdb ? `tmdb${ids.tmdb}` : ids.tvdb ? `tvdb${ids.tvdb}` : addon?.metaId ?? name);
  return `${kind}:${id}:${season ?? ""}:${episode ?? ""}`;
}

/** Describes what the host plays so that each guest can find it in their own sources. */
export async function describeForParty(movie: Movie): Promise<PartyTitle> {
  const base = {
    name: movie.name,
    seriesName: movie.seriesName,
    year: movie.year,
    season: movie.seasonNumber,
    episode: movie.episodeNumber,
  };
  if (movie.live) {
    return { ...base, key: `live:${movie.live.channelId}`, kind: "unsupported", ids: {}, addon: null };
  }
  const ext = movie.external;
  if (ext) {
    const ids = cleanIds({ imdb: ext.imdb ?? (ext.metaId.startsWith("tt") ? ext.metaId.split(":")[0] : null) });
    const addon = {
      type: ext.type,
      metaId: ext.metaId,
      videoId: ext.videoId,
      prefer: ext.stream ? { addonUrl: ext.stream.addonUrl, bingeGroup: ext.stream.bingeGroup } : (ext.prefer ?? null),
    };
    const season = ext.season ?? null;
    const episode = ext.episode ?? null;
    return { ...base, season, episode, key: titleKey(ext.type, ids, addon, movie.name, season, episode), kind: ext.type, ids, addon };
  }
  if (movie.kind === "Episode" && movie.seriesId) {
    // Episodes carry their own ids; the guests look the show up and count from there.
    const series = await api.getItem(movie.seriesId).catch(() => null);
    const ids = cleanIds(series?.providerIds ?? {});
    const ref = externalRefForJellyfin(movie, ids.imdb ?? null);
    const addon = ref ? { type: ref.type, metaId: ref.metaId, videoId: ref.videoId, prefer: null } : null;
    return {
      ...base,
      key: titleKey("series", ids, addon, movie.seriesName ?? movie.name, movie.seasonNumber, movie.episodeNumber),
      kind: "series",
      ids,
      addon,
    };
  }
  const ids = cleanIds(movie.providerIds ?? {});
  const ref = externalRefForJellyfin(movie);
  const addon = ref ? { type: ref.type, metaId: ref.metaId, videoId: ref.videoId, prefer: null } : null;
  return { ...base, key: titleKey("movie", ids, addon, movie.name, null, null), kind: "movie", ids, addon };
}

/** "Series · S1:E3" or "Movie (2020)": how the title reads in messages. */
export function partyTitleLabel(title: PartyTitle): string {
  if (title.kind === "series" && title.season != null && title.episode != null) {
    return `${title.seriesName ?? title.name} · S${title.season}:E${title.episode}`;
  }
  return title.year ? `${title.name} (${title.year})` : title.name;
}

/**
 * The host's title in this person's sources: their Jellyfin library first (same file
 * quality as they are used to, no stream to pick), else the same addon meta. `online`
 * means a stream still has to be chosen (or auto-picked with the host's preference).
 */
export async function resolvePartyTitle(
  title: PartyTitle,
  hasServer: boolean,
): Promise<{ movie: Movie; online: boolean } | null> {
  if (title.kind === "unsupported") return null;
  const mark = (movie: Movie): Movie => ({ ...movie, partyKey: title.key });
  if (hasServer && Object.keys(title.ids).length) {
    const found = await partyApi.findLibraryItem(title.kind, title.ids, title.season, title.episode).catch(() => null);
    if (found) return { movie: mark(found), online: false };
  }
  const addon = title.addon;
  if (!addon) return null;
  const meta = await api.addonMeta(addon.type, addon.metaId).catch(() => null);
  if (!meta) return null;
  let movie: Movie;
  if (addon.type === "series") {
    const video =
      meta.videos.find((v) => v.id === addon.videoId) ??
      meta.videos.find((v) => v.season === title.season && v.episode === title.episode);
    if (!video) return null;
    movie = videoToMovie(meta, video);
  } else {
    movie = metaFullToMovie(meta);
  }
  if (!movie.external) return null;
  return { movie: mark({ ...movie, external: { ...movie.external, prefer: addon.prefer } }), online: true };
}

// ---- sync arithmetic ----

/** Guests seek when they are this far from the host while playing... */
export const DRIFT_PLAYING = 1.5;
/** ...and tighter while paused, where a seek costs nothing and the restart is shared. */
export const DRIFT_PAUSED = 0.4;
/** After a corrective seek, give the player time to buffer before judging again. */
export const SEEK_COOLDOWN_MS = 4000;
/** Older heartbeats than this are not projected forward (clocks may disagree). */
const MAX_PROJECTION_S = 15;

/** Where the host is at `hostNow` (host clock, ms), from its last report. */
export function expectedPosition(sync: Pick<PartySync, "pos" | "paused" | "rate" | "at">, hostNow: number): number {
  if (sync.paused) return sync.pos;
  const elapsed = Math.min(Math.max(0, (hostNow - sync.at) / 1000), MAX_PROJECTION_S);
  return sync.pos + elapsed * sync.rate;
}

export type Correction = { seek: number | null; pause: boolean | null; rate: number | null };

/**
 * What a guest must change to match the host: pause state, speed, and a seek when the
 * gap is past the threshold (not again while a previous seek may still be buffering).
 */
export function decideCorrection(
  local: { time: number; paused: boolean; speed: number; duration: number },
  remote: PartySync,
  hostNow: number,
  now: number,
  lastSeekAt: number,
): Correction {
  const pause = remote.paused !== local.paused ? remote.paused : null;
  const rate = Math.abs(remote.rate - local.speed) > 0.01 ? remote.rate : null;
  let target = expectedPosition(remote, hostNow);
  if (local.duration > 0) target = Math.min(target, Math.max(0, local.duration - 1));
  target = Math.max(0, target);
  const gap = Math.abs(local.time - target);
  const threshold = remote.paused ? DRIFT_PAUSED : DRIFT_PLAYING;
  const cooling = now - lastSeekAt < SEEK_COOLDOWN_MS;
  const seek = gap > threshold && !cooling ? target : null;
  return { seek, pause, rate };
}

/** One ping round trip: how far the host's clock is ahead of ours, and how sure we are. */
export type ClockSample = { offset: number; rtt: number };

export function clockSample(sentAt: number, hostAt: number, receivedAt: number): ClockSample {
  const rtt = Math.max(0, receivedAt - sentAt);
  return { offset: hostAt + rtt / 2 - receivedAt, rtt };
}

/** The sample with the shortest round trip is the least distorted by queueing. */
export function bestOffset(samples: ClockSample[]): number {
  if (!samples.length) return 0;
  return samples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset;
}

/** Where a player is now, from its last state event (`time` at `receivedAt`, local ms). */
export function livePosition(time: number, paused: boolean, speed: number, receivedAt: number, now: number): number {
  if (paused) return time;
  return time + Math.max(0, Math.min(5, (now - receivedAt) / 1000)) * speed;
}
