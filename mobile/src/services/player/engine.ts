/**
 * Video engine of the Android port: the mpv process of the desktop app replaced by a
 * single expo-video `VideoPlayer` created at module init. Screens render one
 * `<VideoView player={engine.player} />`; everything else goes through `engine.*`
 * with the same names as the Tauri commands, and every state change is pushed as
 * `player://state` (see `src-tauri/src/player.rs` and `lib.rs` for the semantics).
 */
import {
  createVideoPlayer,
  type AudioTrack,
  type ContentType,
  type SubtitleTrack,
  type VideoMetadata,
  type VideoPlayer,
  type VideoSource,
} from "expo-video";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as ScreenOrientation from "expo-screen-orientation";
import * as NavigationBar from "expo-navigation-bar";
import { Platform } from "react-native";
import type { Movie, PlayerState, PlayerTrack } from "../../lib/types";
import { emit, PlaybackError, type PlayerErrorCode } from "../events";
import { LocalizedError } from "../errors";
import { clamp, ticksFromSeconds } from "../util";
import { getItem } from "../jellyfin/library";
import {
  reportStart,
  reportStop,
  resolvePlayback,
  stopActiveEncodings,
  type PlaybackContext,
  type ResolvedPlayback,
} from "../jellyfin/playback";
import { matchesLang } from "../jellyfin/languages";
import { settingsGet } from "../settings";
import { upsertProgress } from "../addons";
import { resolveCatchupPlayback, resolveChannelPlayback } from "../iptv";
import { downloadFileUri, downloadGet, downloadPlayable, downloadRecordPosition, downloadsSyncPending } from "../downloads/downloads";
import { BLOCKED } from "../parental";
import { registerSessionCleanup } from "../session";
import { aspectBox, isAspectMode } from "./aspect";
import { ProgressLoop, reportTick } from "./progress";
import {
  defaultStreamIndex,
  directTracks,
  indexTracks,
  mergeTracks,
  normalizeKind,
  pickByLang,
  sameTrack,
  selectedId,
  subtitlePreference,
  transcodeTracks,
  type TrackKind,
} from "./tracks";
import type { EngineContext, PlaybackPrefs, ResumeEntryBase } from "./types";

export type { EngineContext, PlaybackPrefs, ResumeEntryBase } from "./types";

const KEEP_AWAKE_TAG = "player";
const START_ERROR = "No se pudo reproducir el vídeo";
const SPEED_MIN = 0.25;
const SPEED_MAX = 4;
/** Fast scrubbing: at most one seek every 200 ms (leading + trailing). */
const SCRUB_INTERVAL_MS = 200;
/** After a seek, time updates far from the target are ignored for this long. */
const SEEK_SETTLE_MS = 2000;
const SEEK_SETTLE_TOLERANCE = 3;

// ---- State ----

function defaultState(): PlayerState {
  return {
    time: 0,
    duration: 0,
    paused: false,
    volume: 100,
    mute: false,
    buffering: false,
    eof: false,
    tracks: [],
    aid: 0,
    sid: 0,
    title: "",
    cacheTime: 0,
    speed: 1,
    aspect: "auto",
  };
}

function defaultPrefs(): PlaybackPrefs {
  return { audioLanguage: "", subtitleLanguage: "", rememberSpeed: false, lastSpeed: 1, backgroundAudio: true };
}

/** Everything that belongs to the source being played and is thrown away on the next one. */
type Scratch = {
  startSeconds: number;
  /** First `readyToPlay` handled (resume seek issued, duration read). */
  ready: boolean;
  /** Time updates are accepted only after the resume seek has been issued. */
  resumeDone: boolean;
  prefsApplied: { audio: boolean; sub: boolean };
  audioMap: Map<number, AudioTrack>;
  subMap: Map<number, SubtitleTrack>;
  prefs: PlaybackPrefs;
  /** Direct play already failed once and the transcode fallback was attempted. */
  fallbackTried: boolean;
  seekTarget: number | null;
  seekAtMs: number;
};

function newScratch(startSeconds: number, prefs: PlaybackPrefs, fallbackTried: boolean): Scratch {
  return {
    startSeconds: Math.max(0, startSeconds),
    ready: false,
    resumeDone: false,
    prefsApplied: { audio: false, sub: false },
    audioMap: new Map(),
    subMap: new Map(),
    prefs,
    fallbackTried,
    seekTarget: null,
    seekAtMs: 0,
  };
}

let state: PlayerState = defaultState();
let ctx: EngineContext | null = null;
/** Bumped on every load and stop; async continuations and events check it. */
let gen = 0;
/** True once the player is known to hold the current source (events before that are stale). */
let armed = false;
let scratch: Scratch = newScratch(0, defaultPrefs(), false);
const loop = new ProgressLoop();

