/**
 * Track-list helpers (pure, no expo imports so they can run under vitest).
 *
 * Two shapes feed the `PlayerState.tracks` list the UI renders:
 * - direct play: the tracks ExoPlayer exposes (`availableAudioTracks` /
 *   `availableSubtitleTracks`), numbered `index + 1` like mpv's `aid` / `sid`;
 * - transcoding: the Jellyfin media streams, keyed by their stream `Index`, since the
 *   HLS output only carries the stream the server was asked for.
 */
import type { PlayerTrack } from "../../lib/types";

export type TrackKind = "audio" | "sub";

/** Structural subset of expo-video's `AudioTrack` / `SubtitleTrack`. */
export type NativeTrack = {
  id?: string;
  language?: string | null;
  label?: string | null;
  name?: string | null;
  isDefault?: boolean;
};

/** Structural subset of a Jellyfin `MediaStream`. */
export type MediaStreamLike = {
  Index: number;
  Type: string;
  Codec?: string | null;
  Language?: string | null;
  DisplayTitle?: string | null;
  IsDefault?: boolean;
  IsExternal?: boolean;
};

export function normalizeKind(kind: string): TrackKind | null {
  if (kind === "audio") return "audio";
  if (kind === "sub" || kind === "subtitle" || kind === "subtitles") return "sub";
  return null;
}

/** Two native tracks refer to the same stream (by id when both have one). */
export function sameTrack(a: NativeTrack | null | undefined, b: NativeTrack | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.id != null && b.id != null) return a.id === b.id;
  return (a.language ?? "") === (b.language ?? "") && (a.label ?? "") === (b.label ?? "");
}

function fallbackTitle(n: number): string {
  return `Pista ${n}`;
}

/** Direct-play list: ids are `index + 1`, `selected` follows the player's current track. */
export function directTracks(
  kind: TrackKind,
  available: readonly NativeTrack[],
  current: NativeTrack | null | undefined,
): PlayerTrack[] {
  return available.map((track, index) => ({
    id: index + 1,
    kind,
    title: track.label || track.name || track.language || fallbackTitle(index + 1),
    lang: track.language || null,
    selected: sameTrack(track, current),
    codec: null,
  }));
}

/** Map `id -> native track` for the direct-play numbering (`index + 1`). */
export function indexTracks<T extends NativeTrack>(available: readonly T[]): Map<number, T> {
  const map = new Map<number, T>();
  available.forEach((track, index) => map.set(index + 1, track));
  return map;
}

/** Transcode list from the Jellyfin media streams: ids are the stream `Index`. */
export function transcodeTracks(
  kind: TrackKind,
  streams: readonly MediaStreamLike[],
  selectedIndex: number | null | undefined,
): PlayerTrack[] {
  const type = kind === "audio" ? "Audio" : "Subtitle";
  return streams
    .filter((stream) => stream.Type === type)
    .map((stream, position) => ({
      id: stream.Index,
      kind,
      title: stream.DisplayTitle || stream.Language || fallbackTitle(position + 1),
      lang: stream.Language || null,
      selected: selectedIndex != null && selectedIndex >= 0 && stream.Index === selectedIndex,
      codec: stream.Codec || null,
    }));
}

/** Stream the server plays when none was asked for: the default one, else the first of `type`. */
export function defaultStreamIndex(streams: readonly MediaStreamLike[], type: string): number | undefined {
  const ofType = streams.filter((stream) => stream.Type === type);
  return (ofType.find((stream) => stream.IsDefault) ?? ofType[0])?.Index;
}

/** Id of the selected track of `kind`, 0 when none (mpv reports `aid`/`sid` = no as 0). */
export function selectedId(tracks: readonly PlayerTrack[], kind: TrackKind): number {
  const track = tracks.find((t) => t.kind === kind && t.selected);
  return track ? track.id : 0;
}

/** Full list for the state: audio first, then subtitles. */
export function mergeTracks(audio: readonly PlayerTrack[], subs: readonly PlayerTrack[]): PlayerTrack[] {
  return [...audio, ...subs];
}

/**
 * First track whose language matches the preferred `code` (ISO 639-2 from the settings);
 * `matches` decides the equivalence (aliases such as spa/es). `null` when nothing matches
 * or when there is no preference.
 */
export function pickByLang<T extends NativeTrack>(
  available: readonly T[],
  code: string,
  matches: (trackLang: string | null | undefined, code: string) => boolean,
): T | null {
  if (!code || code === "off") return null;
  return available.find((track) => matches(track.language, code)) ?? null;
}

export type SubtitlePreference = { kind: "off" } | { kind: "default" } | { kind: "track"; track: NativeTrack };

/** What the subtitle preference asks for: `off` → none, `""` → file default, code → first match. */
export function subtitlePreference<T extends NativeTrack>(
  available: readonly T[],
  code: string,
  matches: (trackLang: string | null | undefined, code: string) => boolean,
): SubtitlePreference {
  if (code === "off") return { kind: "off" };
  if (!code) return { kind: "default" };
  const track = pickByLang(available, code, matches);
  return track ? { kind: "track", track } : { kind: "default" };
}
