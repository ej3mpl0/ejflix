/**
 * Offline downloads of movies and episodes, per profile: Jellyfin files (the token goes in
 * a header, never in the URL or the store) and direct http(s) streams of addons (never
 * torrents). Transfers run through expo-file-system `DownloadTask` (pause / resume /
 * cancel), one at a time; the list lives in the store under `downloads.<profile>` and the
 * files under `<documents>/downloads/<profile>/`.
 */
import { AppState } from "react-native";
import { Directory, DownloadTask, File, Paths, type DownloadPauseState } from "expo-file-system";
import type { AddonStream, Movie } from "../../lib/types";
import { emit } from "../events";
import { KEYS, store } from "../store";
import { settingsUser } from "../settings";
import { registerSessionCleanup } from "../session";
import { registerProfileDeleteHook } from "../profiles";
import { currentRule } from "../parental";
import { jellyfin, authHeaders } from "../jellyfin/client";
import { mediaSourceContainer } from "../jellyfin/items";
import { ticksFromSeconds, validItemId } from "../util";
import {
  downloadAllowed,
  extensionFor,
  fileNameFor,
  isDownloadableStream,
  nextToStart,
  reduceDownloads,
  sanitizeDownloads,
  storageUsed,
  type DownloadAction,
  type DownloadEntry,
  type ResumeState,
} from "./downloads.pure";

export type { DownloadEntry, DownloadStatus } from "./downloads.pure";

/** One transfer at a time: a second one would only split the bandwidth. */
const MAX_ACTIVE = 1;
const PERSIST_EVERY_MS = 2000;
const EMIT_EVERY_MS = 400;

const lists = new Map<string, DownloadEntry[]>();
type Running = { owner: string; task: DownloadTask; cancelled: boolean; usedResume: boolean };
const running = new Map<string, Running>();
const lastPersist = new Map<string, number>();
let lastEmit = 0;
let emitTimer: ReturnType<typeof setTimeout> | null = null;

function owner(): string | null {
  return settingsUser();
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "default";
}

function dirFor(profile: string): Directory {
  const dir = new Directory(Paths.document, "downloads", safeSegment(profile));
  try {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  } catch {
    /* exists */
  }
  return dir;
}

function fileFor(profile: string, entry: Pick<DownloadEntry, "fileName">): File {
  return new File(dirFor(profile), entry.fileName);
}

function fileExists(file: File): boolean {
  try {
    return file.exists;
  } catch {
    return false;
  }
}

function deleteFile(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    /* already gone */
  }
}

function listFor(profile: string): DownloadEntry[] {
  const cached = lists.get(profile);
  if (cached) return cached;
  let list = reduceDownloads(sanitizeDownloads(store.get<unknown>(KEYS.downloads(profile))), { type: "restore" });
  // A finished file deleted behind the app's back is no longer a download.
  list = list.filter((entry) => entry.status !== "done" || fileExists(fileFor(profile, entry)));
  lists.set(profile, list);
  store.set(KEYS.downloads(profile), list);
  return list;
}

function notify(immediate: boolean): void {
  const now = Date.now();
  if (immediate || now - lastEmit >= EMIT_EVERY_MS) {
    if (emitTimer) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
    lastEmit = now;
    emit("downloads://changed");
    return;
  }
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    lastEmit = Date.now();
    emit("downloads://changed");
  }, EMIT_EVERY_MS);
}

function dispatch(profile: string, action: DownloadAction): void {
  const next = reduceDownloads(listFor(profile), action);
  lists.set(profile, next);
  // Progress ticks are many: the store is written at most every two seconds for them.
  const chatty = action.type === "progress";
  const now = Date.now();
  if (!chatty || now - (lastPersist.get(profile) ?? 0) >= PERSIST_EVERY_MS) {
    lastPersist.set(profile, now);
    store.set(KEYS.downloads(profile), next);
  }
  if (profile === owner()) notify(!chatty);
}

function find(profile: string, id: string): DownloadEntry | null {
  return listFor(profile).find((entry) => entry.id === id) ?? null;
}

/** Headers for one request: the addon's own ones, or the Jellyfin auth of the live session. */
function requestHeaders(entry: DownloadEntry): Record<string, string> {
  if (entry.source === "addon") return { ...entry.headers };
  const session = jellyfin.session;
  if (!session) throw new Error("No hay sesión de Jellyfin");
  return authHeaders(session.deviceId, session.token);
}

