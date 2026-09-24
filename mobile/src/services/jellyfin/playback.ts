/**
 * Playback resolution (`PlaybackInfo` → direct stream or HLS transcode) and session
 * reporting (`/Sessions/Playing…`, ported from `jellyfin.rs::report_*`).
 */
import { Platform } from "react-native";
import { validItemId } from "../util";
import { PlaybackError } from "../events";
import { jellyfin } from "./client";
import { deviceProfileFor, MAX_STREAMING_BITRATE, pickStreamIndex, type DeviceProfile } from "./profile";
import { parsePlaybackInfo, type JellyfinMediaStream, type PlayMethod, type ResolvedPlayback } from "./playback.pure";

export type { JellyfinMediaStream, PlayMethod, ResolvedPlayback } from "./playback.pure";

export type ResolveArgs = {
  itemId: string;
  mediaSourceId?: string | null;
  startSeconds: number;
  /** "" = file default, else ISO 639-2 ("spa"). */
  audioLanguage: string;
  /** "" = file default, "off" = none, else ISO 639-2. */
  subtitleLanguage: string;
  forceTranscode?: boolean;
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
};

/** What the reporting calls need to identify the playback on the server. */
export type PlaybackContext = {
  itemId: string;
  mediaSourceId: string | null;
  playSessionId: string;
  playMethod: PlayMethod;
  transcoding: boolean;
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
};

type PlaybackInfoBody = {
  UserId: string;
  DeviceProfile: DeviceProfile;
  MaxStreamingBitrate: number;
  StartTimeTicks: number;
  MediaSourceId?: string;
  AudioStreamIndex?: number;
  SubtitleStreamIndex?: number;
  EnableDirectPlay: boolean;
  EnableDirectStream: boolean;
  EnableTranscoding: boolean;
  AllowVideoStreamCopy: boolean;
  AllowAudioStreamCopy: boolean;
  AutoOpenLiveStream: boolean;
};

async function playbackInfo(
  itemId: string,
  userId: string,
  force: boolean,
  mediaSourceId: string | null,
  audioStreamIndex: number | undefined,
  subtitleStreamIndex: number | undefined,
): Promise<unknown> {
  const body: PlaybackInfoBody = {
    UserId: userId,
    DeviceProfile: deviceProfileFor(Platform.OS),
    MaxStreamingBitrate: MAX_STREAMING_BITRATE,
    StartTimeTicks: 0,
    EnableDirectPlay: !force,
    // Direct stream hands over the original file (`static=true`); AVPlayer cannot open an
    // MKV that way, so on iOS a file it cannot play directly is remuxed to HLS instead.
    EnableDirectStream: !force && Platform.OS !== "ios",
    EnableTranscoding: true,
    AllowVideoStreamCopy: true,
    AllowAudioStreamCopy: true,
    AutoOpenLiveStream: true,
  };
  if (mediaSourceId) body.MediaSourceId = mediaSourceId;
  if (audioStreamIndex != null) body.AudioStreamIndex = audioStreamIndex;
  if (subtitleStreamIndex != null) body.SubtitleStreamIndex = subtitleStreamIndex;
  const response = await jellyfin.request("POST", `/Items/${itemId}/PlaybackInfo`, body, { query: { UserId: userId } });
  if (!response.ok) {
    if (response.status === 404) throw new PlaybackError("playErrNotFound", "No se encontró la película");
    throw new Error(`Jellyfin PlaybackInfo: ${response.status}`);
  }
  return response.json();
}

/**
 * Asks the server how to play an item with the Android device profile. Track choices
 * follow the language settings unless explicit stream indexes are given; when the server
 * transcodes, a second `PlaybackInfo` call bakes the chosen tracks into the HLS URL.
 */
