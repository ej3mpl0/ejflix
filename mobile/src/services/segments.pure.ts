/**
 * Intro / recap / credits ranges: parsing, merging and sanitizing, ported from
 * `segments.rs`. Pure module (vitest-friendly).
 */
import type { MediaSegment, MediaSegmentKind } from "../lib/types";

export const INTRODB_URL = "https://api.introdb.app/segments";
/** IntroDB entries below this confidence are ignored. */
export const INTRODB_MIN_CONFIDENCE = 0.3;
export const INTRODB_BACKOFF_MS = 5 * 60 * 1000;
export const INTRODB_TIMEOUT_MS = 5_000;
export const MIN_SEGMENT_SECONDS = 2;
export const MAX_SEGMENTS = 32;
export const MAX_CACHED_ITEMS = 512;

export function mapJellyfinKind(kind: string): MediaSegmentKind | null {
  switch (kind) {
    case "Intro":
      return "intro";
    case "Outro":
      return "outro";
    case "Recap":
      return "recap";
    case "Preview":
      return "preview";
    case "Commercial":
      return "commercial";
    default:
      return null;
  }
}

/** Raw tuple from `GET /MediaSegments/{id}`: `[Type, startSeconds, endSeconds]`. */
export type RawJellyfinSegment = [kind: string, start: number, end: number];

/** Parses the `Items` of a MediaSegments answer into raw tuples. */
export function parseJellyfinSegments(value: unknown): RawJellyfinSegment[] {
  const items = value != null && typeof value === "object" ? (value as Record<string, unknown>).Items : null;
  if (!Array.isArray(items)) return [];
  const out: RawJellyfinSegment[] = [];
  for (const raw of items) {
    if (raw == null || typeof raw !== "object") continue;
    const seg = raw as Record<string, unknown>;
    if (typeof seg.Type !== "string" || typeof seg.StartTicks !== "number" || typeof seg.EndTicks !== "number") continue;
    out.push([seg.Type, seg.StartTicks / 10_000_000, seg.EndTicks / 10_000_000]);
  }
  return out;
}

export function fromJellyfinSegments(raw: RawJellyfinSegment[]): MediaSegment[] {
  const out: MediaSegment[] = [];
  for (const [type, start, end] of raw) {
    const kind = mapJellyfinKind(type);
    if (!kind) continue;
    out.push({ kind, startSeconds: start, endSeconds: end, source: "jellyfin" });
  }
  return out;
}

/** Intro Skipper plugin answer (`/Episode/{id}/IntroTimestamps/v1`): `[start, end]` or null. */
export function parseIntroSkipper(value: unknown): [number, number] | null {
  if (value == null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.Valid !== true) return null;
  if (typeof v.IntroStart !== "number" || typeof v.IntroEnd !== "number") return null;
  return [v.IntroStart, v.IntroEnd];
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** IntroDB answer: `{ intro?, recap?, outro? }` with `start_ms|start_sec`, `end_ms|end_sec`, `confidence`. */
export function parseIntroDb(value: unknown): MediaSegment[] {
  if (value == null || typeof value !== "object") return [];
  const body = value as Record<string, unknown>;
  const out: MediaSegment[] = [];
  for (const kind of ["intro", "recap", "outro"] as const) {
    const raw = body[kind];
    if (raw == null || typeof raw !== "object") continue;
    const seg = raw as Record<string, unknown>;
    const confidence = numberOf(seg.confidence) ?? 1;
    if (confidence < INTRODB_MIN_CONFIDENCE) continue;
    const startMs = numberOf(seg.start_ms);
    const start = startMs != null ? startMs / 1000 : numberOf(seg.start_sec);
    const endMs = numberOf(seg.end_ms);
    const end = endMs != null ? endMs / 1000 : numberOf(seg.end_sec);
    if (start == null || end == null) continue;
    out.push({ kind, startSeconds: start, endSeconds: end, source: "introdb" });
  }
  return out;
}

/** Per kind, the first source that has it wins (Jellyfin over IntroDB). */
export function mergeSegments(primary: MediaSegment[], secondary: MediaSegment[]): MediaSegment[] {
  const out = [...primary];
  for (const seg of secondary) {
    if (!out.some((s) => s.kind === seg.kind)) out.push(seg);
  }
  return out;
}

/** Finite, start ≥ 0, at least 2 s long, inside the runtime; sorted, at most 32. */
export function sanitizeSegments(list: MediaSegment[], duration: number | null): MediaSegment[] {
  const out = list
    .filter((s) => Number.isFinite(s.startSeconds) && Number.isFinite(s.endSeconds))
    .filter((s) => s.startSeconds >= 0 && s.endSeconds - s.startSeconds >= MIN_SEGMENT_SECONDS)
    .filter((s) => duration == null || duration <= 0 || s.startSeconds < duration);
  out.sort((a, b) => a.startSeconds - b.startSeconds);
  return out.slice(0, MAX_SEGMENTS);
}

/** `tt` followed by digits, at most 16 characters (`get_media_segments_external`). */
export function validImdbId(imdb: string): boolean {
  return imdb.length <= 16 && /^tt[0-9]+$/.test(imdb);
}