function stripHeaders(state: DownloadPauseState): ResumeState {
  return { url: state.url, fileUri: state.fileUri, isDirectory: state.isDirectory, resumeData: state.resumeData };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pump(profile: string): void {
  // Another profile's queue waits until that profile is active again.
  if (profile !== owner()) return;
  for (const id of nextToStart(listFor(profile), MAX_ACTIVE)) run(profile, id);
}

function run(profile: string, id: string): void {
  const entry = find(profile, id);
  if (!entry || running.has(id)) return;
  let headers: Record<string, string>;
  try {
    headers = requestHeaders(entry);
  } catch (error) {
    dispatch(profile, { type: "status", id, status: "error", error: errorText(error), now: Date.now() });
    return;
  }
  const file = fileFor(profile, entry);
  const onProgress = ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
    dispatch(profile, { type: "progress", id, bytesWritten, totalBytes, now: Date.now() });
  };
  let task: DownloadTask;
  let usedResume = false;
  try {
    if (entry.resume) {
      task = DownloadTask.fromSavable({ ...entry.resume, headers }, { onProgress });
      usedResume = true;
    } else {
      deleteFile(file);
      task = File.createDownloadTask(entry.url, file, { headers, onProgress });
    }
  } catch (error) {
    dispatch(profile, { type: "status", id, status: "error", error: errorText(error), now: Date.now() });
    return;
  }
  const slot: Running = { owner: profile, task, cancelled: false, usedResume };
  running.set(id, slot);
  dispatch(profile, { type: "status", id, status: "downloading", now: Date.now() });

  /** Removed meanwhile: a late write must not leave the file behind (unless it was added again). */
  const dropLeftover = () => {
    if (!running.has(id) && !lists.get(profile)?.some((entry) => entry.id === id)) deleteFile(file);
  };
  const transfer = usedResume ? task.resumeAsync() : task.downloadAsync();
  transfer
    .then((result) => {
      if (slot.cancelled) {
        dropLeftover();
        return;
      }
      if (result == null) {
        // Paused: keep what the native side needs to continue later (not the headers).
        let resume: ResumeState | null = null;
        try {
          resume = stripHeaders(task.savable());
        } catch {
          /* cannot resume: it will start over */
        }
        dispatch(profile, { type: "resumeState", id, resume });
        dispatch(profile, { type: "status", id, status: "paused", now: Date.now() });
        return;
      }
      let size = 0;
      try {
        size = result.size ?? 0;
      } catch {
        /* unknown */
      }
      if (size > 0) dispatch(profile, { type: "progress", id, bytesWritten: size, totalBytes: size, now: Date.now() });
      dispatch(profile, { type: "status", id, status: "done", now: Date.now() });
    })
    .catch((error) => {
      if (slot.cancelled) {
        dropLeftover();
        return;
      }
      if (slot.usedResume) {
        // Stale resume data (server restarted, file moved): start over once from zero.
        dispatch(profile, { type: "resumeState", id, resume: null });
        dispatch(profile, { type: "progress", id, bytesWritten: 0, totalBytes: -1, now: Date.now() });
        dispatch(profile, { type: "status", id, status: "queued", now: Date.now() });
        return;
      }
      dispatch(profile, { type: "resumeState", id, resume: null });
      dispatch(profile, { type: "status", id, status: "error", error: errorText(error), now: Date.now() });
    })
    .finally(() => {
      if (running.get(id) === slot) running.delete(id);
      try {
        task.release();
      } catch {
        /* already released */
      }
      pump(profile);
    });
}

// ---- Public API ----

/** Starts what is queued for the active profile and reports offline positions. */
export function downloadsKick(): void {
  const profile = owner();
  if (!profile) return;
  pump(profile);
  void downloadsSyncPending();
}

/** Downloads of the active profile. */
export function downloadsList(): DownloadEntry[] {
  const profile = owner();
  return profile ? listFor(profile) : [];
}

export function downloadGet(id: string): DownloadEntry | null {
  const profile = owner();
  return profile ? find(profile, id) : null;
}

/** Local file URI of a finished download, or null. */
export function downloadFileUri(id: string): string | null {
  const profile = owner();
  if (!profile) return null;
  const entry = find(profile, id);
  if (!entry || entry.status !== "done") return null;
  const file = fileFor(profile, entry);
  return fileExists(file) ? file.uri : null;
}

/**
 * Finished download that can stand in for `movie` in the player: same item, and the same
 * version when the item asks for a specific one.
 */