export async function resolvePlayback(args: ResolveArgs): Promise<ResolvedPlayback> {
  const session = jellyfin.session;
  if (!session) throw new PlaybackError("playErrNoServer", "Sin servidor");
  if (!validItemId(args.itemId)) throw new PlaybackError("playErrInvalidItem", "Ítem no válido");
  const force = args.forceTranscode === true;
  const requestedSource = args.mediaSourceId ?? null;
  const explicit = args.audioStreamIndex != null || args.subtitleStreamIndex != null;
  const parse = (response: unknown): ResolvedPlayback =>
    parsePlaybackInfo(response, {
      itemId: args.itemId,
      serverUrl: session.serverUrl,
      token: session.token,
      deviceId: session.deviceId,
      requestedMediaSourceId: requestedSource,
    });

  let resolved = parse(
    await playbackInfo(args.itemId, session.userId, force, requestedSource, args.audioStreamIndex, args.subtitleStreamIndex),
  );
  if (explicit) {
    if (args.audioStreamIndex != null) resolved.audioStreamIndex = args.audioStreamIndex;
    if (args.subtitleStreamIndex != null) resolved.subtitleStreamIndex = args.subtitleStreamIndex;
    return resolved;
  }

  const audio = pickStreamIndex(resolved.mediaStreams, "Audio", args.audioLanguage);
  const subtitle =
    args.subtitleLanguage.trim().toLowerCase() === "off"
      ? -1
      : pickStreamIndex(resolved.mediaStreams, "Subtitle", args.subtitleLanguage);
  const audioChanged = audio != null && audio !== resolved.audioStreamIndex;
  const subtitleChanged = subtitle != null && subtitle !== (resolved.subtitleStreamIndex ?? -1);
  if (resolved.transcoding && (audioChanged || subtitleChanged)) {
    try {
      resolved = parse(
        await playbackInfo(
          args.itemId,
          session.userId,
          force,
          resolved.mediaSourceId || requestedSource,
          audio ?? resolved.audioStreamIndex,
          subtitle ?? resolved.subtitleStreamIndex,
        ),
      );
    } catch {
      /* keep the first answer: the player still picks tracks client-side when it can */
    }
  }
  if (audio != null) resolved.audioStreamIndex = audio;
  if (subtitle != null) resolved.subtitleStreamIndex = subtitle;
  return resolved;
}

function reportBody(ctx: PlaybackContext, positionTicks: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ItemId: ctx.itemId,
    MediaSourceId: ctx.mediaSourceId,
    PlaySessionId: ctx.playSessionId,
    PlayMethod: ctx.playMethod,
    CanSeek: true,
    PositionTicks: Math.max(0, Math.round(positionTicks)),
  };
  if (ctx.audioStreamIndex != null) body.AudioStreamIndex = ctx.audioStreamIndex;
  if (ctx.subtitleStreamIndex != null && ctx.subtitleStreamIndex >= 0) body.SubtitleStreamIndex = ctx.subtitleStreamIndex;
  return body;
}

/** `POST /Sessions/Playing`. */
export async function reportStart(ctx: PlaybackContext, positionTicks: number): Promise<void> {
  await jellyfin.post("/Sessions/Playing", {
    ...reportBody(ctx, positionTicks),
    IsPaused: false,
    IsMuted: false,
    VolumeLevel: 100,
  });
}

/** `POST /Sessions/Playing/Progress` (EventName TimeUpdate). */
export async function reportProgress(
  ctx: PlaybackContext,
  progress: { positionTicks: number; paused: boolean; muted: boolean; volume: number },
): Promise<void> {
  await jellyfin.post("/Sessions/Playing/Progress", {
    ...reportBody(ctx, progress.positionTicks),
    IsPaused: progress.paused,
    IsMuted: progress.muted,
    VolumeLevel: Math.round(progress.volume),
    EventName: "TimeUpdate",
  });
}

/** `POST /Sessions/Playing/Stopped`. */
export async function reportStop(ctx: PlaybackContext, positionTicks: number): Promise<void> {
  await jellyfin.post("/Sessions/Playing/Stopped", {
    ItemId: ctx.itemId,
    MediaSourceId: ctx.mediaSourceId,
    PlaySessionId: ctx.playSessionId,
    PositionTicks: Math.max(0, Math.round(positionTicks)),
  });
}

/** `DELETE /Videos/ActiveEncodings` for this device's play session; best effort. */
export async function stopActiveEncodings(playSessionId: string): Promise<void> {
  const session = jellyfin.session;
  if (!session || !playSessionId) return;
  try {
    await jellyfin.sendEmpty("DELETE", "/Videos/ActiveEncodings", { deviceId: session.deviceId, playSessionId });
  } catch {
    /* best effort */
  }
}
