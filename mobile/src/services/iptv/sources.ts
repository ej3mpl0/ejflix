/**
 * IPTV source records per profile (`iptv.<userId>` in the store; passwords in the
 * Android Keystore), favorites, recents and the stream URL resolver. Port of the storage
 * section of `src-tauri/src/iptv.rs`.
 */
import { Platform } from "react-native";
import type { IptvSourceInput, IptvSourceKind } from "../../lib/types";
import { KEYS, PATHS, SECRET, deleteIfExists, secrets, store, writeTextAtomic } from "../store";
import { nowMs, uuid } from "../util";
import { LocalizedError } from "../errors";
import { MAX_PLAYLIST_BYTES, fileTooBigError } from "./download";
import type { IptvChannel } from "./m3u";
import { hostOf, normalizeHttpUrl, parseXtreamUrl, xtreamStreamUrl } from "./xtream";

export const MAX_SOURCES = 12;
const MAX_FAVORITES = 500;
const MAX_RECENT = 20;

/** A configured IPTV source as stored (the password lives in SecureStore). */
export type StoredSource = {
  id: string;
  name: string;
  kind: IptvSourceKind;
  /** Playlist URL (`m3uUrl`) or the Xtream server base (`http://host:port`). */
  url: string;
  /** Original file name of an imported playlist (`m3uFile`). */
  path: string;
  imported: boolean;
  username: string;
  hasPassword: boolean;
  epgUrl: string;
  /** "ts" | "m3u8": container Xtream serves live streams in. */
  output: string;
  userAgent: string;
  includeVod: boolean;
  enabled: boolean;
  createdMs: number;
};

const KINDS: IptvSourceKind[] = ["m3uUrl", "m3uFile", "xtream"];

function fromRaw(raw: unknown): StoredSource | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  const str = (k: string, d = "") => (typeof r[k] === "string" ? (r[k] as string) : d);
  const bool = (k: string, d: boolean) => (typeof r[k] === "boolean" ? (r[k] as boolean) : d);
  const kind = KINDS.includes(r.kind as IptvSourceKind) ? (r.kind as IptvSourceKind) : "m3uUrl";
  return {
    id: r.id,
    name: str("name"),
    kind,
    url: str("url"),
    path: str("path"),
    imported: bool("imported", false),
    username: str("username"),
    hasPassword: bool("hasPassword", false),
    epgUrl: str("epgUrl"),
    output: str("output", "ts"),
    userAgent: str("userAgent"),
    includeVod: bool("includeVod", false),
    enabled: bool("enabled", true),
    createdMs: typeof r.createdMs === "number" ? (r.createdMs as number) : 0,
  };
}

function newSource(): StoredSource {
  return {
    id: uuid(),
    name: "",
    kind: "m3uUrl",
    url: "",
    path: "",
    imported: false,
    username: "",
    hasPassword: false,
    epgUrl: "",
    output: "ts",
    userAgent: "",
    includeVod: false,
    enabled: true,
    createdMs: nowMs(),
  };
}

export function validSourceId(id: string): boolean {
  return id.length >= 8 && id.length <= 64 && /^[A-Za-z0-9-]+$/.test(id);
}

/** Source id part of a channel id (`<sourceId>:<key>`). */
export function sourceOf(channelId: string): string | null {
  const i = channelId.indexOf(":");
  if (i < 0) return null;
  const id = channelId.slice(0, i);
  return validSourceId(id) ? id : null;
}

export function listSources(uid: string): StoredSource[] {
  const raw = store.get<unknown[]>(KEYS.iptv(uid));
  if (!Array.isArray(raw)) return [];
  return raw.map(fromRaw).filter((s): s is StoredSource => s !== null && validSourceId(s.id));
}

function saveSources(uid: string, list: StoredSource[]): void {
  store.set(KEYS.iptv(uid), list);
}