export function playableDownload(movie: Pick<Movie, "id" | "mediaSourceId">): DownloadEntry | null {
  const entry = downloadGet(movie.id);
  if (!entry || entry.status !== "done") return null;
  if (movie.mediaSourceId && entry.mediaSourceId && movie.mediaSourceId !== entry.mediaSourceId) return null;
  return downloadFileUri(entry.id) ? entry : null;
}

/** Whether the open profile's parental rule lets this download play (checked on every play). */
export function downloadPlayable(entry: Pick<DownloadEntry, "rating">): boolean {
  return downloadAllowed(entry, currentRule());
}

function newEntry(
  movie: Movie,
  fields: Pick<DownloadEntry, "source" | "url" | "headers" | "fileName" | "mediaSourceId" | "rating">,
): DownloadEntry {
  const now = Date.now();
  // The snapshot drops what only makes sense online (the chosen stream is kept for addons).
  const snapshot: Movie = { ...movie, trickplay: null, cast: [] };
  return {
    id: movie.id,
    ...fields,
    movie: snapshot,
    status: "queued",
    bytesWritten: 0,
    totalBytes: -1,
    error: null,
    createdMs: now,
    updatedMs: now,
    resume: null,
    positionSeconds: movie.playbackPositionTicks > 0 ? movie.playbackPositionTicks / 10_000_000 : 0,
    durationSeconds: movie.runtimeTicks ? movie.runtimeTicks / 10_000_000 : 0,
    pendingSync: false,
  };
}

/** Queues the original file of a Jellyfin movie or episode (`/Items/{id}/Download`). */
export async function downloadJellyfin(movie: Movie): Promise<DownloadEntry> {
  const profile = owner();
  if (!profile) throw new Error("No hay sesión activa");
  const session = jellyfin.require();
  if (!validItemId(movie.id)) throw new Error("Ítem no válido");
  const existing = find(profile, movie.id);
  if (existing && existing.status !== "error") return existing;
  const mediaSourceId = movie.mediaSourceId ?? movie.mediaSources[0]?.id ?? null;
  let container: string | null = null;
  try {
    const raw = await jellyfin.get<unknown>(`/Users/${session.userId}/Items/${movie.id}`, { Fields: "MediaSources" });
    container = mediaSourceContainer(raw, mediaSourceId);
  } catch {
    /* the URL decides the extension */
  }
  // An episode without a rating is judged by its series' one, as online.
  let rating = movie.officialRating;
  if (!rating && movie.seriesId && validItemId(movie.seriesId)) {
    try {
      const series = await jellyfin.get<{ OfficialRating?: unknown }>(`/Users/${session.userId}/Items/${movie.seriesId}`);
      if (typeof series?.OfficialRating === "string" && series.OfficialRating.trim()) rating = series.OfficialRating;
    } catch {
      /* judged as unrated */
    }
  }
  const query = mediaSourceId ? `?mediaSourceId=${encodeURIComponent(mediaSourceId)}` : "";
  const url = `${session.serverUrl}/Items/${movie.id}/Download${query}`;
  const entry = newEntry(movie, {
    source: "jellyfin",
    url,
    headers: {},
    fileName: fileNameFor(movie.id, extensionFor(url, container)),
    mediaSourceId,
    rating: rating ?? null,
  });
  dispatch(profile, { type: "add", entry });
  pump(profile);
  return entry;
}

/** Queues a direct http(s) stream of an online title. */
export function downloadAddon(movie: Movie, stream: AddonStream): DownloadEntry {
  const profile = owner();
  if (!profile) throw new Error("No hay sesión activa");
  if (!movie.external) throw new Error("No es un título online");
  if (!isDownloadableStream(stream) || !stream.url) throw new Error("Esta fuente no se puede descargar");
  const existing = find(profile, movie.id);
  if (existing && existing.status !== "error") return existing;
  const headers: Record<string, string> = {};
  for (const [key, value] of stream.headers ?? []) {
    if (!key || key.toLowerCase() === "x-emby-token" || /[\r\n]/.test(value)) continue;
    headers[key] = value;
  }
  const withStream: Movie = { ...movie, external: { ...movie.external, stream } };
  const entry = newEntry(withStream, {
    source: "addon",
    url: stream.url,
    headers,
    fileName: fileNameFor(movie.id, extensionFor(stream.filename ? `x/${stream.filename}` : stream.url, null)),
    mediaSourceId: null,
    rating: movie.officialRating ?? null,
  });
  dispatch(profile, { type: "add", entry });
  pump(profile);
  return entry;
}

