import { describe, expect, it } from "vitest";
import {
  canDownload,
  downloadAllowed,
  extensionFor,
  fileNameFor,
  isDownloadableStream,
  nextToStart,
  offlineStartSeconds,
  progressOf,
  reduceDownloads,
  sanitizeDownloads,
  sortForDisplay,
  storageUsed,
  type DownloadEntry,
} from "../downloads/downloads.pure";
import type { Movie } from "../../lib/types";

const movie = { id: "abcdef123456", kind: "Movie", name: "Dune" } as unknown as Movie;

function entry(id: string, patch: Partial<DownloadEntry> = {}): DownloadEntry {
  return {
    id,
    source: "jellyfin",
    movie: { ...movie, id },
    url: `https://jf.local/Items/${id}/Download`,
    headers: {},
    fileName: `${id}.mkv`,
    mediaSourceId: null,
    status: "queued",
    bytesWritten: 0,
    totalBytes: -1,
    error: null,
    createdMs: 1,
    updatedMs: 1,
    resume: null,
    positionSeconds: 0,
    durationSeconds: 0,
    pendingSync: false,
    rating: null,
    ...patch,
  };
}

describe("reduceDownloads", () => {
  it("adds new entries on top and replaces an existing one", () => {
    let list = reduceDownloads([], { type: "add", entry: entry("a") });
    list = reduceDownloads(list, { type: "add", entry: entry("b") });
    expect(list.map((e) => e.id)).toEqual(["b", "a"]);
    list = reduceDownloads(list, { type: "add", entry: entry("a", { status: "paused" }) });
    expect(list.map((e) => e.id)).toEqual(["a", "b"]);
    expect(list[0].status).toBe("paused");
  });

  it("tracks progress and keeps a known total when the server stops sending it", () => {
    let list = [entry("a", { status: "downloading" })];
    list = reduceDownloads(list, { type: "progress", id: "a", bytesWritten: 50, totalBytes: 200, now: 5 });
    expect(list[0]).toMatchObject({ bytesWritten: 50, totalBytes: 200, updatedMs: 5 });
    list = reduceDownloads(list, { type: "progress", id: "a", bytesWritten: 80, totalBytes: -1, now: 6 });
    expect(list[0]).toMatchObject({ bytesWritten: 80, totalBytes: 200 });
  });

  it("finishing drops the resume data and errors keep their message", () => {
    const resume = { url: "u", fileUri: "file:///x", isDirectory: false, resumeData: "r" };
    let list = [entry("a", { status: "downloading", resume, bytesWritten: 300 })];
    list = reduceDownloads(list, { type: "status", id: "a", status: "done", now: 9 });
    expect(list[0]).toMatchObject({ status: "done", resume: null, totalBytes: 300, error: null });
    list = reduceDownloads(list, { type: "status", id: "a", status: "error", error: "HTTP 403", now: 10 });
    expect(list[0].error).toBe("HTTP 403");
    list = reduceDownloads(list, { type: "status", id: "a", status: "queued", now: 11 });
    expect(list[0].error).toBeNull();
  });

  it("marks Jellyfin positions pending until synced", () => {
    let list = [entry("a", { status: "done" })];
    list = reduceDownloads(list, { type: "position", id: "a", positionSeconds: 120, durationSeconds: 3600, pending: true, now: 2 });
    expect(list[0]).toMatchObject({ positionSeconds: 120, durationSeconds: 3600, pendingSync: true });
    list = reduceDownloads(list, { type: "position", id: "a", positionSeconds: 130, durationSeconds: 0, pending: false, now: 3 });
    expect(list[0]).toMatchObject({ positionSeconds: 130, durationSeconds: 3600, pendingSync: true });
    list = reduceDownloads(list, { type: "synced", id: "a" });
    expect(list[0].pendingSync).toBe(false);
  });

  it("restore pauses what was transferring when the app was closed", () => {
    const list = reduceDownloads([entry("a", { status: "downloading" }), entry("b", { status: "done" })], { type: "restore" });
    expect(list.map((e) => e.status)).toEqual(["paused", "done"]);
  });

  it("ignores unknown ids and removes known ones", () => {
    const list = [entry("a")];
    expect(reduceDownloads(list, { type: "synced", id: "zz" })).toBe(list);
    expect(reduceDownloads(list, { type: "remove", id: "a" })).toEqual([]);
  });
});

