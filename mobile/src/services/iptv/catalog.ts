/**
 * Parsed playlist of one source (memory and the `<documents>/iptv/<id>.json` cache) and
 * the download / parse pipeline that builds it (port of `Catalog` and `build` in
 * `src-tauri/src/iptv.rs`). Programmes are not part of the JSON: see `epgdb`.
 */
import type { XtreamAccount } from "../../lib/types";
import { fetchWithTimeout, shortError } from "../http";
import { PATHS, deleteIfExists, readTextIfExists, writeTextAtomic } from "../store";
import { nowMs } from "../util";
import { MAX_EPG_BYTES, MAX_PLAYLIST_BYTES, downloadToFile, readTextFile, streamTextFile } from "./download";
import { EpgWriter } from "./epgdb";
import { MAX_CHANNELS, parseM3u, type IptvChannel } from "./m3u";
import { userAgentOf, type StoredSource } from "./sources";
import { XmltvScanner, linkGuide, wantedFromChannels } from "./xmltv";
import { parseAccount, xtreamApiUrl, xtreamChannels, xtreamXmltvUrl } from "./xtream";
import { serverOffset } from "./catchup";

const MAX_JSON_BYTES = 48 * 1024 * 1024;
const HTTP_TIMEOUT_MS = 120_000;

export class Catalog {
  channels: IptvChannel[] = [];
  /** Our channel id → XMLTV channel id. */
  channelEpg = new Map<string, string>();
  updatedMs = 0;
  account: XtreamAccount | null = null;
  /** Xtream server clock minus UTC (seconds): timeshift URLs are in server time. */
  serverOffset = 0;
  epgSource: string | null = null;
  epgError: string | null = null;
  private index = new Map<string, IptvChannel>();
  private groupCount: number | null = null;

  finish(): this {
    this.index = new Map(this.channels.map((c) => [c.id, c]));
    this.groupCount = null;
    return this;
  }

  get(id: string): IptvChannel | undefined {
    return this.index.get(id);
  }

  groups(): number {
    if (this.groupCount === null) this.groupCount = new Set(this.channels.map((c) => c.group)).size;
    return this.groupCount;
  }

  epgIdOf(channelId: string): string | undefined {
    return this.channelEpg.get(channelId);
  }

  toJson(): string {
    return JSON.stringify({
      channels: this.channels,
      channelEpg: Object.fromEntries(this.channelEpg),
      updatedMs: this.updatedMs,
      account: this.account,
      serverOffset: this.serverOffset,
      epgSource: this.epgSource,
      epgError: this.epgError,
    });
  }

  static fromJson(text: string): Catalog | null {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const catalog = new Catalog();
    if (Array.isArray(r.channels)) {
      catalog.channels = r.channels.filter(
        (c): c is IptvChannel => typeof c === "object" && c !== null && typeof (c as IptvChannel).id === "string",
      );
    }
    if (typeof r.channelEpg === "object" && r.channelEpg !== null) {
      for (const [k, v] of Object.entries(r.channelEpg as Record<string, unknown>)) {
        if (typeof v === "string") catalog.channelEpg.set(k, v);
      }
    }
    catalog.updatedMs = typeof r.updatedMs === "number" ? r.updatedMs : 0;
    catalog.account = typeof r.account === "object" && r.account !== null ? (r.account as XtreamAccount) : null;
    catalog.serverOffset = typeof r.serverOffset === "number" && Number.isFinite(r.serverOffset) ? r.serverOffset : 0;
    catalog.epgSource = typeof r.epgSource === "string" ? r.epgSource : null;
    catalog.epgError = typeof r.epgError === "string" ? r.epgError : null;
    return catalog.finish();
  }
}

export function readCache(sourceId: string): Catalog | null {
  const text = readTextIfExists(PATHS.iptvCatalog(sourceId));
  return text === null ? null : Catalog.fromJson(text);
}

export function writeCache(sourceId: string, catalog: Catalog): void {
  try {
    writeTextAtomic(PATHS.iptvCatalog(sourceId), catalog.toJson());
  } catch (error) {
    console.warn("[iptv] cache write failed", error);
  }
}

export function deleteCache(sourceId: string): void {
  deleteIfExists(PATHS.iptvCatalog(sourceId));
}

// ---- Xtream ----

function connectError(error: unknown): Error {
  const message = shortError(error);
  if (message === "Tiempo de espera agotado") return new Error("No se pudo conectar: tiempo de espera agotado");
  if (message === "No se pudo conectar") return new Error("No se pudo conectar: no responde");
  return new Error(`No se pudo conectar: ${message}`);
}

export async function xtreamJson(
  source: Pick<StoredSource, "url" | "username" | "userAgent">,
  password: string,
  action: string | null,
): Promise<unknown> {
  const url = xtreamApiUrl(source.url, source.username, password, action);
  const ua = userAgentOf(source);
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { timeoutMs: HTTP_TIMEOUT_MS, headers: ua ? { "user-agent": ua } : {} });
  } catch (error) {
    throw connectError(error);
  }
  if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_JSON_BYTES) throw new Error("La respuesta es demasiado grande");
  let text: string;
  try {
    text = await res.text();
  } catch (error) {
    throw new Error(`Descarga interrumpida: ${shortError(error)}`);
  }
  if (text.length > MAX_JSON_BYTES) throw new Error("La respuesta es demasiado grande");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("El servidor no respondió como Xtream Codes");
  }
}