export function downloadPause(id: string): void {
  const slot = running.get(id);
  if (slot) {
    // The transfer promise resolves with null once paused; `run` stores the resume data.
    try {
      slot.task.pause();
    } catch {
      /* already stopped */
    }
    return;
  }
  const profile = owner();
  if (profile && find(profile, id)?.status === "queued") {
    dispatch(profile, { type: "status", id, status: "paused", now: Date.now() });
  }
}

/** Paused or failed → back in the queue. */
export function downloadResume(id: string): void {
  const profile = owner();
  if (!profile) return;
  const entry = find(profile, id);
  if (!entry || entry.status === "done" || entry.status === "downloading") return;
  if (entry.status === "error") {
    dispatch(profile, { type: "resumeState", id, resume: null });
    dispatch(profile, { type: "progress", id, bytesWritten: 0, totalBytes: -1, now: Date.now() });
  }
  dispatch(profile, { type: "status", id, status: "queued", now: Date.now() });
  pump(profile);
}

/** Cancels a transfer or deletes a finished file, and forgets the entry. */
export function downloadRemove(id: string): void {
  const profile = owner();
  if (!profile) return;
  const slot = running.get(id);
  if (slot) {
    slot.cancelled = true;
    running.delete(id);
    try {
      slot.task.cancel();
    } catch {
      /* already stopped */
    }
  }
  const entry = find(profile, id);
  if (entry) deleteFile(fileFor(profile, entry));
  dispatch(profile, { type: "remove", id });
  pump(profile);
}

/** Bytes used by this profile's downloads and bytes still free on the device. */
export function downloadsStorage(): { used: number; free: number } {
  let free = 0;
  try {
    free = Paths.availableDiskSpace;
  } catch {
    /* unknown */
  }
  return { used: storageUsed(downloadsList()), free };
}

/** Position watched on a downloaded file (Jellyfin ones are reported when online). */
export function downloadRecordPosition(id: string, positionSeconds: number, durationSeconds: number): void {
  const profile = owner();
  if (!profile) return;
  const entry = find(profile, id);
  if (!entry || !Number.isFinite(positionSeconds)) return;
  dispatch(profile, {
    type: "position",
    id,
    positionSeconds,
    durationSeconds,
    pending: entry.source === "jellyfin",
    now: Date.now(),
  });
}

let syncing = false;

/**
 * Reports offline positions of Jellyfin downloads (`/Sessions/Playing/Stopped` updates the
 * user data, and marks the item played past the server's threshold). Best effort: what
 * fails stays pending for the next try.
 */
export async function downloadsSyncPending(): Promise<void> {
  const profile = owner();
  const session = jellyfin.session;
  if (!profile || !session || syncing) return;
  syncing = true;
  try {
    for (const entry of listFor(profile).filter((e) => e.pendingSync && e.source === "jellyfin")) {
      try {
        await jellyfin.post("/Sessions/Playing/Stopped", {
          ItemId: entry.id,
          MediaSourceId: entry.mediaSourceId,
          PositionTicks: Math.max(0, Math.round(ticksFromSeconds(entry.positionSeconds))),
        });
        dispatch(profile, { type: "synced", id: entry.id });
      } catch {
        // Offline (or the server said no): stop here and try again later.
        break;
      }
    }
  } finally {
    syncing = false;
  }
}

// Leaving the profile pauses its transfers (they keep their resume data for later).
try {
  registerSessionCleanup(() => {
    for (const slot of Array.from(running.values())) {
      try {
        slot.task.pause();
      } catch {
        /* already stopped */
      }
    }
  });
} catch (error) {
  console.warn("[downloads] could not register the session cleanup", error);
}

// A deleted profile takes its downloads (files included) with it.
try {
  registerProfileDeleteHook((profileId) => {
    for (const [id, slot] of Array.from(running.entries())) {
      if (slot.owner !== profileId) continue;
      slot.cancelled = true;
      running.delete(id);
      try {
        slot.task.cancel();
      } catch {
        /* already stopped */
      }
    }
    try {
      const dir = new Directory(Paths.document, "downloads", safeSegment(profileId));
      if (dir.exists) dir.delete();
    } catch (error) {
      console.warn("[downloads] could not delete the profile's files", error);
    }
    lists.delete(profileId);
    lastPersist.delete(profileId);
    store.remove(KEYS.downloads(profileId));
  });
} catch (error) {
  console.warn("[downloads] could not register the profile cleanup", error);
}

// Back in the foreground is the natural moment to catch up with the server.
try {
  AppState.addEventListener("change", (next) => {
    if (next === "active") void downloadsSyncPending();
  });
} catch {
  /* no AppState in tests */
}
