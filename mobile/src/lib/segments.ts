import type { MediaSegment, Settings, SkipMode } from "./types";
import type { MessageKey } from "./i18n";

const MIN_SEGMENT_SECONDS = 2;

/** Drops ranges outside the file and clamps ends to just before the end of it. */
export function clampSegments(segments: MediaSegment[], duration: number): MediaSegment[] {
  if (duration <= 0) return segments;
  const limit = duration - 1;
  return segments
    .filter((s) => s.startSeconds < limit)
    .map((s) => (s.endSeconds > limit ? { ...s, endSeconds: limit } : s))
    .filter((s) => s.endSeconds - s.startSeconds >= MIN_SEGMENT_SECONDS);
}

/** Stable identity of a segment within an item (kind + rounded start). */
export function segmentKey(segment: MediaSegment): string {
  return `${segment.kind}:${Math.round(segment.startSeconds)}`;
}

/**
 * Segment that should be considered active at `time`. A segment is entered from
 * `start` to `end - hysteresis` and left below `start - hysteresis` or at `end`, so the
 * prompt does not flicker around the edges.
 */
export function segmentAt(
  segments: MediaSegment[],
  time: number,
  currentKey: string | null,
  hysteresis = 1,
): MediaSegment | null {
  if (currentKey) {
    const current = segments.find((s) => segmentKey(s) === currentKey);
    if (current && time >= current.startSeconds - hysteresis && time < current.endSeconds) return current;
  }
  return segments.find((s) => time >= s.startSeconds && time <= s.endSeconds - hysteresis) ?? null;
}

export function skipModeFor(kind: string, settings: Settings): SkipMode {
  switch (kind) {
    case "recap":
      return settings.playback.skipRecap;
    case "outro":
      return settings.playback.skipOutro;
    default:
      // intro, preview, commercial and anything unknown behave like an intro.
      return settings.playback.skipIntro;
  }
}

export function labelKeyFor(kind: string): MessageKey {
  switch (kind) {
    case "recap":
      return "skipRecap";
    case "outro":
      return "skipOutro";
    case "preview":
      return "skipPreview";
    case "commercial":
      return "skipCommercial";
    default:
      return "skipIntro";
  }
}