// ---- The player ----

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function createPlayer(): VideoPlayer {
  const p = createVideoPlayer(null);
  try {
    p.timeUpdateEventInterval = 0.25;
    p.preservesPitch = true;
    p.staysActiveInBackground = false;
    p.showNowPlayingNotification = false;
  } catch (error) {
    console.warn("[player] could not configure the video player", error);
  }
  return p;
}

const player: VideoPlayer = createPlayer();

// ---- Helpers ----

function snapshot(): PlayerState {
  return { ...state, tracks: state.tracks.map((track) => ({ ...track })) };
}

function push(): void {
  emit("player://state", snapshot());
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}

/**
 * ExoPlayer reports a failure as one long line, AVPlayer as an NSError (domain +
 * code, e.g. AVFoundationErrorDomain -11828 "Cannot Open"). Only the kind matters to the UI:
 * a decoder that cannot handle the format needs a different source, a network
 * failure needs a retry.
 */
function classifyError(detail: string): PlayerErrorCode {
  const text = detail.toLowerCase();
  if (
    /exceeds_capabilities|decoder failed|decoderinitialization|mediacodec|unsupported_type/.test(text) ||
    /cannot open|cannot decode|not supported|format is not|-11828|-11829|-11833|-11850|-11821|-12847|coremediaerrordomain/.test(text)
  ) {
    return "decoder";
  }
  if (
    /source error|httpdatasource|unable to connect|timed out|timeout|network|econnreset|response code/.test(text) ||
    /nsurlerrordomain|-1001|-1004|-1005|-1009|could not connect|internet connection|-12938|-12660/.test(text)
  ) {
    return "network";
  }
  return "unknown";
}

function emitError(error: unknown, url: string | null, transcoding: boolean = isTranscoding()): void {
  // The library refuses a title above the profile's age limit with a bare marker.
  if (!(error instanceof PlaybackError) && errorDetail(error) === BLOCKED) {
    error = new PlaybackError("parentalBlockedTitle", BLOCKED);
  } else if (error instanceof LocalizedError && Object.keys(error.vars).length === 0) {
    error = new PlaybackError(error.key, error.message);
  }
  if (error instanceof PlaybackError) {
    emit("player://error", { message: error.message, detail: error.detail, code: "unknown", url, key: error.key, transcoding });
    return;
  }
  const detail = errorDetail(error);
  emit("player://error", {
    message: detail ? `${START_ERROR}: ${detail}` : START_ERROR,
    detail,
    code: classifyError(detail),
    url,
    transcoding,
  });
}

/**
 * Background audio and picture-in-picture need the player to stay active when the app
 * leaves the foreground; the now-playing notification is what keeps Android's media
 * service (and the lock-screen controls) alive meanwhile.
 */
function applyBackground(on: boolean): void {
  try {
    player.staysActiveInBackground = on;
    player.showNowPlayingNotification = on;
  } catch (error) {
    console.warn("[player] could not change background playback", error);
  }
}

/** Jellyfin stream URLs carry the access token (`api_key`): never hand them to another app. */
function shareableUrl(current: EngineContext | null, url: string | null): string | null {
  return current?.source.kind === "jellyfin" ? null : url;
}

let chain: Promise<unknown> = Promise.resolve();
/** Start/stop/track switches never overlap: they run one after another. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

function isLive(): boolean {
  return ctx?.source.kind === "live";
}

function isTranscoding(): boolean {
  return ctx?.source.kind === "jellyfin" && ctx.source.resolved.transcoding;
}

function speedFromPrefs(prefs: PlaybackPrefs): number {
  if (prefs.rememberSpeed && Number.isFinite(prefs.lastSpeed)) return clamp(prefs.lastSpeed, SPEED_MIN, SPEED_MAX);
  return 1;
}

async function loadPrefs(): Promise<PlaybackPrefs> {
  try {
    const playback = (await settingsGet()).playback;
    return {
      audioLanguage: playback.audioLanguage ?? "",
      subtitleLanguage: playback.subtitleLanguage ?? "",
      rememberSpeed: Boolean(playback.rememberSpeed),
      lastSpeed: Number.isFinite(playback.lastSpeed) ? playback.lastSpeed : 1,
      backgroundAudio: playback.backgroundAudio !== false,
    };
  } catch {
    return defaultPrefs();
  }
}

function sourceUri(source: VideoSource | null | undefined): string | null {
  if (source == null) return null;
  if (typeof source === "string") return source;
  if (typeof source === "number") return null;
  return source.uri ?? null;
}

/** `.m3u8` playlists are declared as HLS; anything else is left to the player. */
export function contentTypeFor(url: string): ContentType {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split(/[?#]/)[0] ?? url;
  }
  return path.toLowerCase().endsWith(".m3u8") ? "hls" : "auto";
}

/** Header pairs → object; the Jellyfin token never travels with an online stream. */
export function headersFromPairs(pairs: readonly [string, string][]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of pairs) {
    if (!key || key.toLowerCase() === "x-emby-token") continue;
    if (typeof value !== "string" || /[\r\n]/.test(value)) continue;
    out[key] = value;
  }
  return out;
}

