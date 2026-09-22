/**
 * Stremio addon protocol: manifest, catalog, meta and stream parsing (port of
 * `src-tauri/src/addons.rs`). No platform imports: unit-tested under node.
 */
import type {
  AddonCatalog,
  AddonInfo,
  AddonMeta,
  AddonMetaFull,
  AddonStream,
  AddonVideo,
  ImportedAddon,
  ResumeEntry,
} from "../lib/types";

export const CINEMETA_URL = "https://v3-cinemeta.strem.io/manifest.json";
export const MANIFEST_TTL_MS = 60 * 60 * 1000;
export const CATALOG_TTL_MS = 5 * 60 * 1000;
export const MAX_CATALOG_CACHE = 200;
export const MAX_RESUME_ENTRIES = 100;

type Json = unknown;

/** Parsed manifest plus the raw document (needed by `supports`). */
export type LoadedAddon = { info: AddonInfo; manifest: Json };

function isObject(v: Json): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `text(v, key)`: trimmed non-empty string field. */
export function text(v: Json, key: string): string | null {
  if (!isObject(v)) return null;
  const raw = v[key];
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s ? s : null;
}

/** `strings(v, key)`: string items of an array field. */
export function strings(v: Json, key: string): string[] {
  if (!isObject(v)) return [];
  const raw = v[key];
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

/** Percent-encoding identical to the Rust `urlencoding_lite` (only unreserved bytes kept). */
export function percentEncode(s: string): string {
  const bytes = utf8Bytes(s);
  let out = "";
  for (const b of bytes) {
    if (
      (b >= 0x41 && b <= 0x5a) ||
      (b >= 0x61 && b <= 0x7a) ||
      (b >= 0x30 && b <= 0x39) ||
      b === 0x2d ||
      b === 0x5f ||
      b === 0x2e ||
      b === 0x7e
    ) {
      out += String.fromCharCode(b);
    } else {
      out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return out;
}

export function baseOf(manifestUrl: string): string {
  return manifestUrl.endsWith("/manifest.json") ? manifestUrl.slice(0, -"/manifest.json".length) : manifestUrl;
}

/** `{base}/catalog/{type}/{id}[/{extras}].json`; extras only with non-empty values. */
export function catalogPath(manifestUrl: string, type: string, id: string, extra: [string, string][]): string {
  let path = `${baseOf(manifestUrl)}/catalog/${percentEncode(type)}/${percentEncode(id)}`;
  const query = extra.filter(([, v]) => v !== "").map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`);
  if (query.length) path += `/${query.join("&")}`;
  return `${path}.json`;
}

export function metaPath(manifestUrl: string, type: string, id: string): string {
  return `${baseOf(manifestUrl)}/meta/${percentEncode(type)}/${percentEncode(id)}.json`;
}

export function streamPath(manifestUrl: string, type: string, id: string): string {
  return `${baseOf(manifestUrl)}/stream/${percentEncode(type)}/${percentEncode(id)}.json`;
}

/** Extras in Rust order: search (trimmed), genre, skip (> 0). */
export function catalogExtras(args: { search?: string | null; genre?: string | null; skip?: number | null }): [
  string,
  string,
][] {
  const extra: [string, string][] = [];
  const search = args.search?.trim();
  if (search) extra.push(["search", search]);
  if (args.genre) extra.push(["genre", args.genre]);
  if (args.skip != null && args.skip > 0) extra.push(["skip", String(Math.trunc(args.skip))]);
  return extra;
}

export function parseManifest(url: string, value: Json, builtin: boolean): LoadedAddon {
  const name = text(value, "name");
  if (!name) throw new Error("El manifest no tiene nombre");
  const obj = isObject(value) ? value : {};
  const resources: string[] = [];
  const rawResources = obj.resources;
  if (Array.isArray(rawResources)) {
    for (const r of rawResources) {
      if (typeof r === "string") resources.push(r);
      else if (isObject(r) && typeof r.name === "string") resources.push(r.name);
    }
  }
  const types = strings(value, "types");
  const catalogs: AddonCatalog[] = [];
  const rawCatalogs = obj.catalogs;
  if (Array.isArray(rawCatalogs)) {
    for (const c of rawCatalogs) {
      const kind = text(c, "type");
      const id = text(c, "id");
      if (!kind || !id) continue;
      const cname = text(c, "name") ?? id;
      const extra = isObject(c) && Array.isArray(c.extra) ? c.extra : [];
      const extraSupported = strings(c, "extraSupported");
      const extraRequired = strings(c, "extraRequired");
      let searchable = extraSupported.includes("search");
      let requiresExtra = extraRequired.length > 0;
      let genres: string[] = [];
      for (const e of extra) {
        const ename = text(e, "name") ?? "";
        const required = isObject(e) && e.isRequired === true;
        if (ename === "search") searchable = true;
        if (ename === "genre") genres = strings(e, "options");
        if (required) requiresExtra = true;
      }
      catalogs.push({
        addonUrl: url,
        addonName: name,
        type: kind,
        id,
        name: cname,
        searchable,
        requiresExtra,
        genres,
      });
    }
  }
  const info: AddonInfo = {
    url,
    id: text(value, "id") ?? url,
    name,
    version: text(value, "version") ?? "",
    description: text(value, "description") ?? "",
    logo: text(value, "logo"),
    types,
    resources,
    catalogs,
    builtin,
  };
  return { info, manifest: value };
}

/** Does the addon declare `resource` for this content type and id prefix? */
export function supports(addon: LoadedAddon, resource: string, type: string, id: string): boolean {
  const manifest = addon.manifest;
  if (!isObject(manifest) || !Array.isArray(manifest.resources)) return false;
  const globalTypes = strings(manifest, "types");
  const globalPrefixes = strings(manifest, "idPrefixes");
  const typeOk = (types: string[]) => types.length === 0 || types.includes(type);
  const prefixOk = (prefixes: string[]) => prefixes.length === 0 || prefixes.some((p) => id.startsWith(p));
  return manifest.resources.some((r) => {
    if (typeof r === "string") {
      return r === resource && typeOk(globalTypes) && prefixOk(globalPrefixes);
    }
    if (isObject(r)) {
      if (r.name !== resource) return false;
      const ownTypes = strings(r, "types");
      const ownPrefixes = strings(r, "idPrefixes");
      const types = ownTypes.length ? ownTypes : globalTypes;
      const prefixes = ownPrefixes.length ? ownPrefixes : globalPrefixes;
      return typeOk(types) && prefixOk(prefixes);
    }
    return false;
  });
}

function firstFourAsYear(s: string | null): number | null {
  if (!s || s.length < 4) return null;
  const head = s.slice(0, 4);
  if (!/^[+-]?\d+$/.test(head)) return null;
  const n = Number(head);
  return Number.isSafeInteger(n) ? n : null;
}

export function parseMeta(v: Json): AddonMeta | null {
  const id = text(v, "id");
  const name = text(v, "name");
  if (!id || !name) return null;
  const obj = isObject(v) ? v : {};
  const kind = text(v, "type") ?? "movie";
  const imdb = text(v, "imdb_id") ?? (id.startsWith("tt") ? id.split(":")[0] : null);
  const releaseInfo = text(v, "releaseInfo");
  let year: number | null = null;
  const rawYear = obj.year;
  if (typeof rawYear === "number" && Number.isInteger(rawYear)) year = rawYear;
  else year = firstFourAsYear(text(v, "year") ?? releaseInfo);
  let imdbRating: number | null = null;
  const rawRating = obj.imdbRating;
  if (typeof rawRating === "number" && Number.isFinite(rawRating)) imdbRating = rawRating;
  else if (typeof rawRating === "string" && rawRating.trim() !== "") {
    const n = Number(rawRating);
    if (Number.isFinite(n)) imdbRating = n;
  }
  return {
    id,
    type: kind,
    name,
    poster: text(v, "poster"),
    background: text(v, "background"),
    logo: text(v, "logo"),
    description: text(v, "description"),
    releaseInfo,
    imdbRating,
    genres: strings(v, "genres"),
    runtime: text(v, "runtime"),
    year,
    imdb,
  };
}

function intField(v: Record<string, Json>, key: string): number | null {
  const raw = v[key];
  return typeof raw === "number" && Number.isInteger(raw) ? raw : null;
}

export function parseMetaFull(v: Json): AddonMetaFull | null {
  const meta = parseMeta(v);
  if (!meta) return null;
  const obj = isObject(v) ? v : {};
  const videos: AddonVideo[] = [];
  if (Array.isArray(obj.videos)) {
    for (const video of obj.videos) {
      const id = text(video, "id");
      if (!id || !isObject(video)) continue;
      videos.push({
        id,
        title: text(video, "title") ?? text(video, "name") ?? id,
        season: intField(video, "season"),
        episode: video.episode !== undefined ? intField(video, "episode") : intField(video, "number"),
        released: text(video, "released") ?? text(video, "firstAired"),
        thumbnail: text(video, "thumbnail"),
        overview: text(video, "overview"),
      });
    }
  }
  return { ...meta, cast: strings(v, "cast"), director: strings(v, "director"), videos, trailers: parseTrailers(obj) };
}

/** Stremio metas give trailers as YouTube ids; they become watch URLs. */
export function parseTrailers(v: Json): string[] {
  const ids: string[] = [];
  const push = (id: unknown) => {
    if (typeof id !== "string") return;
    const clean = id.trim();
    if (/^[\w-]{11}$/.test(clean) && !ids.includes(clean)) ids.push(clean);
  };
  const obj = isObject(v) ? v : {};
  if (Array.isArray(obj.trailerStreams)) for (const t of obj.trailerStreams) if (isObject(t)) push(t.ytId);
  if (Array.isArray(obj.trailers)) {
    for (const t of obj.trailers) {
      if (!isObject(t)) continue;
      const kind = typeof t.type === "string" ? t.type : "Trailer";
      if (kind.toLowerCase() === "trailer") push(t.source);
    }
  }
  return ids.map((id) => `https://www.youtube.com/watch?v=${id}`);
}

/**
 * Addons of a Stremio account collection (`addonCollectionGet`), without Cinemeta (built
 * in here) and the local streaming-server addon; duplicates dropped.
 */
export function parseStremioCollection(value: unknown, normalize: (url: string) => string): ImportedAddon[] {
  const result = isObject(value) && isObject(value.result) ? value.result : null;
  const list = result && Array.isArray(result.addons) ? result.addons : [];
  const out: ImportedAddon[] = [];
  for (const addon of list) {
    if (!isObject(addon) || typeof addon.transportUrl !== "string") continue;
    let url: string;
    try {
      url = normalize(addon.transportUrl);
    } catch {
      continue;
    }
    if (url === CINEMETA_URL || url.includes("127.0.0.1") || url.includes("localhost")) continue;
    if (out.some((a) => a.url === url)) continue;
    const manifest = isObject(addon.manifest) ? addon.manifest : {};
    const flags = isObject(addon.flags) ? addon.flags : {};
    out.push({
      url,
      name: typeof manifest.name === "string" ? manifest.name : url,
      official: flags.official === true,
    });
  }
  return out;
}

export function parseStream(addon: AddonInfo, s: Json): AddonStream | null {
  const rawUrl = text(s, "url");
  const url = rawUrl && (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) ? rawUrl : null;
  const externalUrl = text(s, "externalUrl");
  const infoHash = text(s, "infoHash");
  if (!url && !externalUrl && !infoHash) return null;
  const hints = isObject(s) && isObject(s.behaviorHints) ? s.behaviorHints : null;
  const headers: [string, string][] = [];
  if (hints && isObject(hints.proxyHeaders) && isObject(hints.proxyHeaders.request)) {
    for (const [k, v] of Object.entries(hints.proxyHeaders.request)) {
      if (typeof v === "string") headers.push([k, v]);
    }
  }
  let videoSize: number | null = null;
  if (hints && typeof hints.videoSize === "number" && Number.isInteger(hints.videoSize) && hints.videoSize >= 0) {
    videoSize = hints.videoSize;
  }
  return {
    addonName: addon.name,
    addonUrl: addon.url,
    name: text(s, "name") ?? addon.name,
    title: text(s, "title") ?? text(s, "description") ?? "",
    url,
    externalUrl,
    infoHash,
    headers,
    bingeGroup: hints ? text(hints, "bingeGroup") : null,
    filename: hints ? text(hints, "filename") : null,
    videoSize,
    playable: url !== null,
  };
}

/** Removes the entry by key and re-inserts it at the head unless finished / too early. */
export function upsertProgressList(list: ResumeEntry[], entry: ResumeEntry): ResumeEntry[] {
  const out = list.filter((e) => e.key !== entry.key);
  const finished = entry.durationSeconds > 0 && entry.positionSeconds / entry.durationSeconds > 0.95;
  if (!finished && entry.positionSeconds > 5) out.unshift(entry);
  return out.slice(0, MAX_RESUME_ENTRIES);
}

/** Fills missing fields of a stored entry (serde `default`). */
export function normalizeResumeEntry(raw: Json): ResumeEntry | null {
  if (!isObject(raw) || typeof raw.key !== "string") return null;
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);
  const num = (k: string) => (typeof raw[k] === "number" && Number.isFinite(raw[k] as number) ? (raw[k] as number) : 0);
  const int = (k: string) => (typeof raw[k] === "number" && Number.isInteger(raw[k] as number) ? (raw[k] as number) : null);
  return {
    key: raw.key,
    type: str("type") ?? "movie",
    metaId: str("metaId") ?? "",
    name: str("name") ?? "",
    seriesName: str("seriesName"),
    poster: str("poster"),
    background: str("background"),
    logo: str("logo"),
    season: int("season"),
    episode: int("episode"),
    imdb: str("imdb"),
    positionSeconds: num("positionSeconds"),
    durationSeconds: num("durationSeconds"),
    updatedMs: num("updatedMs"),
  };
}
