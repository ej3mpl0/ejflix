/**
 * Stremio addon client (port of `src-tauri/src/addons.rs` and the `addon_*` commands).
 * Manifests are cached 60 min, catalog pages 5 min (never when searching); streams are
 * fetched concurrently from every addon that serves them.
 */
import type { AddonInfo, AddonMeta, AddonMetaFull, AddonStream, ImportedAddon, LibraryEntry, ResumeEntry, SettingsPatch } from "../lib/types";
import { emit } from "./events";
import { fetchWithTimeout, shortError } from "./http";
import { KEYS, store } from "./store";
import { nowMs } from "./util";
import { getSettingsFor, mergeAndSave, settingsGet, settingsUser } from "./settings";
import { normalizeManifestUrl } from "./settings.pure";
import { registerSessionCleanup } from "./session";
import {
  CATALOG_TTL_MS,
  CINEMETA_URL,
  MANIFEST_TTL_MS,
  MAX_CATALOG_CACHE,
  catalogExtras,
  catalogPath,
  metaPath,
  normalizeResumeEntry,
  parseManifest,
  parseMeta,
  parseMetaFull,
  parseStream,
  parseStremioCollection,
  streamPath,
  supports,
  upsertProgressList,
  type LoadedAddon,
} from "./addons.pure";
import { BLOCKED, allows as allowsParental, currentRule } from "./parental";

const HTTP_TIMEOUT_MS = 25_000;
const STREAM_TIMEOUT_MS = 20_000;

const manifests = new Map<string, { at: number; addon: LoadedAddon }>();
const catalogs = new Map<string, { at: number; metas: AddonMeta[] }>();

export function clearAddonCaches(): void {
  manifests.clear();
  catalogs.clear();
}

registerSessionCleanup(clearAddonCaches);

function statusLabel(res: Response): string {
  return `${res.status} ${res.statusText ?? ""}`.trim();
}

async function manifest(rawUrl: string, builtin: boolean): Promise<LoadedAddon> {
  const url = normalizeManifestUrl(rawUrl);
  const cached = manifests.get(url);
  if (cached && nowMs() - cached.at < MANIFEST_TTL_MS) return cached.addon;
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { timeoutMs: HTTP_TIMEOUT_MS });
  } catch (error) {
    throw new Error(`No se pudo cargar el addon: ${shortError(error)}`);
  }
  if (!res.ok) throw new Error(`El addon respondió ${statusLabel(res)}`);
  let value: unknown;
  try {
    value = await res.json();
  } catch {
    throw new Error("El manifest del addon no es JSON válido");
  }
  const addon = parseManifest(url, value, builtin);
  manifests.set(url, { at: nowMs(), addon });
  return addon;
}

function forget(rawUrl: string): void {
  let url: string;
  try {
    url = normalizeManifestUrl(rawUrl);
  } catch {
    return;
  }
  manifests.delete(url);
  const base = url.endsWith("/manifest.json") ? url.slice(0, -"/manifest.json".length) : url;
  for (const key of Array.from(catalogs.keys())) {
    if (key.startsWith(base)) catalogs.delete(key);
  }
}

async function getJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { timeoutMs: HTTP_TIMEOUT_MS });
  } catch (error) {
    throw new Error(`Error de red: ${shortError(error)}`);
  }
  if (!res.ok) throw new Error(`El addon respondió ${statusLabel(res)}`);
  try {
    return await res.json();
  } catch {
    throw new Error("Respuesta no válida del addon");
  }
}

/** Manifest URLs to consult, in priority order (built-in Cinemeta last). */
async function addonUrls(): Promise<[string, boolean][]> {
  const prefs = (await settingsGet()).addons;
  const list: [string, boolean][] = prefs.urls.map((u) => [u, false]);
  if (prefs.cinemeta && !list.some(([u]) => u === CINEMETA_URL)) list.push([CINEMETA_URL, true]);
  return list;
}

async function loadedAddons(): Promise<LoadedAddon[]> {
  const out: LoadedAddon[] = [];
  for (const [url, builtin] of await addonUrls()) {
    try {
      out.push(await manifest(url, builtin));
    } catch {
      /* unreachable addon: skipped, like the desktop */
    }
  }
  return out;
}

export async function addonsList(): Promise<AddonInfo[]> {
  return (await loadedAddons()).map((a) => a.info);
}

function requireUser(): string {
  const uid = settingsUser();
  if (!uid) throw new Error("No hay sesión activa");
  return uid;
}

