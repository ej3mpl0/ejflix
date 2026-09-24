/**
 * Which ways out the player's error card offers, by source and kind of failure.
 * Pure (vitest-friendly); the screen maps each action to a button.
 */
import type { PlayerErrorCode } from "../events";

/**
 * - `transcode`: ask Jellyfin for a transcoded stream (direct play failed);
 * - `stream`: a downloaded file failed, play the online version instead;
 * - `source`: reopen the online-sources picker;
 * - `retry`: start the same thing again;
 * - `external`: hand the URL to another app.
 */
export type ErrorAction = "transcode" | "stream" | "source" | "retry" | "external";

export type ErrorSourceKind = "jellyfin" | "addon" | "live" | "offline";

export type ErrorContext = {
  source: ErrorSourceKind;
  code: PlayerErrorCode;
  /** The failing Jellyfin playback was already a transcode. */
  transcoding: boolean;
  /** The engine has a stream URL another app could open. */
  hasUrl: boolean;
};

/** Actions in display order: the most likely fix first, "retry" always present. */
export function errorActions(ctx: ErrorContext): ErrorAction[] {
  const out: ErrorAction[] = [];
  switch (ctx.source) {
    case "jellyfin":
      // Transcoding fixes formats the device cannot decode, not an unreachable server.
      if (!ctx.transcoding && ctx.code !== "network") out.push("transcode");
      out.push("retry");
      break;
    case "offline":
      out.push("stream", "retry");
      break;
    case "addon":
      if (ctx.code === "network") out.push("retry", "source");
      else out.push("source", "retry");
      break;
    case "live":
      out.push("retry");
      break;
  }
  if (ctx.hasUrl && ctx.source !== "offline") out.push("external");
  return out;
}

/** Translated sentence for the card; the raw engine text goes under "Details". */
export function errorMessageKey(code: PlayerErrorCode): "playbackFailedDecoder" | "playbackFailedNetwork" | "playbackFailedGeneric" {
  if (code === "decoder") return "playbackFailedDecoder";
  if (code === "network") return "playbackFailedNetwork";
  return "playbackFailedGeneric";
}
