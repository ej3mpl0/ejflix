/**
 * Offline downloads: the persisted list and its state machine. Pure (vitest-friendly);
 * `downloads.ts` owns the native transfer tasks, the files and the store.
 */
import type { AddonStream, Movie } from "../../lib/types";

export type DownloadStatus = "queued" | "downloading" | "paused" | "done" | "error";
export type DownloadSource = "jellyfin" | "addon";

/** What `DownloadTask.savable()` returns, minus the headers (they may hold a token). */
export type ResumeState = {
  url: string;
  fileUri: string;
  isDirectory: boolean;
  resumeData?: string;
};

export type DownloadEntry = {
  /** Id of the item (`movie.id`); one download per item and profile. */
  id: string;
  source: DownloadSource;
  /** Snapshot of the item for the list and for playing it offline. */
  movie: Movie;
  url: string;
  /** Extra request headers of an addon stream. The Jellyfin token is added per request, never stored. */
  headers: Record<string, string>;
  fileName: string;
  mediaSourceId: string | null;
  status: DownloadStatus;
  bytesWritten: number;
  /** -1 while unknown (no Content-Length). */
  totalBytes: number;
  error: string | null;
  createdMs: number;
  updatedMs: number;
  resume: ResumeState | null;
  /** Local playback position of the file. */
  positionSeconds: number;
  durationSeconds: number;
  /** Jellyfin: a position watched offline that the server has not heard about yet. */
  pendingSync: boolean;
};

export type DownloadAction =
  | { type: "add"; entry: DownloadEntry }
  | { type: "progress"; id: string; bytesWritten: number; totalBytes: number; now: number }
  | { type: "status"; id: string; status: DownloadStatus; error?: string | null; now: number }
  | { type: "resumeState"; id: string; resume: ResumeState | null }
  | { type: "position"; id: string; positionSeconds: number; durationSeconds: number; pending: boolean; now: number }
  | { type: "synced"; id: string }
  | { type: "remove"; id: string }
  | { type: "restore" };

function patch(list: DownloadEntry[], id: string, change: (entry: DownloadEntry) => DownloadEntry): DownloadEntry[] {
  let hit = false;
  const out = list.map((entry) => {
    if (entry.id !== id) return entry;
    hit = true;
    return change(entry);
  });
  return hit ? out : list;
}

/** The single place the list changes. Unknown ids leave it untouched. */
export function reduceDownloads(list: DownloadEntry[], action: DownloadAction): DownloadEntry[] {
  switch (action.type) {
    case "add": {
      // Adding an item again replaces its old (failed or finished) entry.
      const rest = list.filter((entry) => entry.id !== action.entry.id);
      return [action.entry, ...rest];
    }
    case "progress":
      return patch(list, action.id, (entry) => ({
        ...entry,
        bytesWritten: Math.max(0, action.bytesWritten),
        totalBytes: action.totalBytes > 0 ? action.totalBytes : entry.totalBytes,
        updatedMs: action.now,
      }));
    case "status":
      return patch(list, action.id, (entry) => {
        const done = action.status === "done";
        return {
          ...entry,
          status: action.status,
          error: action.status === "error" ? (action.error ?? entry.error ?? "") : null,
          // A finished file needs no resume data, and its size is what was written.
          resume: done ? null : entry.resume,
          totalBytes: done && entry.bytesWritten > 0 ? Math.max(entry.totalBytes, entry.bytesWritten) : entry.totalBytes,
          updatedMs: action.now,
        };
      });
    case "resumeState":
      return patch(list, action.id, (entry) => ({ ...entry, resume: action.resume }));
    case "position":
      return patch(list, action.id, (entry) => ({
        ...entry,
        positionSeconds: Math.max(0, action.positionSeconds),
        durationSeconds: action.durationSeconds > 0 ? action.durationSeconds : entry.durationSeconds,
        pendingSync: entry.pendingSync || action.pending,
        updatedMs: action.now,
      }));
    case "synced":
      return patch(list, action.id, (entry) => ({ ...entry, pendingSync: false }));
    case "remove":
      return list.filter((entry) => entry.id !== action.id);
    case "restore":
      // After a restart no native task is running: what was transferring waits for the user.
      return list.map((entry) => (entry.status === "downloading" ? { ...entry, status: "paused" } : entry));
  }
}

/** Queued entries that may start now, oldest first, keeping at most `maxActive` running. */
export function nextToStart(list: DownloadEntry[], maxActive: number): string[] {
  const active = list.filter((entry) => entry.status === "downloading").length;
  const room = Math.max(0, maxActive - active);
  if (room === 0) return [];
  return list
    .filter((entry) => entry.status === "queued")
    .sort((a, b) => a.createdMs - b.createdMs)
    .slice(0, room)
    .map((entry) => entry.id);
}