function loadIds(key: string): string[] {
  const raw = store.get<unknown[]>(key);
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

export function favorites(uid: string): string[] {
  return loadIds(KEYS.iptvFavorites(uid));
}

export function setFavorite(uid: string, channelId: string, on: boolean): string[] {
  const list = favorites(uid).filter((id) => id !== channelId);
  if (on) list.unshift(channelId);
  const out = list.slice(0, MAX_FAVORITES);
  store.set(KEYS.iptvFavorites(uid), out);
  return out;
}

export function recent(uid: string): string[] {
  return loadIds(KEYS.iptvRecent(uid));
}

export function pushRecent(uid: string, channelId: string): void {
  const list = recent(uid).filter((id) => id !== channelId);
  list.unshift(channelId);
  store.set(KEYS.iptvRecent(uid), list.slice(0, MAX_RECENT));
}

function take(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

function defaultName(source: StoredSource): string {
  if (source.kind === "m3uFile") {
    const file = source.path.split(/[\\/]/).pop() ?? "";
    const dot = file.lastIndexOf(".");
    const stem = dot > 0 ? file.slice(0, dot) : file;
    return stem === "" ? "Lista M3U" : stem;
  }
  return hostOf(source.url) ?? "IPTV";
}

function upsert(list: StoredSource[], source: StoredSource): StoredSource[] {
  const i = list.findIndex((s) => s.id === source.id);
  if (i >= 0) list[i] = source;
  else list.push(source);
  return list;
}

/** Validates the form and stores the source (new or edited). Returns the saved source. */
export async function saveSource(uid: string, input: IptvSourceInput): Promise<StoredSource> {
  const list = listSources(uid);
  const existing = input.id ? list.find((s) => s.id === input.id) : undefined;
  if (!existing && list.length >= MAX_SOURCES) throw new LocalizedError("iptvErrMaxSources", `Máximo ${MAX_SOURCES} listas IPTV`, { max: MAX_SOURCES });
  const source: StoredSource = existing ? { ...existing } : newSource();
  source.kind = input.kind;
  source.enabled = input.enabled;
  source.includeVod = input.includeVod;
  source.output = input.output === "m3u8" ? "m3u8" : "ts";
  source.userAgent = take(input.userAgent.trim(), 200);
  const epgUrl = input.epgUrl.trim();
  source.epgUrl = epgUrl === "" ? "" : normalizeHttpUrl(epgUrl);
  source.username = take(input.username.trim(), 200);
  let newPassword: string | null = null;
  if (input.password) {
    if (input.password.length > 200) throw new LocalizedError("iptvErrPasswordTooLong", "Contraseña demasiado larga");
    newPassword = input.password;
  }
  switch (input.kind) {
    case "m3uUrl":
      source.url = normalizeHttpUrl(input.url);
      source.path = "";
      source.imported = false;
      break;
    case "m3uFile":
      if (!source.imported || !PATHS.iptvImported(source.id).exists) throw new LocalizedError("iptvErrPickFile", "Elige un archivo M3U");
      source.url = "";
      break;
    case "xtream": {
      const parsed = parseXtreamUrl(input.url);
      source.url = parsed.base;
      if (source.username === "") source.username = parsed.username ?? "";
      if (!source.hasPassword && newPassword === null && parsed.password) newPassword = parsed.password;
      if (source.username === "" || (!source.hasPassword && newPassword === null)) {
        throw new LocalizedError("iptvErrXtreamCredentials", "Xtream Codes necesita usuario y contraseña");
      }
      break;
    }
    default:
      throw new LocalizedError("iptvErrBadKind", "Tipo de lista no válido");
  }
  const name = take(input.name.trim(), 60);
  source.name = name === "" ? defaultName(source) : name;
  if (newPassword !== null) {
    await secrets.set(SECRET.iptvPassword(source.id), newPassword);
    source.hasPassword = true;
  }
  saveSources(uid, upsert(list, source));
  return source;
}

/**
 * Stores the content of a playlist file picked in the UI and creates (or updates) the
 * `m3uFile` source that reads it.
 */
export async function importPlaylist(
  uid: string,
  id: string | null,
  name: string,
  fileName: string,
  text: string,
): Promise<StoredSource> {
  if (text.length > MAX_PLAYLIST_BYTES) throw fileTooBigError();
  if (!text.trimStart().startsWith("#EXTM3U") && !text.includes("#EXTINF")) {
    throw new LocalizedError("iptvErrNotM3u", "El archivo no parece una lista M3U");
  }
  const list = listSources(uid);
  const existing = id ? list.find((s) => s.id === id) : undefined;
  if (!existing && list.length >= MAX_SOURCES) throw new LocalizedError("iptvErrMaxSources", `Máximo ${MAX_SOURCES} listas IPTV`, { max: MAX_SOURCES });
  const source: StoredSource = existing ? { ...existing } : newSource();
  source.kind = "m3uFile";
  source.url = "";
  source.imported = true;
  source.path = take(fileName.trim(), 120);
  const clean = take(name.trim(), 60);
  if (clean !== "") source.name = clean;
  else if (source.name === "") source.name = defaultName(source);
  writeTextAtomic(PATHS.iptvImported(source.id), text);
  saveSources(uid, upsert(list, source));
  return source;
}

/** Deletes the files, secret and ids of one source (memory / guide rows are the state's job). */
async function purgeSourceFiles(id: string): Promise<void> {
  deleteIfExists(PATHS.iptvCatalog(id));
  deleteIfExists(PATHS.iptvImported(id));
  deleteIfExists(PATHS.iptvDownload(id, "m3u"));
  deleteIfExists(PATHS.iptvDownload(id, "epg"));
  await secrets.remove(SECRET.iptvPassword(id));
}

export async function removeSource(uid: string, id: string): Promise<void> {
  saveSources(
    uid,
    listSources(uid).filter((s) => s.id !== id),
  );
  await purgeSourceFiles(id);
  const prefix = `${id}:`;
  store.set(
    KEYS.iptvFavorites(uid),
    favorites(uid).filter((c) => !c.startsWith(prefix)),
  );
  store.set(
    KEYS.iptvRecent(uid),
    recent(uid).filter((c) => !c.startsWith(prefix)),
  );
}

/** Drops every IPTV record of a profile. Returns the ids of the sources it had. */
export async function deleteProfileSources(uid: string): Promise<string[]> {
  const ids = listSources(uid).map((s) => s.id);
  for (const id of ids) await purgeSourceFiles(id);
  store.remove(KEYS.iptv(uid));
  store.remove(KEYS.iptvFavorites(uid));
  store.remove(KEYS.iptvRecent(uid));
  store.remove(KEYS.iptvReminders(uid));
  return ids;
}

export async function passwordOf(source: Pick<StoredSource, "id" | "hasPassword">): Promise<string> {
  if (!source.hasPassword) return "";
  return (await secrets.get(SECRET.iptvPassword(source.id))) ?? "";
}

export function userAgentOf(source: Pick<StoredSource, "userAgent">): string | null {
  const ua = source.userAgent.trim();
  return ua === "" ? null : ua;
}

/**
 * Stream URL and request headers for a channel (Xtream URLs carry the credentials, so
 * they are only ever built here).
 */
export function streamFor(
  source: StoredSource,
  password: string,
  channel: IptvChannel,
): { url: string; headers: Record<string, string> } {
  let url: string;
  if (source.kind === "xtream") {
    if (channel.streamId === "" || password === "") throw new LocalizedError("iptvErrChannelUnavailable", "Canal no disponible");
    // AVPlayer cannot play a raw MPEG-TS stream, only HLS: on iOS every Xtream live
    // channel is asked for as .m3u8 whatever the source says.
    const output = Platform.OS === "ios" ? "m3u8" : source.output;
    url = xtreamStreamUrl(source.url, source.username, password, output, channel);
  } else {
    url = channel.url;
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new LocalizedError("playErrHttpOnly", "Solo se pueden reproducir canales http o https");
  }
  const headers: Record<string, string> = {};
  const ua = channel.userAgent ?? userAgentOf(source);
  if (ua !== null) headers["User-Agent"] = ua;
  if (channel.referrer !== null) headers.Referer = channel.referrer;
  return { url, headers };
}