function playbackFromResolved(itemId: string, resolved: ResolvedPlayback): PlaybackContext {
  return {
    itemId,
    mediaSourceId: resolved.mediaSourceId,
    playSessionId: resolved.playSessionId,
    playMethod: resolved.playMethod,
    transcoding: resolved.transcoding,
    audioStreamIndex: resolved.audioStreamIndex,
    subtitleStreamIndex: resolved.subtitleStreamIndex,
  };
}

/** Version picker: the requested media source when the item has it, else the first. */
function pickMediaSource(item: Movie, requested: string | null | undefined): string | undefined {
  const source =
    (requested ? item.mediaSources.find((s) => s.id === requested) : undefined) ?? item.mediaSources[0];
  return source?.id ?? item.mediaSourceId ?? undefined;
}

// ---- Tracks ----

function rebuildTracks(): void {
  if (!ctx) {
    state.tracks = [];
    state.aid = 0;
    state.sid = 0;
    return;
  }
  let audio: PlayerTrack[];
  let subs: PlayerTrack[];
  if (ctx.source.kind === "jellyfin" && ctx.source.resolved.transcoding) {
    const resolved = ctx.source.resolved;
    const streams = resolved.mediaStreams ?? [];
    const audioIndex = resolved.audioStreamIndex ?? defaultStreamIndex(streams, "Audio");
    audio = transcodeTracks("audio", streams, audioIndex);
    subs = transcodeTracks("sub", streams, resolved.subtitleStreamIndex ?? -1);
  } else {
    audio = directTracks("audio", Array.from(scratch.audioMap.values()), safe(() => player.audioTrack, null));
    subs = directTracks("sub", Array.from(scratch.subMap.values()), safe(() => player.subtitleTrack, null));
  }
  state.tracks = mergeTracks(audio, subs);
  state.aid = selectedId(state.tracks, "audio");
  state.sid = selectedId(state.tracks, "sub");
}

function applyAudioPref(available: readonly AudioTrack[]): void {
  if (isTranscoding()) return; // the server already picked the stream
  const wanted = pickByLang(available, scratch.prefs.audioLanguage, matchesLang);
  if (wanted && !sameTrack(wanted, safe(() => player.audioTrack, null))) {
    try {
      player.audioTrack = wanted;
    } catch (error) {
      console.warn("[player] could not select the audio track", error);
    }
  }
}

function applySubPref(available: readonly SubtitleTrack[]): void {
  try {
    if (ctx?.source.kind === "jellyfin" && ctx.source.resolved.transcoding) {
      // Jellyfin either burns the chosen subtitle in (no native track) or serves it as
      // the only HLS rendition: make sure it is on, and that nothing shows when none was asked.
      const index = ctx.source.resolved.subtitleStreamIndex;
      const current = safe(() => player.subtitleTrack, null);
      if (index == null || index < 0) {
        if (current) player.subtitleTrack = null;
      } else if (!current && available.length === 1) {
        player.subtitleTrack = available[0];
      }
      return;
    }
    const pref = subtitlePreference(available, scratch.prefs.subtitleLanguage, matchesLang);
    if (pref.kind === "off") {
      if (safe(() => player.subtitleTrack, null)) player.subtitleTrack = null;
    } else if (pref.kind === "track" && !sameTrack(pref.track, safe(() => player.subtitleTrack, null))) {
      player.subtitleTrack = pref.track as SubtitleTrack;
    }
  } catch (error) {
    console.warn("[player] could not select the subtitle track", error);
  }
}

function onAudioTracks(available: readonly AudioTrack[]): void {
  scratch.audioMap = indexTracks(available);
  if (!scratch.prefsApplied.audio && available.length > 0) {
    scratch.prefsApplied.audio = true;
    applyAudioPref(available);
  }
  rebuildTracks();
}

function onSubtitleTracks(available: readonly SubtitleTrack[]): void {
  scratch.subMap = indexTracks(available);
  if (!scratch.prefsApplied.sub) {
    // "off" must apply even when the list is empty so a later default cannot sneak in.
    if (available.length > 0 || scratch.prefs.subtitleLanguage === "off") {
      scratch.prefsApplied.sub = true;
      applySubPref(available);
    }
  }
  rebuildTracks();
}

// ---- Time / duration ----