/** Signs in to an Xtream account and describes it (used by "Check" in Settings). */
export async function xtreamCheck(
  source: Pick<StoredSource, "url" | "username" | "userAgent">,
  password: string,
): Promise<XtreamAccount> {
  return parseAccount(await xtreamJson(source, password, null));
}

// ---- build ----

/** Downloads / reads the playlist and fills the channels (no guide yet). */
export async function buildChannels(
  source: StoredSource,
  password: string,
): Promise<{ catalog: Catalog; headerEpg: string | null }> {
  const catalog = new Catalog();
  let headerEpg: string | null = null;
  switch (source.kind) {
    case "m3uUrl": {
      const file = await downloadToFile(source.url, PATHS.iptvDownload(source.id, "m3u"), {
        userAgent: userAgentOf(source),
        maxBytes: MAX_PLAYLIST_BYTES,
      });
      try {
        const text = await readTextFile(file, MAX_PLAYLIST_BYTES, "La respuesta es demasiado grande");
        const parsed = parseM3u(text, source.id);
        catalog.channels = parsed.channels;
        headerEpg = parsed.epgUrl;
      } finally {
        deleteIfExists(file);
      }
      break;
    }
    case "m3uFile": {
      const file = PATHS.iptvImported(source.id);
      if (!file.exists) throw new Error("No se pudo leer el archivo M3U");
      if ((file.size ?? 0) > MAX_PLAYLIST_BYTES) throw new Error("El archivo es demasiado grande");
      let text: string;
      try {
        text = await readTextFile(file, MAX_PLAYLIST_BYTES, "El archivo es demasiado grande");
      } catch (error) {
        const message = shortError(error);
        throw new Error(message === "El archivo es demasiado grande" ? message : "No se pudo leer el archivo M3U");
      }
      const parsed = parseM3u(text, source.id);
      catalog.channels = parsed.channels;
      headerEpg = parsed.epgUrl;
      break;
    }
    case "xtream": {
      const auth = await xtreamJson(source, password, null);
      catalog.account = parseAccount(auth);
      catalog.serverOffset = serverOffset(auth);
      const categories = await xtreamJson(source, password, "get_live_categories").catch(() => null);
      const streams = await xtreamJson(source, password, "get_live_streams");
      catalog.channels = xtreamChannels(source.id, categories, streams, "live");
      if (source.includeVod) {
        const vodCategories = await xtreamJson(source, password, "get_vod_categories").catch(() => null);
        const vod = await xtreamJson(source, password, "get_vod_streams").catch(() => undefined);
        if (vod !== undefined) {
          catalog.channels.push(...xtreamChannels(source.id, vodCategories, vod, "movie"));
        }
      }
      break;
    }
  }
  if (catalog.channels.length === 0) throw new Error("La lista no contiene canales");
  if (catalog.channels.length > MAX_CHANNELS) catalog.channels.length = MAX_CHANNELS;
  return { catalog: catalog.finish(), headerEpg };
}

/** URL of the guide: explicit `epgUrl`, else the Xtream `xmltv.php`, else the M3U header. */
export function epgUrlFor(source: StoredSource, password: string, headerEpg: string | null): string | null {
  if (source.epgUrl !== "") return source.epgUrl;
  if (source.kind === "xtream") return xtreamXmltvUrl(source.url, source.username, password);
  return headerEpg;
}

/**
 * Downloads the guide, streams it into SQLite and links the channels. Failures end up in
 * `catalog.epgError` (the playlist stays usable). When `isCurrent` turns false (the source
 * was removed or the profile left meanwhile) the staged rows are dropped, not committed.
 */
export async function attachEpg(
  catalog: Catalog,
  source: StoredSource,
  password: string,
  headerEpg: string | null,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const url = epgUrlFor(source, password, headerEpg);
  if (url === null) return;
  catalog.epgSource = source.kind === "xtream" && source.epgUrl === "" ? "xtream" : url;
  const target = PATHS.iptvDownload(source.id, "epg");
  let writer: EpgWriter | null = null;
  try {
    const file = await downloadToFile(url, target, { userAgent: userAgentOf(source), maxBytes: MAX_EPG_BYTES });
    const wanted = wantedFromChannels(catalog.channels);
    const scanner = new XmltvScanner(wanted.ids, wanted.names, Math.floor(nowMs() / 1000));
    const epg = new EpgWriter(source.id);
    writer = epg;
    await streamTextFile(file, (text) => {
      if (!isCurrent()) throw new Error("superseded");
      scanner.push(text);
      epg.insert(scanner.drain());
    });
    scanner.finish();
    epg.insert(scanner.drain());
    if (!isCurrent()) {
      epg.abort();
      return;
    }
    catalog.channelEpg = linkGuide(catalog.channels, scanner.names, scanner.idsWithProgrammes);
    epg.commit();
    catalog.epgError = null;
  } catch (error) {
    writer?.abort();
    catalog.channelEpg = new Map();
    catalog.epgError = shortError(error);
  } finally {
    deleteIfExists(target);
  }
}
