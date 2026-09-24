/**
 * Parsing of `POST /Items/{id}/PlaybackInfo` answers into something the player can
 * open. Pure module: no network, no React Native imports.
 */
import type { MessageKey } from "../../lib/i18n";
import { PlaybackError } from "../events";

export type PlayMethod = "DirectPlay" | "DirectStream" | "Transcode";

/** Subset of Jellyfin's `MediaStream` the player needs for track pickers. */
export type JellyfinMediaStream = {
  Index: number;
  Type: string;
  Codec: string | null;
  Language: string | null;
  DisplayTitle: string | null;
  Title: string | null;
  IsDefault: boolean;
  IsExternal: boolean;
  IsForced: boolean;
  Channels: number | null;
  Width: number | null;
  Height: number | null;
};

export type ResolvedPlayback = {
  url: string;
  /** Extra request headers for the media (X-Emby-Token). */
  headers: Record<string, string>;
  contentType: "hls" | "progressive" | "auto";
  playMethod: PlayMethod;
  playSessionId: string;
  mediaSourceId: string;
  container: string;
  transcoding: boolean;
  mediaStreams: JellyfinMediaStream[];
  /** Audio track the server was asked for (or its default). */
  audioStreamIndex?: number;
  /** Subtitle track the server was asked for; `-1` means "none" explicitly. */
  subtitleStreamIndex?: number;
};

export type ParseOptions = {
  itemId: string;
  serverUrl: string;
  token: string;
  deviceId: string;
  requestedMediaSourceId?: string | null;
};

type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function str(source: Json, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function num(source: Json, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(source: Json, key: string): boolean {
  return source[key] === true;
}

/** Spanish message for Jellyfin's `PlaybackErrorCode`. */
export function playbackErrorMessage(code: string): string {
  switch (code) {
    case "NoCompatibleStream":
      return "El servidor no puede reproducir este archivo";
    case "NotAllowed":
      return "El servidor no permite reproducir este archivo";
    case "RateLimitExceeded":
      return "El servidor ha alcanzado el límite de reproducciones";
    default:
      return `No se puede reproducir (${code})`;
  }
}

/** Translation key for a `PlaybackErrorCode` (an unknown one gets a generic sentence plus the code). */
export function playbackErrorKey(code: string): MessageKey {
  switch (code) {
    case "NoCompatibleStream":
      return "playErrServerCannotPlay";
    case "NotAllowed":
      return "playErrNotAllowed";
    case "RateLimitExceeded":
      return "playErrRateLimit";
    default:
      return "playErrServerCode";
  }
}

function playbackFailure(code: string): Error {
  const key = playbackErrorKey(code);
  return new PlaybackError(key, playbackErrorMessage(code), key === "playErrServerCode" ? code : "");
}

export function parseMediaStreams(value: unknown): JellyfinMediaStream[] {
  if (!Array.isArray(value)) return [];
  const out: JellyfinMediaStream[] = [];
  for (const raw of value) {
    const stream = obj(raw);
    if (!stream) continue;
    const index = num(stream, "Index");
    const type = str(stream, "Type");
    if (index == null || !type) continue;
    out.push({
      Index: index,
      Type: type,
      Codec: str(stream, "Codec"),
      Language: str(stream, "Language"),
      DisplayTitle: str(stream, "DisplayTitle"),
      Title: str(stream, "Title"),
      IsDefault: bool(stream, "IsDefault"),
      IsExternal: bool(stream, "IsExternal"),
      IsForced: bool(stream, "IsForced"),
      Channels: num(stream, "Channels"),
      Width: num(stream, "Width"),
      Height: num(stream, "Height"),
    });
  }
  return out;
}

/**
 * Picks the media source (requested id, else the first) and builds the stream URL:
 * `/Videos/{id}/stream.{container}?static=true…` for direct play/stream, the server's
 * `TranscodingUrl` otherwise. Throws with a Spanish message when nothing is playable.
 */
export function parsePlaybackInfo(response: unknown, options: ParseOptions): ResolvedPlayback {
  const body = obj(response);
  if (!body) throw new PlaybackError("playErrBadResponse", "Respuesta inválida del servidor");
  const errorCode = str(body, "ErrorCode");
  if (errorCode) throw playbackFailure(errorCode);
  const sources = Array.isArray(body.MediaSources) ? body.MediaSources.map(obj).filter((s): s is Json => s != null) : [];
  if (sources.length === 0) throw new PlaybackError("playErrServerCannotPlay", "El servidor no puede reproducir este archivo");
  const requested = options.requestedMediaSourceId ?? null;
  const source = (requested && sources.find((s) => str(s, "Id") === requested)) || sources[0];
  const mediaSourceId = str(source, "Id") ?? requested ?? "";
  const playSessionId = str(body, "PlaySessionId") ?? "";
  const container = str(source, "Container") ?? "mkv";
  const serverUrl = options.serverUrl.replace(/\/+$/, "");
  const mediaStreams = parseMediaStreams(source.MediaStreams);
  const defaultAudio = num(source, "DefaultAudioStreamIndex");
  const defaultSubtitle = num(source, "DefaultSubtitleStreamIndex");
  const base = {
    headers: { "X-Emby-Token": options.token },
    playSessionId,
    mediaSourceId,
    mediaStreams,
    audioStreamIndex: defaultAudio ?? undefined,
    subtitleStreamIndex: defaultSubtitle ?? undefined,
  };

  const directPlay = bool(source, "SupportsDirectPlay");
  const directStream = bool(source, "SupportsDirectStream");
  if (directPlay || directStream) {
    const params = [
      "static=true",
      `MediaSourceId=${encodeURIComponent(mediaSourceId)}`,
      `DeviceId=${encodeURIComponent(options.deviceId)}`,
      `api_key=${encodeURIComponent(options.token)}`,
      `PlaySessionId=${encodeURIComponent(playSessionId)}`,
    ];
    const etag = str(source, "ETag");
    if (etag) params.push(`Tag=${encodeURIComponent(etag)}`);
    return {
      ...base,
      url: `${serverUrl}/Videos/${options.itemId}/stream.${container}?${params.join("&")}`,
      contentType: "progressive",
      playMethod: directPlay ? "DirectPlay" : "DirectStream",
      container,
      transcoding: false,
    };
  }

  const transcodingUrl = str(source, "TranscodingUrl");
  if (!transcodingUrl) throw new PlaybackError("playErrServerCannotPlay", "El servidor no puede reproducir este archivo");
  const protocol = (str(source, "TranscodingSubProtocol") ?? "").toLowerCase();
  const url = /^https?:\/\//i.test(transcodingUrl)
    ? transcodingUrl
    : `${serverUrl}${transcodingUrl.startsWith("/") ? "" : "/"}${transcodingUrl}`;
  return {
    ...base,
    url,
    contentType: protocol === "hls" ? "hls" : "auto",
    playMethod: "Transcode",
    container: str(source, "TranscodingContainer") ?? container,
    transcoding: true,
  };
}
