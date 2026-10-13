import { emptyMovie } from "./addons";
import type { Movie } from "./types";

/** Same extensions `local_media.rs` allows. The check there is the one that matters. */
const MEDIA_EXTS = new Set([
  "mkv",
  "mp4",
  "m4v",
  "mov",
  "avi",
  "webm",
  "ts",
  "m2ts",
  "mts",
  "mpg",
  "mpeg",
  "wmv",
  "flv",
  "ogv",
  "3gp",
  "vob",
  "mk3d",
  "mp3",
  "m4a",
  "flac",
  "wav",
  "aac",
  "opus",
  "ogg",
  "wma",
  "aiff",
  "alac",
]);

export function fileName(path: string): string {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  const name = cut >= 0 ? path.slice(cut + 1) : path;
  return name || path;
}

export function parentDir(path: string): string | undefined {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (cut <= 0) return undefined;
  return path.slice(0, cut);
}

/** Movie the overlay player can draw controls for. Playback starts from `path`. */
export function localMovie(path: string, title?: string): Movie {
  const file = fileName(path);
  const stem = file.replace(/\.[^.]+$/, "") || file;
  const name = title?.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180) || stem || "ejFlix";
  return { ...emptyMovie(`local:${path}`, "Movie", name), localFile: { path } };
}

export function isMediaPath(path: string): boolean {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return false;
  return MEDIA_EXTS.has(name.slice(dot + 1).toLowerCase());
}