describe("queue and totals", () => {
  it("starts the oldest queued entries within the limit", () => {
    const list = [entry("new", { createdMs: 5 }), entry("old", { createdMs: 1 }), entry("done", { status: "done" })];
    expect(nextToStart(list, 1)).toEqual(["old"]);
    expect(nextToStart([...list, entry("run", { status: "downloading" })], 1)).toEqual([]);
    expect(nextToStart(list, 2)).toEqual(["old", "new"]);
  });

  it("computes progress and storage", () => {
    expect(progressOf({ status: "downloading", bytesWritten: 25, totalBytes: 100 })).toBe(0.25);
    expect(progressOf({ status: "downloading", bytesWritten: 25, totalBytes: -1 })).toBeNull();
    expect(progressOf({ status: "done", bytesWritten: 0, totalBytes: -1 })).toBe(1);
    expect(storageUsed([entry("a", { bytesWritten: 10 }), entry("b", { bytesWritten: 32 })])).toBe(42);
  });

  it("sorts active transfers first, then newest", () => {
    const list = [
      entry("done", { status: "done", createdMs: 9 }),
      entry("paused", { status: "paused", createdMs: 3 }),
      entry("active", { status: "downloading", createdMs: 1 }),
    ];
    expect(sortForDisplay(list).map((e) => e.id)).toEqual(["active", "paused", "done"]);
  });
});

describe("sanitizeDownloads", () => {
  it("drops broken rows and duplicates and defaults fields", () => {
    const out = sanitizeDownloads([
      { id: "a", url: "https://x/a.mp4", fileName: "a.mp4", movie, status: "weird" },
      { id: "a", url: "https://x/a.mp4", fileName: "a.mp4", movie },
      { id: "b", url: "https://x/b.mp4" },
      null,
      "nope",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a", status: "paused", source: "jellyfin", totalBytes: -1, pendingSync: false, resume: null });
    expect(sanitizeDownloads("nope")).toEqual([]);
  });
});

describe("files and sources", () => {
  it("picks an extension from the container, then the URL", () => {
    expect(extensionFor("https://jf/Items/1/Download", "mkv")).toBe("mkv");
    expect(extensionFor("https://jf/Items/1/Download", "mov,mp4,m4a")).toBe("mov");
    expect(extensionFor("https://cdn/x/movie.MP4?token=1", null)).toBe("mp4");
    expect(extensionFor("https://cdn/x/stream", null)).toBe("mp4");
  });

  it("builds safe file names", () => {
    expect(fileNameFor("addon:tt123:1:2", "mkv")).toBe("addon_tt123_1_2.mkv");
  });

  it("only direct http(s) links are downloadable", () => {
    expect(isDownloadableStream({ url: "https://cdn/x.mp4", infoHash: null })).toBe(true);
    expect(isDownloadableStream({ url: null, infoHash: "abc" })).toBe(false);
    expect(isDownloadableStream({ url: "magnet:?xt=1", infoHash: null })).toBe(false);
  });

  it("downloads movies and episodes only", () => {
    expect(canDownload({ kind: "Movie", live: null, external: null })).toBe(true);
    expect(canDownload({ kind: "Series", live: null, external: null })).toBe(false);
    expect(canDownload({ kind: "LiveTv", live: {} as never, external: null })).toBe(false);
    expect(canDownload({ kind: "Series", external: { type: "series" } as never })).toBe(false);
    expect(canDownload({ kind: "Episode", external: { type: "series" } as never })).toBe(true);
  });

  it("resumes offline playback from the newest position", () => {
    expect(offlineStartSeconds({ positionSeconds: 600, durationSeconds: 3600 }, 100)).toBe(600);
    expect(offlineStartSeconds({ positionSeconds: 0, durationSeconds: 3600 }, 100)).toBe(100);
    expect(offlineStartSeconds({ positionSeconds: 3500, durationSeconds: 3600 }, 0)).toBe(0);
    expect(offlineStartSeconds({ positionSeconds: 3, durationSeconds: 0 }, 0)).toBe(0);
  });
});

describe("downloadAllowed", () => {
  it("judges the stored rating with the profile's current rule", () => {
    const kids = { maxAge: 7, hideUnrated: false };
    expect(downloadAllowed({ rating: "R" }, null)).toBe(true);
    expect(downloadAllowed({ rating: "R" }, kids)).toBe(false);
    expect(downloadAllowed({ rating: "TV-Y7" }, kids)).toBe(true);
    expect(downloadAllowed({ rating: null }, kids)).toBe(true);
    expect(downloadAllowed({ rating: null }, { maxAge: 7, hideUnrated: true })).toBe(false);
  });

  it("falls back to the snapshot's rating for entries stored before it existed", () => {
    const [old] = sanitizeDownloads([{ id: "a", url: "https://x/a.mp4", fileName: "a.mp4", movie: { ...movie, officialRating: "PG-13" } }]);
    expect(old.rating).toBe("PG-13");
    const [kept] = sanitizeDownloads([{ id: "b", url: "https://x/b.mp4", fileName: "b.mp4", movie, rating: "TV-MA" }]);
    expect(kept.rating).toBe("TV-MA");
  });
});