/** Validates the manifest, stores the URL with the profile settings and returns the addon. */
export async function addonAdd(rawUrl: string): Promise<AddonInfo> {
  const url = normalizeManifestUrl(rawUrl);
  const addon = await manifest(url, false);
  const uid = requireUser();
  const urls = [...(await getSettingsFor(uid)).addons.urls];
  if (!urls.includes(url)) urls.push(url);
  const patch: SettingsPatch = { addons: { urls } };
  const saved = await mergeAndSave(uid, patch);
  emit("settings://changed", saved);
  return addon.info;
}

export async function addonRemove(rawUrl: string): Promise<void> {
  const url = normalizeManifestUrl(rawUrl);
  const uid = requireUser();
  const current = (await getSettingsFor(uid)).addons;
  const urls = current.urls.filter((u) => u !== url);
  const cinemeta = url === CINEMETA_URL ? false : current.cinemeta;
  const patch: SettingsPatch = { addons: { urls, cinemeta } };
  const saved = await mergeAndSave(uid, patch);
  forget(url);
  emit("settings://changed", saved);
}

export async function addonCatalog(args: {
  addonUrl: string;
  type: string;
  id: string;
  search?: string;
  genre?: string;
  skip?: number;
}): Promise<AddonMeta[]> {
  const url = normalizeManifestUrl(args.addonUrl);
  const known = (await addonUrls()).find(([u]) => u === url);
  if (!known) throw new Error("Addon no configurado");
  const addon = await manifest(url, known[1]);
  const extra = catalogExtras(args);
  const path = catalogPath(addon.info.url, args.type, args.id, extra);
  const cacheable = !extra.some(([k]) => k === "search");
  if (cacheable) {
    const cached = catalogs.get(path);
    if (cached && nowMs() - cached.at < CATALOG_TTL_MS) return allowedOnly(cached.metas);
  }
  const value = await getJson(path);
  const rawMetas =
    typeof value === "object" && value !== null && Array.isArray((value as { metas?: unknown }).metas)
      ? ((value as { metas: unknown[] }).metas)
      : [];
  const metas = rawMetas.map(parseMeta).filter((m): m is AddonMeta => m !== null);
  if (cacheable) {
    if (catalogs.size > MAX_CATALOG_CACHE) catalogs.clear();
    catalogs.set(path, { at: nowMs(), metas });
  }
  return allowedOnly(metas);
}

/** Catalog entries the open profile may see (the cache keeps the full page). */
function allowedOnly(metas: AddonMeta[]): AddonMeta[] {
  return currentRule() ? metas.filter((m) => allowsParental(m.certification)) : metas;
}

/** Full metadata: the first addon that serves `meta` for this type/id, else Cinemeta. */
export async function addonMeta(type: string, id: string): Promise<AddonMetaFull> {
  const addons = await loadedAddons();
  const candidates = addons.filter((a) => supports(a, "meta", type, id));
  if (!candidates.some((a) => a.info.url === CINEMETA_URL)) {
    try {
      const cinemeta = await manifest(CINEMETA_URL, true);
      if (supports(cinemeta, "meta", type, id)) candidates.push(cinemeta);
    } catch {
      /* Cinemeta unreachable */
    }
  }
  for (const addon of candidates) {
    try {
      const value = await getJson(metaPath(addon.info.url, type, id));
      const raw = typeof value === "object" && value !== null ? (value as { meta?: unknown }).meta : undefined;
      const meta = raw === undefined ? null : parseMetaFull(raw);
      if (meta && !allowsParental(meta.certification)) throw new Error(BLOCKED);
      if (meta) return meta;
    } catch (error) {
      if (error instanceof Error && error.message === BLOCKED) throw error;
      /* next addon */
    }
  }
  throw new Error("No hay información para este título");
}

/** Streams from every addon that serves them, fetched concurrently, in addon order. */
export async function addonStreams(type: string, id: string): Promise<AddonStream[]> {
  const addons = (await loadedAddons()).filter((a) => supports(a, "stream", type, id));
  const lists = await Promise.all(
    addons.map(async (addon): Promise<AddonStream[]> => {
      try {
        const res = await fetchWithTimeout(streamPath(addon.info.url, type, id), { timeoutMs: STREAM_TIMEOUT_MS });
        if (!res.ok) return [];
        const value = (await res.json()) as { streams?: unknown };
        const raw = typeof value === "object" && value !== null && Array.isArray(value.streams) ? value.streams : [];
        return raw.map((s) => parseStream(addon.info, s)).filter((s): s is AddonStream => s !== null);
      } catch {
        return [];
      }
    }),
  );
  return lists.flat();
}

// ---- the source last played for each title ("your usual") ----

type Preferred = { addonUrl: string; bingeGroup: string | null };

export function preferredSource(metaId: string): Preferred | null {
  const all = store.get<Record<string, Preferred>>(KEYS.preferredSource) ?? {};
  return all[metaId] ?? null;
}