function refreshDuration(): void {
  if (!ctx || isLive()) {
    state.duration = 0;
    return;
  }
  if (safe(() => player.isLive, false)) {
    state.duration = 0;
    return;
  }
  const duration = safe(() => player.duration, 0);
  state.duration = Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function applySeek(seconds: number): void {
  state.time = seconds;
  scratch.seekTarget = seconds;
  scratch.seekAtMs = Date.now();
  try {
    player.currentTime = seconds;
  } catch (error) {
    console.warn("[player] seek failed", error);
  }
}

function acceptTime(current: number): void {
  if (!Number.isFinite(current)) return;
  if (scratch.seekTarget != null) {
    const settled =
      Math.abs(current - scratch.seekTarget) <= SEEK_SETTLE_TOLERANCE || Date.now() - scratch.seekAtMs > SEEK_SETTLE_MS;
    if (!settled) return;
    scratch.seekTarget = null;
  }
  state.time = Math.max(0, current);
}

/** First `readyToPlay` of a source: resume position, duration. */
function onReady(): void {
  if (scratch.ready) return;
  scratch.ready = true;
  if (scratch.startSeconds > 1) applySeek(scratch.startSeconds);
  scratch.resumeDone = true;
  refreshDuration();
}

/** Reads what the player already reports (events may have fired before `armed`). */
function syncFromPlayer(): void {
  const status = safe(() => player.status, "idle");
  state.buffering = status === "loading";
  if (status === "readyToPlay") onReady();
  const audio = safe(() => player.availableAudioTracks, [] as AudioTrack[]);
  if (audio.length > 0) onAudioTracks(audio);
  const subs = safe(() => player.availableSubtitleTracks, [] as SubtitleTrack[]);
  if (subs.length > 0 || scratch.prefs.subtitleLanguage === "off") onSubtitleTracks(subs);
  if (audio.length === 0 && subs.length === 0) rebuildTracks();
}

// ---- Fast scrubbing ----

let scrubTimer: ReturnType<typeof setTimeout> | null = null;
let scrubPending: number | null = null;

function setScrubbingMode(on: boolean): void {
  try {
    player.scrubbingModeOptions = { scrubbingModeEnabled: on };
  } catch {
    /* older runtime */
  }
}

function scrub(seconds: number): void {
  if (scrubTimer != null) {
    scrubPending = seconds;
    return;
  }
  setScrubbingMode(true);
  applySeek(seconds);
  scrubTimer = setTimeout(() => {
    scrubTimer = null;
    if (scrubPending != null) {
      const next = scrubPending;
      scrubPending = null;
      scrub(next);
      return;
    }
    setScrubbingMode(false);
  }, SCRUB_INTERVAL_MS);
}

function clearScrub(): void {
  if (scrubTimer != null) {
    clearTimeout(scrubTimer);
    scrubTimer = null;
  }
  scrubPending = null;
  setScrubbingMode(false);
}

// ---- Load / stop ----

type LoadArgs = {
  url: string;
  headers: Record<string, string>;
  contentType: ContentType;
  metadata: VideoMetadata;
  title: string;
  startSeconds: number;
  prefs: PlaybackPrefs;
  speed: number;
  ctx: EngineContext;
  fallbackTried: boolean;
  /** Keep the player paused after loading (track switch while paused). */
  paused?: boolean;
};

async function load(args: LoadArgs): Promise<void> {
  gen += 1;
  const g = gen;
  armed = false;
  clearScrub();
  scratch = newScratch(args.startSeconds, args.prefs, args.fallbackTried);
  ctx = args.ctx;
  state = {
    ...defaultState(),
    volume: state.volume,
    mute: state.mute,
    title: args.title,
    // Until the player reports a time, treat the resume point as the current time so
    // an immediate stop does not report position 0 to Jellyfin.
    time: Math.max(0, args.startSeconds),
    speed: args.speed,
    buffering: true,
  };
  push();
  try {
    await player.replaceAsync({
      uri: args.url,
      headers: Object.keys(args.headers).length > 0 ? args.headers : undefined,
      contentType: args.contentType,
      metadata: args.metadata,
    });
  } catch (error) {
    if (g === gen) {
      ctx = null;
      state.buffering = false;
      push();
    }
    throw error;
  }
  if (g !== gen) return; // superseded meanwhile
  armed = true;
  applyBackground(args.prefs.backgroundAudio);
  try {
    player.volume = clamp(state.volume, 0, 100) / 100;
    player.muted = state.mute;
    player.playbackRate = args.speed;
    if (args.paused) {
      player.pause();
      state.paused = true;
    } else {
      player.play();
    }
  } catch (error) {
    console.warn("[player] could not apply the playback properties", error);
  }
  activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
  loop.start(progressTick);
  syncFromPlayer();
  push();
}

async function progressTick(): Promise<void> {
  const current = ctx;
  if (!current) return;
  await reportTick(current, snapshot());
  if (ctx === current) push();
}

/** Stops the player and reports the final position; `emitClose` is false while switching. */
async function stopInner(emitClose: boolean): Promise<void> {
  const current = ctx;
  const { time, duration } = state;
  ctx = null;
  gen += 1;
  armed = false;
  loop.stop();
  clearScrub();
  try {
    player.pause();
  } catch {
    /* no source */
  }
  try {
    await player.replaceAsync(null);
  } catch (error) {
    console.warn("[player] could not release the source", error);
  }
  deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
  applyBackground(false);
  state.buffering = false;
  if (current) {
    switch (current.source.kind) {
      case "jellyfin": {
        const { playback } = current.source;
        try {
          await reportStop(playback, ticksFromSeconds(time));
        } catch (error) {
          console.warn("[player] report stop failed", error);
        }
        if (playback.transcoding) {
          try {
            await stopActiveEncodings(playback.playSessionId);
          } catch (error) {
            console.warn("[player] stop encodings failed", error);
          }
        }
        break;
      }
      case "addon":
        // Nothing was loaded (start failed): keep the stored entry and its duration.
        if (duration <= 0) break;
        try {
          upsertProgress(current.source.entry, time, duration);
        } catch (error) {
          console.warn("[player] addon progress failed", error);
        }
        break;
      case "offline": {
        const { downloadId, entry } = current.source;
        // Nothing was loaded (start failed): keep the stored positions.
        if (duration <= 0) break;
        try {
          downloadRecordPosition(downloadId, time, duration);
          if (entry) upsertProgress(entry, time, duration);
        } catch (error) {
          console.warn("[player] offline progress failed", error);
        }
        // Online again? The server hears about it right away.
        void downloadsSyncPending();
        break;
      }
      case "live":
        break;
    }
  }
  // A second stop (screen exit + unmount) has nothing to close.
  if (emitClose && current) emit("player://close");
}

/** Direct play failed: try once more through the transcoder, else surface the error. */
async function recoverFromError(g: number, detail: string): Promise<void> {
  if (g !== gen || !ctx) return;
  const current = ctx;
  if (current.source.kind === "jellyfin" && !current.source.resolved.transcoding && !scratch.fallbackTried) {
    const old = current.source;
    const time = state.time;
    const prefs = scratch.prefs;
    try {
      const resolved = await resolvePlayback({
        itemId: old.playback.itemId,
        mediaSourceId: old.mediaSourceId,
        startSeconds: time,
        audioLanguage: prefs.audioLanguage,
        subtitleLanguage: prefs.subtitleLanguage,
        forceTranscode: true,
      });
      if (g !== gen) return;
      reportStop(old.playback, ticksFromSeconds(time)).catch(() => undefined);
      const playback = playbackFromResolved(old.playback.itemId, resolved);
      await load({
        url: resolved.url,
        headers: resolved.headers,
        contentType: resolved.contentType,
        metadata: metadataForItem(current.title, old.item),
        title: current.title,
        startSeconds: time,
        prefs,
        speed: state.speed,
        ctx: { ...current, url: resolved.url, source: { ...old, playback, resolved } },
        fallbackTried: true,
      });
      reportStart(playback, ticksFromSeconds(time)).catch(() => undefined);
      return;
    } catch (error) {
      emitError(error, shareableUrl(current, current.url), true);
      return;
    }
  }
  emitError(detail, shareableUrl(current, current.url));
}

function metadataForItem(title: string, item: Movie): VideoMetadata {
  return {
    title,
    artist: item.seriesName ?? undefined,
    artwork: item.posterUrl ?? item.thumbUrl ?? undefined,
  };
}

// ---- Player events ----

player.addListener("sourceChange", ({ source }) => {
  if (ctx && sourceUri(source) === ctx.url) armed = true;
});

player.addListener("sourceLoad", (payload) => {
  if (!ctx) return;
  if (!armed && sourceUri(payload.videoSource) === ctx.url) armed = true;
  if (!armed) return;
  refreshDuration();
  if (payload.availableAudioTracks?.length) onAudioTracks(payload.availableAudioTracks);
  if (payload.availableSubtitleTracks?.length) onSubtitleTracks(payload.availableSubtitleTracks);
  push();
});

player.addListener("statusChange", ({ status, error }) => {
  if (!armed || !ctx) return;
  const g = gen;
  state.buffering = status === "loading";
  if (status === "readyToPlay") onReady();
  if (status === "error") {
    state.buffering = false;
    const detail = error?.message ?? "";
    void serialized(() => recoverFromError(g, detail));
  }
  push();
});

player.addListener("timeUpdate", ({ currentTime, bufferedPosition }) => {
  if (!armed || !ctx) return;
  state.cacheTime = Number.isFinite(bufferedPosition) && bufferedPosition > 0 ? bufferedPosition : 0;
  if (scratch.resumeDone) acceptTime(currentTime);
  refreshDuration();
  push();
});

player.addListener("playingChange", ({ isPlaying }) => {
  if (!armed || !ctx) return;
  if (safe(() => player.status, "idle") !== "readyToPlay" || state.eof) return;
  state.paused = !isPlaying;
  push();
});

player.addListener("playToEnd", () => {
  if (!armed || !ctx) return;
  state.eof = true;
  if (state.duration > 0) state.time = state.duration;
  push();
});

player.addListener("volumeChange", ({ volume }) => {
  if (!Number.isFinite(volume)) return;
  state.volume = clamp(Math.round(volume * 100), 0, 100);
  push();
});

player.addListener("mutedChange", ({ muted }) => {
  state.mute = Boolean(muted);
  push();
});

player.addListener("playbackRateChange", ({ playbackRate }) => {
  if (!armed || !ctx || !Number.isFinite(playbackRate) || playbackRate <= 0) return;
  state.speed = playbackRate;
  push();
});

player.addListener("availableAudioTracksChange", ({ availableAudioTracks }) => {
  if (!armed || !ctx) return;
  onAudioTracks(availableAudioTracks ?? []);
  push();
});

player.addListener("audioTrackChange", () => {
  if (!armed || !ctx) return;
  rebuildTracks();
  push();
});

player.addListener("availableSubtitleTracksChange", ({ availableSubtitleTracks }) => {
  if (!armed || !ctx) return;
  onSubtitleTracks(availableSubtitleTracks ?? []);
  push();
});

player.addListener("subtitleTrackChange", () => {
  if (!armed || !ctx) return;
  rebuildTracks();
  push();
});

// ---- Public API ----

async function playerStart(args: {
  itemId: string;
  title: string;
  startSeconds?: number;
  mediaSourceId?: string | null;
  /** Skip direct play (the "Try transcoding" way out of a failure). */
  forceTranscode?: boolean;
}): Promise<PlayerState> {
  return serialized(async () => {
    const force = args.forceTranscode === true;
    try {
      if (ctx) await stopInner(false);
      const start = Math.max(0, args.startSeconds ?? 0);
      const item = await getItem(args.itemId);
      const prefs = await loadPrefs();
      const mediaSourceId = pickMediaSource(item, args.mediaSourceId);
      const resolved = await resolvePlayback({
        itemId: item.id,
        mediaSourceId,
        startSeconds: start,
        audioLanguage: prefs.audioLanguage,
        subtitleLanguage: prefs.subtitleLanguage,
        forceTranscode: force,
      });
      const playback = playbackFromResolved(item.id, resolved);
      await load({
        url: resolved.url,
        headers: resolved.headers,
        contentType: resolved.contentType,
        metadata: metadataForItem(args.title, item),
        title: args.title,
        startSeconds: start,
        prefs,
        speed: speedFromPrefs(prefs),
        ctx: {
          source: { kind: "jellyfin", playback, item, resolved, mediaSourceId },
          title: args.title,
          url: resolved.url,
        },
        fallbackTried: force,
      });
      reportStart(playback, ticksFromSeconds(start)).catch((error) =>
        console.warn("[player] report start failed", error),
      );
      return snapshot();
    } catch (error) {
      // The Jellyfin URL carries the token: no "open in another app".
      emitError(error, null, force);
      throw error;
    }
  });
}

/** Plays a finished download from the device (works without network). */
async function playerStartFile(args: {
  downloadId: string;
  title: string;
  startSeconds?: number;
  /** Online titles: their progress is also kept in the local "continue watching". */
  entry?: ResumeEntryBase | null;
}): Promise<PlayerState> {
  return serialized(async () => {
    try {
      const download = downloadGet(args.downloadId);
      const uri = downloadFileUri(args.downloadId);
      if (!download || !uri) throw new PlaybackError("playErrDownloadGone", "La descarga ya no está en el dispositivo");
      // A parental limit set after downloading still applies offline.
      if (!downloadPlayable(download)) throw new PlaybackError("parentalBlockedTitle", BLOCKED);
      if (ctx) await stopInner(false);
      const prefs = await loadPrefs();
      const start = Math.max(0, args.startSeconds ?? 0);
      const item = download.movie;
      await load({
        url: uri,
        headers: {},
        contentType: "progressive",
        metadata: metadataForItem(args.title, item),
        title: args.title,
        startSeconds: start,
        prefs,
        speed: speedFromPrefs(prefs),
        ctx: {
          source: {
            kind: "offline",
            downloadId: download.id,
            itemId: download.source === "jellyfin" ? download.id : null,
            entry: args.entry ?? null,
          },
          title: args.title,
          url: uri,
        },
        fallbackTried: true,
      });
      return snapshot();
    } catch (error) {
      emitError(error, null, false);
      throw error;
    }
  });
}

/** Settings › Playback › background audio changed while something plays. */
function setBackgroundPlayback(on: boolean): void {
  if (ctx) applyBackground(on);
}

async function playerStartUrl(args: {
  url: string;
  title: string;
  headers: [string, string][];
  startSeconds?: number;
  entry: ResumeEntryBase;
}): Promise<PlayerState> {
  return serialized(async () => {
    try {
      if (!/^https?:\/\//i.test(args.url)) {
        throw new PlaybackError("playErrHttpOnly", "Solo se pueden reproducir enlaces http o https");
      }
      if (!args.entry?.key) throw new PlaybackError("playErrMissingTitle", "Falta el identificador del título");
      if (ctx) await stopInner(false);
      const prefs = await loadPrefs();
      const start = Math.max(0, args.startSeconds ?? 0);
      await load({
        url: args.url,
        headers: headersFromPairs(args.headers ?? []),
        contentType: contentTypeFor(args.url),
        metadata: {
          title: args.title,
          artist: args.entry.seriesName ?? undefined,
          artwork: args.entry.poster ?? undefined,
        },
        title: args.title,
        startSeconds: start,
        prefs,
        speed: speedFromPrefs(prefs),
        ctx: { source: { kind: "addon", entry: args.entry }, title: args.title, url: args.url },
        fallbackTried: true,
      });
      return snapshot();
    } catch (error) {
      emitError(error, args.url ?? null);
      throw error;
    }
  });
}

async function iptvPlay(channelId: string): Promise<PlayerState> {
  return serialized(async () => {
    let url: string | null = null;
    try {
      if (ctx) await stopInner(false);
      const { channel, url: streamUrl, headers } = await resolveChannelPlayback(channelId);
      url = streamUrl;
      const base = await loadPrefs();
      // Live TV always plays at normal speed.
      const prefs: PlaybackPrefs = { ...base, rememberSpeed: false, lastSpeed: 1 };
      await load({
        url: streamUrl,
        headers: headers ?? {},
        contentType: contentTypeFor(streamUrl),
        metadata: {
          title: channel.name,
          artwork: channel.logo && /^https?:\/\//i.test(channel.logo) ? channel.logo : undefined,
        },
        title: channel.name,
        startSeconds: 0,
        prefs,
        speed: 1,
        ctx: { source: { kind: "live", channelId }, title: channel.name, url: streamUrl },
        fallbackTried: true,
      });
      return snapshot();
    } catch (error) {
      emitError(error, url);
      throw error;
    }
  });
}

/** A past programme from the archive of a channel with catch-up. */
async function iptvPlayCatchup(channelId: string, start: number, stop: number, title: string): Promise<PlayerState> {
  return serialized(async () => {
    let url: string | null = null;
    try {
      if (ctx) await stopInner(false);
      const { channel, url: streamUrl, headers } = await resolveCatchupPlayback(channelId, start, stop);
      url = streamUrl;
      const base = await loadPrefs();
      const prefs: PlaybackPrefs = { ...base, rememberSpeed: false, lastSpeed: 1 };
      const label = `${channel.name} · ${title}`;
      await load({
        url: streamUrl,
        headers: headers ?? {},
        contentType: contentTypeFor(streamUrl),
        metadata: {
          title,
          artist: channel.name,
          artwork: channel.logo && /^https?:\/\//i.test(channel.logo) ? channel.logo : undefined,
        },
        title: label,
        startSeconds: 0,
        prefs,
        speed: 1,
        ctx: { source: { kind: "live", channelId }, title: label, url: streamUrl },
        fallbackTried: true,
      });
      return snapshot();
    } catch (error) {
      emitError(error, url);
      throw error;
    }
  });
}

/** `switching`: another item starts right away, so the player screen stays (no `player://close`). */
function playerStop(switching = false): Promise<void> {
  return serialized(() => stopInner(!switching));
}

async function playerTogglePause(): Promise<void> {
  if (!ctx) return;
  try {
    if (safe(() => player.playing, false)) {
      player.pause();
      state.paused = true;
    } else {
      player.play();
      state.paused = false;
    }
  } catch (error) {
    console.warn("[player] toggle pause failed", error);
  }
  push();
}

/** Pause or play outright: a watch party guest follows the host, a toggle could invert it. */
async function playerSetPause(paused: boolean): Promise<void> {
  if (!ctx) return;
  try {
    if (paused) player.pause();
    else player.play();
    state.paused = paused;
  } catch (error) {
    console.warn("[player] set pause failed", error);
  }
  push();
}

/** `fast` is used while scrubbing: seeks are coalesced to one every 200 ms. */
async function playerSeek(seconds: number, relative: boolean, fast = false): Promise<void> {
  if (!ctx || !Number.isFinite(seconds)) return;
  if (isLive()) return;
  const raw = relative ? state.time + seconds : seconds;
  const target = state.duration > 0 ? clamp(raw, 0, state.duration) : Math.max(0, raw);
  if (relative && !fast) {
    state.time = target;
    scratch.seekTarget = target;
    scratch.seekAtMs = Date.now();
    try {
      player.seekBy(seconds);
    } catch (error) {
      console.warn("[player] seek failed", error);
    }
  } else if (fast) {
    scrub(target);
  } else {
    applySeek(target);
  }
  state.eof = false;
  push();
}

async function playerSetSpeed(speed: number): Promise<number> {
  if (isLive()) return state.speed;
  const value = Number.isFinite(speed) ? clamp(speed, SPEED_MIN, SPEED_MAX) : 1;
  try {
    player.playbackRate = value;
  } catch (error) {
    console.warn("[player] set speed failed", error);
  }
  state.speed = value;
  push();
  return value;
}

async function playerSetAspect(mode: string): Promise<void> {
  if (!isAspectMode(mode)) {
    console.warn(`[player] invalid aspect mode: ${mode}`);
    return;
  }
  state.aspect = mode;
  push();
}

async function playerSetVolume(volume: number): Promise<number> {
  const value = Number.isFinite(volume) ? clamp(volume, 0, 100) : state.volume;
  try {
    player.volume = value / 100;
  } catch (error) {
    console.warn("[player] set volume failed", error);
  }
  state.volume = value;
  push();
  return value;
}

async function playerSetMute(mute: boolean): Promise<void> {
  try {
    player.muted = Boolean(mute);
  } catch (error) {
    console.warn("[player] set mute failed", error);
  }
  state.mute = Boolean(mute);
  push();
}

/** Transcoding: the server has to be asked for the other stream (new session, same position). */
async function switchTranscodeTrack(kind: TrackKind, id: number): Promise<void> {
  const current = ctx;
  if (!current || current.source.kind !== "jellyfin") return;
  if (kind === "audio" && id <= 0) return; // the transcoder always carries an audio stream
  const old = current.source;
  const g = gen;
  const time = state.time;
  const paused = state.paused;
  const prefs = scratch.prefs;
  const audioStreamIndex = kind === "audio" ? id : old.playback.audioStreamIndex;
  const subtitleStreamIndex = kind === "sub" ? (id <= 0 ? -1 : id) : (old.playback.subtitleStreamIndex ?? -1);
  try {
    const resolved = await resolvePlayback({
      itemId: old.playback.itemId,
      mediaSourceId: old.mediaSourceId,
      startSeconds: time,
      audioLanguage: prefs.audioLanguage,
      subtitleLanguage: prefs.subtitleLanguage,
      forceTranscode: true,
      audioStreamIndex,
      subtitleStreamIndex,
    });
    if (g !== gen || ctx !== current) return;
    reportStop(old.playback, ticksFromSeconds(time)).catch(() => undefined);
    stopActiveEncodings(old.playback.playSessionId).catch(() => undefined);
    const playback = playbackFromResolved(old.playback.itemId, resolved);
    await load({
      url: resolved.url,
      headers: resolved.headers,
      contentType: resolved.contentType,
      metadata: metadataForItem(current.title, old.item),
      title: current.title,
      startSeconds: time,
      prefs,
      speed: state.speed,
      ctx: { ...current, url: resolved.url, source: { ...old, playback, resolved } },
      fallbackTried: true,
      paused,
    });
    reportStart(playback, ticksFromSeconds(time)).catch(() => undefined);
  } catch (error) {
    emitError(error, null);
  }
}

/** `id <= 0` turns the track off (mpv's `aid=no` / `sid=no`). */
async function playerSetTrack(kind: string, id: number): Promise<void> {
  const k = normalizeKind(kind);
  if (!k || !ctx) return;
  if (isTranscoding()) {
    // Asking for the track already playing would restart the transcode for nothing.
    if (Math.max(0, id) === (k === "audio" ? state.aid : state.sid)) return;
    return serialized(() => switchTranscodeTrack(k, id));
  }
  try {
    if (k === "audio") {
      const track = id <= 0 ? null : (scratch.audioMap.get(id) ?? null);
      if (id > 0 && !track) return;
      player.audioTrack = track;
    } else {
      const track = id <= 0 ? null : (scratch.subMap.get(id) ?? null);
      if (id > 0 && !track) return;
      player.subtitleTrack = track;
    }
  } catch (error) {
    console.warn("[player] set track failed", error);
  }
  rebuildTracks();
  push();
}

/** Landscape + immersive navigation bar while the player is on screen. */
async function playerSetFullscreen(fullscreen: boolean): Promise<void> {
  try {
    if (fullscreen) {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } else {
      await ScreenOrientation.unlockAsync();
    }
  } catch (error) {
    console.warn("[player] orientation change failed", error);
  }
  if (Platform.OS !== "android") return;
  try {
    await NavigationBar.setVisibilityAsync(fullscreen ? "hidden" : "visible");
  } catch (error) {
    console.warn("[player] navigation bar change failed", error);
  }
}

export const engine = {
  /** The one `VideoPlayer`; render it with `<VideoView player={engine.player} />`. */
  player,
  playerStart,
  playerStartUrl,
  playerStartFile,
  setBackgroundPlayback,
  iptvPlay,
  iptvPlayCatchup,
  playerStop,
  playerTogglePause,
  playerSetPause,
  playerSeek,
  playerSetSpeed,
  playerSetAspect,
  playerSetVolume,
  playerSetMute,
  playerSetTrack,
  playerSetFullscreen,
  snapshot,
  aspectBox,
  /** Playback context of the current source (null when idle). */
  context: (): EngineContext | null => ctx,
};

export type Engine = typeof engine;

try {
  // Returned so logout waits for the final report before the session goes away.
  registerSessionCleanup(() => engine.playerStop(false));
} catch (error) {
  console.warn("[player] could not register the session cleanup", error);
}