/** 0..1, or null while the total size is unknown. */
export function progressOf(entry: Pick<DownloadEntry, "status" | "bytesWritten" | "totalBytes">): number | null {
  if (entry.status === "done") return 1;
  if (entry.totalBytes <= 0) return null;
  return Math.min(1, Math.max(0, entry.bytesWritten / entry.totalBytes));
}

/** Bytes on disk for the whole list (partial files count too). */
export function storageUsed(list: DownloadEntry[]): number {
  return list.reduce((sum, entry) => sum + Math.max(0, entry.bytesWritten), 0);
}

/** Store shape → valid list (bad rows dropped, fields defaulted). */
export function sanitizeDownloads(value: unknown): DownloadEntry[] {
  if (!Array.isArray(value)) return [];
  const out: DownloadEntry[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Partial<DownloadEntry>;
    if (typeof e.id !== "string" || !e.id || seen.has(e.id)) continue;
    if (typeof e.url !== "string" || typeof e.fileName !== "string" || !e.movie || typeof e.movie !== "object") continue;
    const status: DownloadStatus =
      e.status === "queued" || e.status === "downloading" || e.status === "paused" || e.status === "done" || e.status === "error"
        ? e.status
        : "paused";
    const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
    seen.add(e.id);
    out.push({
      id: e.id,
      source: e.source === "addon" ? "addon" : "jellyfin",
      movie: e.movie,
      url: e.url,
      headers: e.headers && typeof e.headers === "object" ? e.headers : {},
      fileName: e.fileName,
      mediaSourceId: typeof e.mediaSourceId === "string" ? e.mediaSourceId : null,
      status,
      bytesWritten: num(e.bytesWritten, 0),
      totalBytes: num(e.totalBytes, -1),
      error: typeof e.error === "string" ? e.error : null,
      createdMs: num(e.createdMs, 0),
      updatedMs: num(e.updatedMs, 0),
      resume: e.resume && typeof e.resume === "object" && typeof e.resume.fileUri === "string" ? e.resume : null,
      positionSeconds: num(e.positionSeconds, 0),
      durationSeconds: num(e.durationSeconds, 0),
      pendingSync: e.pendingSync === true,
    });
  }
  return out;
}

const VIDEO_EXTENSIONS = ["mp4", "m4v", "mkv", "webm", "mov", "avi", "ts", "wmv", "flv"];

/** File extension for the saved file: the container when known, else the URL's, else mp4. */
export function extensionFor(url: string, container: string | null): string {
  const fromContainer = (container ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  if (VIDEO_EXTENSIONS.includes(fromContainer)) return fromContainer;
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split(/[?#]/)[0] ?? url;
  }
  const match = /\.([a-z0-9]{2,4})$/i.exec(path);
  const ext = match ? match[1].toLowerCase() : "";
  return VIDEO_EXTENSIONS.includes(ext) ? ext : "mp4";
}

/** File name safe on every file system (item ids may carry ":" for online titles). */
export function fileNameFor(id: string, ext: string): string {
  const base = id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96) || "video";
  return `${base}.${ext}`;
}

/**
 * Where offline playback resumes: the file's own position when it is newer than what the
 * item says (the item snapshot may be old), else the item's.
 */
export function offlineStartSeconds(entry: Pick<DownloadEntry, "positionSeconds" | "durationSeconds">, itemSeconds: number): number {
  const local = entry.positionSeconds;
  const start = local > 0 ? local : itemSeconds;
  // A finished file starts over instead of landing on the credits.
  if (entry.durationSeconds > 0 && start >= entry.durationSeconds * 0.95) return 0;
  return start > 5 ? start : 0;
}

/** Newest first, active transfers on top. */
export function sortForDisplay(list: DownloadEntry[]): DownloadEntry[] {
  const rank = (entry: DownloadEntry) => (entry.status === "downloading" ? 0 : entry.status === "queued" ? 1 : entry.status === "paused" || entry.status === "error" ? 2 : 3);
  return [...list].sort((a, b) => rank(a) - rank(b) || b.createdMs - a.createdMs);
}

/** Whether an addon stream can be saved: a plain http(s) link, not a torrent. */
export function isDownloadableStream(stream: Pick<AddonStream, "url" | "infoHash">): boolean {
  return Boolean(stream.url && /^https?:\/\//i.test(stream.url) && !stream.infoHash);
}

/** Items that can be downloaded: single movies and episodes (not series, seasons or channels). */
export function canDownload(movie: Pick<Movie, "kind" | "live" | "external">): boolean {
  if (movie.live) return false;
  if (movie.external) return movie.kind === "Episode" || movie.external.type === "movie";
  return movie.kind === "Movie" || movie.kind === "Episode" || movie.kind === "Video";
}