export function savePreferredSource(metaId: string, stream: AddonStream): void {
  if (!stream.bingeGroup) return;
  const all = { ...(store.get<Record<string, Preferred>>(KEYS.preferredSource) ?? {}) };
  delete all[metaId];
  all[metaId] = { addonUrl: stream.addonUrl, bingeGroup: stream.bingeGroup };
  // Keep the most recent 300 titles.
  store.set(KEYS.preferredSource, Object.fromEntries(Object.entries(all).slice(-300)));
}

// ---- local list of online titles ("My list" and watched marks) ----

const MAX_LIBRARY_ENTRIES = 500;

function loadLibrary(uid: string): LibraryEntry[] {
  const raw = store.get<unknown[]>(KEYS.addonLibrary(uid));
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is LibraryEntry => Boolean(e) && typeof (e as LibraryEntry).key === "string");
}

export async function addonLibraryList(): Promise<LibraryEntry[]> {
  // Local entries carry no rating: a profile that hides unrated titles hides them.
  if (currentRule()?.hideUnrated) return [];
  const uid = settingsUser();
  return uid ? loadLibrary(uid) : [];
}

/**
 * Port of `set_library_flags`: the entry keeps its other flag, goes to the front, and is
 * dropped once it is neither saved nor watched.
 */
export async function addonLibrarySet(args: {
  entry: Omit<LibraryEntry, "saved" | "watched" | "updatedMs">;
  saved?: boolean;
  watched?: boolean;
}): Promise<LibraryEntry[]> {
  const uid = settingsUser();
  if (!uid) throw new Error("No hay ningún perfil activo");
  if (!args.entry.key) throw new Error("La entrada no tiene identificador");
  const list = loadLibrary(uid);
  const previous = list.find((e) => e.key === args.entry.key);
  const entry: LibraryEntry = {
    ...args.entry,
    saved: args.saved ?? previous?.saved ?? false,
    watched: args.watched ?? previous?.watched ?? false,
    updatedMs: nowMs(),
  };
  const next = list.filter((e) => e.key !== entry.key);
  if (entry.saved || entry.watched) next.unshift(entry);
  const saved = next.slice(0, MAX_LIBRARY_ENTRIES);
  store.set(KEYS.addonLibrary(uid), saved);
  return saved;
}

// ---- local resume positions for online titles ----

function loadProgress(uid: string): ResumeEntry[] {
  const raw = store.get<unknown[]>(KEYS.addonProgress(uid));
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeResumeEntry).filter((e): e is ResumeEntry => e !== null);
}

/**
 * Addons installed in a Stremio account: login, `addonCollectionGet`, logout. The password
 * only goes to Stremio's API and is never stored. Errors are stable codes the UI translates.
 */
export async function stremioAddons(email: string, password: string): Promise<ImportedAddon[]> {
  if (!email.trim() || !password) throw new Error("stremio_auth");
  const API = "https://api.strem.io/api";
  const post = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    let response: Response;
    try {
      response = await fetchWithTimeout(`${API}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error("stremio_network");
    }
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      throw new Error("stremio_unexpected");
    }
  };
  const login = await post("login", { type: "Login", email: email.trim(), password, facebook: false });
  const result = login.result as { authKey?: unknown } | undefined;
  if (login.error || typeof result?.authKey !== "string") throw new Error("stremio_auth");
  const authKey = result.authKey;
  const collection = await post("addonCollectionGet", { type: "AddonCollectionGet", authKey, update: true });
  void post("logout", { type: "Logout", authKey }).catch(() => undefined);
  if (collection.error) throw new Error("stremio_unexpected");
  return parseStremioCollection(collection, normalizeManifestUrl);
}

export async function addonProgressList(): Promise<ResumeEntry[]> {
  if (currentRule()?.hideUnrated) return [];
  const uid = settingsUser();
  return uid ? loadProgress(uid) : [];
}

export async function addonProgressRemove(key: string): Promise<void> {
  const uid = settingsUser();
  if (!uid) return;
  store.set(
    KEYS.addonProgress(uid),
    loadProgress(uid).filter((e) => e.key !== key),
  );
}

/** Player engine hook: remembers the position of the online title being played. */
export function upsertProgress(
  entry: Omit<ResumeEntry, "positionSeconds" | "durationSeconds" | "updatedMs">,
  positionSeconds: number,
  durationSeconds: number,
): void {
  const uid = settingsUser();
  if (!uid) return;
  const full: ResumeEntry = { ...entry, positionSeconds, durationSeconds, updatedMs: nowMs() };
  store.set(KEYS.addonProgress(uid), upsertProgressList(loadProgress(uid), full));
}
