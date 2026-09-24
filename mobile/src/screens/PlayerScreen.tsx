import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { VideoView, isPictureInPictureSupported } from "expo-video";
import { StatusBar } from "expo-status-bar";
import * as Brightness from "expo-brightness";
import * as NavigationBar from "expo-navigation-bar";
import * as ScreenOrientation from "expo-screen-orientation";
import { useKeepAwake } from "expo-keep-awake";
import { useFocusEffect } from "@react-navigation/native";
import { ChevronDown, ChevronUp, Cpu, ExternalLink, FastForward, Globe, ListVideo, RotateCcw } from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { File } from "expo-file-system";
import { api } from "../lib/api";
import { engine } from "../services/player/engine";
import { errorActions, errorMessageKey, type ErrorAction, type ErrorSourceKind } from "../services/player/error-actions";
import { offlineStartSeconds } from "../services/downloads/downloads.pure";
import { haptic } from "../lib/haptics";
import type { Channel, EpgNow, MediaSegment, Movie, PlayerState } from "../lib/types";
import { PlaybackError, type PlayerError } from "../services/events";
import { episodeCode, ticksToSeconds } from "../lib/format";
import { nextAspect } from "../lib/aspect";
import { channelToMovie } from "../lib/iptv";
import { nextVideoOf, pickStream, resumeEntryOf, videoToMovie } from "../lib/addons";
import { openInExternalPlayer } from "../lib/external-player";
import { useI18n } from "../lib/locale-context";
import { isParentalBlocked } from "../lib/parental";
import { useSettings } from "../lib/settings-context";
import { useToast } from "../lib/toast-context";
import { decodeSubtitleBytes, parseSubtitles, type Cue } from "../lib/subtitles";
import { useStreamPicker } from "../lib/stream-picker-context";
import { useSegments } from "../hooks/useSegments";
import { useSkipPrompt } from "../hooks/useSkipPrompt";
import { useNextEpisodeCard } from "../hooks/useNextEpisodeCard";
import { usePauseInfo } from "../hooks/usePauseInfo";
import { useBackHandler } from "../navigation/useBackHandler";
import type { MainScreenProps } from "../navigation/types";
import { makeStyles } from "../theme/ThemeProvider";
import { text } from "../theme/typography";
import { useLayout } from "../theme/responsive";
import { Pill } from "../components/ui/Pill";
import { Spinner } from "../components/ui/Spinner";
import {
  CHROME_BOTTOM_HEIGHT,
  ChannelsPanel,
  EpisodesPanel,
  FlashIcon,
  GestureHud,
  LockScreen,
  NextEpisodeCard,
  PauseInfo,
  PlayerChrome,
  PlayerGestures,
  SkipButton,
  SpeedSheet,
  Splash,
  StatsSheet,
  SubtitleOverlay,
  SubtitleTools,
  TimelinePreview,
  TrackSheet,
  formatSpeed,
  type Flash,
  type FlashKind,
  type Hud,
  type PanPhase,
  type PlayerSheet,
  type TapZone,
  type VerticalSide,
} from "../components/player";

const emptyState: PlayerState = {
  time: 0,
  duration: 0,
  paused: false,
  volume: 100,
  mute: false,
  buffering: true,
  eof: false,
  tracks: [],
  aid: 0,
  sid: 0,
  title: "",
  cacheTime: 0,
  speed: 1,
  aspect: "auto",
};

const IS_ANDROID = Platform.OS === "android";
const HIDE_MS = 3000;
const LOCK_HINT_MS = 2000;
const FLASH_MS = 450;
const SPLASH_FADE_MS = 450;
const HUD_MS = 1200;
const SCRUB_THROTTLE_MS = 200;
const EPG_POLL_MS = 30_000;

type Timer = ReturnType<typeof setTimeout> | null;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Full-screen player (port of the desktop `Player` screen, engine and overlay merged).
 * One `<VideoView>` for `engine.player`, the whole control state machine on top, and the
 * three sources of the desktop app: Jellyfin item, online stream and IPTV channel.
 */
export function PlayerScreen({ route, navigation }: MainScreenProps<"Player">) {
  const movie = route.params.movie;
  const s = useStyles();
  const { t } = useI18n();
  const { toast } = useToast();
  const picker = useStreamPicker();
  const { settings, update: updateSettings } = useSettings();
  const layout = useLayout();
  const { width, height, insets } = layout;
  useKeepAwake();

  const [state, setState] = useState<PlayerState>(emptyState);
  const [detail, setDetail] = useState<Movie | null>(null);
  // Controls stay hidden on start (Nuvio); a tap reveals them.
  const [visible, setVisible] = useState(false);
  const [sheet, setSheet] = useState<PlayerSheet>(null);
  const [panel, setPanel] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockHint, setLockHint] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [preview, setPreview] = useState<{ seconds: number; delta: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [splash, setSplash] = useState(true);
  const [nextEpisode, setNextEpisode] = useState<Movie | null>(null);
  const [playError, setPlayError] = useState<PlayerError | null>(null);
  const [zapList, setZapList] = useState<Channel[]>([]);
  const [liveEpg, setLiveEpg] = useState<EpgNow | null>(null);
  /** Subtitle file loaded from the device, drawn by the app (expo-video cannot load it). */
  const [extSub, setExtSub] = useState<{ name: string; cues: Cue[] } | null>(null);
  const [subDelay, setSubDelay] = useState(0);
  /** Bumped by "Retry" to run the start again. */
  const [attempt, setAttempt] = useState(0);
  /** The item plays from a downloaded file (the error card offers the online version). */
  const [offline, setOffline] = useState(false);
  const [pip, setPip] = useState(false);
  /** Speed while a long press holds it (null when not holding). */
  const [holdSpeed, setHoldSpeed] = useState<number | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);
  const videoRef = useRef<VideoView>(null);
  /** How the next start of `movie` should go ("Try transcoding", "Watch online"). */
  const startMode = useRef<{ movie: typeof movie; forceTranscode?: boolean; skipLocal?: boolean } | null>(null);
  const speedBeforeHold = useRef(1);
  const holdingRef = useRef(false);
  const pipSupported = useMemo(() => {
    try {
      return isPictureInPictureSupported();
    } catch {
      return false;
    }
  }, []);

  const remaining = settings.playback.showTimeRemaining;
  const live = movie.live ?? null;
  const timelineMovie = detail ?? movie;
  const isEpisode = movie.kind === "Episode";
  const code = isEpisode ? episodeCode(movie, t("episodeCode")) : "";
  const heading = isEpisode ? movie.seriesName ?? movie.name : movie.name;
  const subheading = isEpisode ? [code, movie.name].filter(Boolean).join(" · ") : live?.group ?? "";

  const mounted = useRef(true);
  /** Pending stop of the previous item; the next start waits for it. */
  const stopping = useRef<Promise<void> | null>(null);
  /** Guards against asking for the next item twice (button + countdown + panel). */
  const nextSent = useRef(false);
  const hideTimer = useRef<Timer>(null);
  const flashTimer = useRef<Timer>(null);
  const hudTimer = useRef<Timer>(null);
  const lockHintTimer = useRef<Timer>(null);
  const overUi = useRef(false);
  const flashSeq = useRef(0);
  const flashKind = useRef<FlashKind | null>(null);
  const flashAmount = useRef(0);
  const panBase = useRef(0);
  const panApplied = useRef(-1);
  const brightness = useRef(1);
  const brightnessTaken = useRef(false);
  const brightnessOnEntry = useRef(1);
  const scrubBase = useRef(0);
  const lastScrubAt = useRef(0);
  const lastPreview = useRef(-1);
  /** Re-shows the skip prompt on activity (set once the hook below exists). */
  const revealRef = useRef<() => void>(() => undefined);
  const lockedRef = useRef(false);
  const visibleRef = useRef(false);
  const stateRef = useRef(state);
  const toastRef = useRef(toast);
  const tRef = useRef(t);
  const exitRef = useRef<() => void>(() => undefined);
  lockedRef.current = locked;
  visibleRef.current = visible;
  stateRef.current = state;
  toastRef.current = toast;
  tRef.current = t;

  const showLockHint = () => {
    setLockHint(true);
    if (lockHintTimer.current) clearTimeout(lockHintTimer.current);
    lockHintTimer.current = setTimeout(() => setLockHint(false), LOCK_HINT_MS);
  };

  const bump = () => {
    if (lockedRef.current) {
      showLockHint();
      return;
    }
    setVisible(true);
    revealRef.current();
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (overUi.current) return;
    hideTimer.current = setTimeout(() => {
      if (!overUi.current) setVisible(false);
    }, HIDE_MS);
  };

  const hideChrome = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setVisible(false);
  };

  const holdUi = (hold: boolean) => {
    overUi.current = hold;
    if (hold) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setVisible(true);
    } else {
      bump();
    }
  };

  const exit = () => {
    void api.playerStop(false);
    if (navigation.canGoBack()) navigation.goBack();
  };
  exitRef.current = exit;

  // Declared before the start effect so that, on unmount, its cleanup runs first and the
  // stop below knows whether the player is closing or just switching items.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlistenState = api.onPlayerState(setState);
    const unlistenError = api.onPlayerError((failure) => {
      setPlayError(failure);
    });
    const start = ticksToSeconds(movie.playbackPositionTicks);

    const begin = async () => {
      // The engine serialises commands: make sure the previous item's stop finished
      // before loading the next one, or it could stop the new file.
      try {
        await stopping.current;
      } catch {
        /* the previous stop failing does not block the new start */
      }
      if (cancelled) return;
      const title =
        movie.kind === "Episode"
          ? [movie.seriesName, episodeCode(movie, "S{s}:E{e}"), movie.name].filter(Boolean).join(" · ")
          : movie.name;
      // A choice from the error card only applies to the item it was made for.
      const mode = startMode.current?.movie === movie ? startMode.current : null;
      try {
        if (movie.live?.catchup) {
          // A past programme from the channel's archive.
          const { start: from, stop, title: programme } = movie.live.catchup;
          const next = await api.iptvPlayCatchup(movie.live.channelId, from, stop, programme);
          if (cancelled) return;
          setState(next);
          return;
        }
        // A finished download plays from the device (also without network).
        const local = movie.live || mode?.skipLocal ? null : api.playableDownload(movie);
        setOffline(Boolean(local));
        if (local) {
          const next = await api.playerStartFile({
            downloadId: local.id,
            title,
            startSeconds: offlineStartSeconds(local, start),
            entry: movie.external ? resumeEntryOf(movie) : null,
          });
          if (cancelled) return;
          setState(next);
          return;
        }
        if (movie.live) {
          // IPTV channel: the engine resolves the stream URL (Xtream credentials stay there).
          const next = await api.iptvPlay(movie.live.channelId);
          if (cancelled) return;
          setState(next);
          return;
        }
        if (movie.external) {
          // Online title: resolve the stream (chosen in the picker, or auto-picked when
          // chaining episodes), work out the next episode and start by URL.
          const ext = movie.external;
          let stream = ext.stream ?? null;
          if (!stream) stream = pickStream(await api.addonStreams(ext.type, ext.videoId), ext.prefer ?? null);
          if (cancelled) return;
          if (!stream?.url) throw new PlaybackError("noStreams", "No streams");
          const prefer = { addonUrl: stream.addonUrl, bingeGroup: stream.bingeGroup };
          let nextMovie: Movie | null = null;
          if (ext.type === "series") {
            try {
              const meta = await api.addonMeta("series", ext.metaId);
              const nextVideo = nextVideoOf(meta, ext.videoId);
              if (nextVideo) {
                const candidate = videoToMovie(meta, nextVideo);
                const candidateExt = candidate.external;
                if (candidateExt) nextMovie = { ...candidate, external: { ...candidateExt, prefer } };
              }
            } catch {
              /* no metadata: no chaining */
            }
          }
          if (cancelled) return;
          const full: Movie = { ...movie, external: { ...ext, stream, prefer, next: nextMovie } };
          const entry = resumeEntryOf(full);
          if (!entry) throw new PlaybackError("playerStartError", "No resume entry");
          const next = await api.playerStartUrl({
            url: stream.url,
            title,
            headers: stream.headers,
            startSeconds: start > 5 ? start : 0,
            entry,
          });
          if (cancelled) return;
          setNextEpisode(nextMovie);
          setState(next);
          return;
        }
        const next = await api.playerStart({
          itemId: movie.id,
          title,
          startSeconds: start > 5 ? start : 0,
          mediaSourceId: movie.mediaSourceId,
          forceTranscode: mode?.forceTranscode,
        });
        if (cancelled) return;
        setState(next);
      } catch (err) {
        if (cancelled) return;
        // Stay on the player with the error, a retry and (online) another source. The
        // engine already reported its own failures (with their code and URL): keep those.
        const transcoding = mode?.forceTranscode === true;
        const failure: PlayerError = isParentalBlocked(err)
          ? {
              message: tRef.current("parentalBlockedTitle"),
              detail: "",
              code: "unknown",
              url: null,
              key: "parentalBlockedTitle",
              transcoding,
            }
          : err instanceof PlaybackError
            ? { message: err.message, detail: "", code: "unknown", url: null, key: err.key, transcoding }
            : {
                message: tRef.current("playerStartError"),
                detail: err instanceof Error ? err.message : "",
                code: "unknown",
                url: null,
                transcoding,
              };
        setPlayError((current) => current ?? failure);
      }
    };

    void begin();

    return () => {
      cancelled = true;
      void unlistenState.then((fn) => fn());
      void unlistenError.then((fn) => fn());
      // Still mounted here means the movie param changed (next episode, version, zapping).
      stopping.current = api.playerStop(mounted.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movie, attempt]);

  // A new item may chain again later; everything item-scoped goes back to its start value.
  useEffect(() => {
    nextSent.current = false;
    setPanel(false);
    setSheet(null);
    setPlayError(null);
    setDetail(null);
    setPreview(null);
    setReady(false);
    setSplash(true);
    setState(emptyState);
    setExtSub(null);
    setSubDelay(0);
    setHoldSpeed(null);
    holdingRef.current = false;
  }, [movie]);

  // A new failure starts with its technical details folded.
  useEffect(() => {
    setErrorOpen(false);
  }, [playError]);

  // Settings › Playback › background audio applies to what is already playing.
  const backgroundAudio = settings.playback.backgroundAudio;
  useEffect(() => {
    engine.setBackgroundPlayback(backgroundAudio);
  }, [backgroundAudio]);

  /** Picks a subtitle file on the device; the app draws it and the embedded track goes off. */
  const pickSubtitleFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ["*/*"], copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const name = asset.name || "subtitles.srt";
      if (!/\.(srt|vtt)$/i.test(name)) {
        toast(t("subUnsupported"));
        return;
      }
      const bytes = await new File(asset.uri).bytes();
      const cues = parseSubtitles(decodeSubtitleBytes(bytes));
      if (!cues.length) {
        toast(t("subEmpty"));
        return;
      }
      void api.playerSetTrack("sub", 0);
      setExtSub({ name, cues });
      setSubDelay(0);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  // Episodes: look up what comes next so the end of the file can chain into it.
  // Online episodes carry their successor (resolved by the start effect above).
  useEffect(() => {
    if (movie.external) {
      setNextEpisode(movie.external.next ?? null);
      return;
    }
    if (movie.kind !== "Episode" || !movie.seriesId) {
      setNextEpisode(null);
      return;
    }
    let alive = true;
    // Never chain into the previous item's successor while this one is looked up.
    setNextEpisode(null);
    api
      .getNextEpisode(movie.seriesId, movie.id)
      .then((next) => {
        if (alive) setNextEpisode(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [movie.external, movie.kind, movie.seriesId, movie.id]);

  // End of file without anything to chain into: leave. With a next episode the card
  // below decides whether and when to continue.
  useEffect(() => {
    if (!state.eof || nextEpisode) return;
    exitRef.current();
  }, [state.eof, nextEpisode]);

  // First frame: the file is loaded once the engine reports a duration or advances time.
  useEffect(() => {
    if (!ready && (state.duration > 0 || state.time > 0)) setReady(true);
  }, [ready, state.duration, state.time]);

  useEffect(() => {
    if (!ready) return;
    const handle = setTimeout(() => setSplash(false), SPLASH_FADE_MS);
    return () => clearTimeout(handle);
  }, [ready]);

  // Items coming from list queries lack trickplay / chapters; fetch the detail once.
  useEffect(() => {
    if (movie.external || movie.live) return;
    if (movie.trickplay || movie.chapters.length) return;
    let alive = true;
    api
      .getItem(movie.id)
      .then((full) => {
        if (alive) setDetail(full);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [movie]);

  // Live TV: channels of the same group for zapping, and the programme on air.
  const liveSourceId = live?.sourceId;
  const liveGroup = live?.group;
  const liveChannelId = live?.channelId;
  useEffect(() => {
    if (!liveSourceId) return;
    let alive = true;
    api
      .iptvChannels({ sourceId: liveSourceId, group: liveGroup, limit: 1000 })
      .then((page) => {
        if (alive) setZapList(page.items);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [liveSourceId, liveGroup]);

  useEffect(() => {
    if (!liveChannelId) return;
    let alive = true;
    const load = () => {
      api
        .iptvEpgNow([liveChannelId])
        .then((map) => {
          if (alive) setLiveEpg(map[liveChannelId] ?? null);
        })
        .catch(() => undefined);
    };
    setLiveEpg(null);
    load();
    const handle = setInterval(load, EPG_POLL_MS);
    return () => {
      alive = false;
      clearInterval(handle);
    };
  }, [liveChannelId]);

  // A sheet or the side panel keeps the chrome on screen.
  useEffect(() => {
    const hold = panel || sheet !== null;
    overUi.current = hold;
    if (hold) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setVisible(true);
    } else if (visibleRef.current) {
      bump();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, sheet]);

  // Landscape, no system bars and the original brightness back on the way out.
  const isTablet = layout.isTablet;
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => undefined);
      if (IS_ANDROID) void NavigationBar.setVisibilityAsync("hidden").catch(() => undefined);
      void (async () => {
        try {
          const current = await Brightness.getBrightnessAsync();
          if (!alive) return;
          // A swipe that came first already owns the current value.
          if (!brightnessTaken.current) brightness.current = current;
          brightnessOnEntry.current = current;
          brightnessTaken.current = true;
        } catch {
          /* brightness is not available on this device */
        }
      })();
      return () => {
        alive = false;
        if (IS_ANDROID) void NavigationBar.setVisibilityAsync("visible").catch(() => undefined);
        if (brightnessTaken.current) {
          brightnessTaken.current = false;
          // Android hands the brightness back to the system setting; iOS has no such
          // call, the screen keeps whatever was set last, so the entry value is put back.
          if (IS_ANDROID) void Brightness.restoreSystemBrightnessAsync().catch(() => undefined);
          else void Brightness.setBrightnessAsync(brightnessOnEntry.current).catch(() => undefined);
        }
        if (isTablet) void ScreenOrientation.unlockAsync().catch(() => undefined);
        else void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
      };
    }, [isTablet]),
  );

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (hudTimer.current) clearTimeout(hudTimer.current);
      if (lockHintTimer.current) clearTimeout(lockHintTimer.current);
    },
    [],
  );

  const showFlash = (kind: FlashKind, step = 0) => {
    flashSeq.current += 1;
    const same = flashKind.current === kind;
    flashAmount.current = step > 0 ? (same ? flashAmount.current + step : step) : 0;
    flashKind.current = kind;
    setFlash({ kind, amount: flashAmount.current, id: flashSeq.current });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      flashKind.current = null;
      flashAmount.current = 0;
      setFlash(null);
    }, FLASH_MS);
  };

  const showHud = (kind: Hud["kind"], value: number) => {
    setHud({ kind, value });
    if (hudTimer.current) clearTimeout(hudTimer.current);
    hudTimer.current = setTimeout(() => setHud(null), HUD_MS);
  };

  const togglePause = async () => {
    showFlash(stateRef.current.paused ? "play" : "pause");
    await api.playerTogglePause();
  };

  const seekBy = (delta: number) => {
    haptic("light");
    showFlash(delta < 0 ? "back" : "fwd", Math.abs(delta));
    void api.playerSeek(delta, true);
  };

  const seekTo = (seconds: number) => {
    void api.playerSeek(seconds, false);
  };

  const setSpeed = (speed: number) => {
    void api.playerSetSpeed(speed);
    if (settings.playback.rememberSpeed) void updateSettings({ playback: { lastSpeed: speed } });
  };

  const toggleRemaining = () => {
    void updateSettings({ playback: { showTimeRemaining: !remaining } });
  };

  const cycleAspect = () => {
    void api.playerSetAspect(nextAspect(stateRef.current.aspect));
  };

  const playNext = () => {
    if (!nextEpisode || nextSent.current) return;
    nextSent.current = true;
    navigation.setParams({ movie: nextEpisode });
  };

  const playFromPanel = (target: Movie) => {
    if (nextSent.current) return;
    nextSent.current = true;
    setPanel(false);
    navigation.setParams({ movie: target });
  };

  const playChannel = (channel: Channel) => {
    if (!live || nextSent.current || (channel.id === live.channelId && !live.catchup)) return;
    nextSent.current = true;
    setPanel(false);
    // A light tick confirms the zap before the new stream shows up.
    void Haptics.selectionAsync().catch(() => undefined);
    navigation.setParams({ movie: channelToMovie(channel, live.sourceName) });
  };

  /** Previous / next channel of the group (wraps around). */
  const zap = (dir: 1 | -1) => {
    if (!live || !zapList.length) return;
    const index = zapList.findIndex((channel) => channel.id === live.channelId);
    const target = zapList[((index < 0 ? 0 : index + dir) + zapList.length) % zapList.length];
    if (target) playChannel(target);
  };

  const lock = () => {
    haptic("medium");
    setLocked(true);
    setSheet(null);
    setPanel(false);
    hideChrome();
    showLockHint();
  };

  const unlock = () => {
    haptic("medium");
    setLocked(false);
    setLockHint(false);
    if (lockHintTimer.current) clearTimeout(lockHintTimer.current);
    // Reveal the controls right away so the user sees where they are.
    setTimeout(bump, 0);
  };

  const escape = () => {
    if (panel) {
      setPanel(false);
      return;
    }
    if (sheet) {
      setSheet(null);
      return;
    }
    exit();
  };

  useBackHandler(true, () => {
    if (locked) {
      showLockHint();
      return true;
    }
    escape();
    return true;
  });

  // Gestures -----------------------------------------------------------------

  const onSingleTap = () => {
    if (visibleRef.current) hideChrome();
    else bump();
  };

  const onDoubleTap = (zone: TapZone) => {
    if (zone === "centre") {
      void togglePause();
      return;
    }
    if (live) return;
    const step = settings.playback.seekStep;
    seekBy(zone === "left" ? -step : step);
  };

  const onVerticalPan = (side: VerticalSide, phase: PanPhase, fraction: number) => {
    if (phase === "start") {
      panBase.current = side === "left" ? brightness.current : stateRef.current.volume / 100;
      panApplied.current = -1;
    }
    const value = clamp(panBase.current + fraction, 0, 1);
    const pct = Math.round(value * 100);
    // Only act (and re-render the HUD) when the whole percent actually moved.
    if (pct === panApplied.current) return;
    panApplied.current = pct;
    showHud(side === "left" ? "brightness" : "volume", pct);
    if (side === "left") {
      brightness.current = value;
      // Changed before the entry value was read: still hand it back on the way out.
      brightnessTaken.current = true;
      void Brightness.setBrightnessAsync(value).catch(() => undefined);
    } else {
      void api.playerSetVolume(pct);
    }
  };

  const onScrubGesture = (phase: PanPhase, dx: number) => {
    const { duration, time } = stateRef.current;
    if (duration <= 0) return;
    if (phase === "start") {
      scrubBase.current = time;
      lastScrubAt.current = 0;
      lastPreview.current = -1;
      holdUi(true);
    }
    // A full swipe across the screen covers a fifth of the file (1 to 10 minutes).
    const span = clamp(duration * 0.2, 60, 600);
    const target = clamp(scrubBase.current + (dx / Math.max(1, width)) * span, 0, Math.max(0, duration - 1));
    if (phase === "start" || phase === "move") {
      const second = Math.round(target);
      if (second !== lastPreview.current) {
        lastPreview.current = second;
        setPreview({ seconds: target, delta: target - scrubBase.current });
      }
      const now = Date.now();
      if (now - lastScrubAt.current >= SCRUB_THROTTLE_MS) {
        lastScrubAt.current = now;
        void api.playerSeek(target, false, true);
      }
      return;
    }
    if (phase === "end") seekTo(target);
    setPreview(null);
    holdUi(false);
  };

  /** Long press: double speed while the finger stays down, the previous speed after. */
  const onHold = (holding: boolean) => {
    if (holding) {
      if (live || stateRef.current.duration <= 0 || stateRef.current.paused) return;
      speedBeforeHold.current = stateRef.current.speed;
      const boosted = Math.min(4, Math.max(2, speedBeforeHold.current * 2));
      haptic("medium");
      holdingRef.current = true;
      setHoldSpeed(boosted);
      void api.playerSetSpeed(boosted);
      return;
    }
    if (!holdingRef.current) return;
    holdingRef.current = false;
    haptic("light");
    setHoldSpeed(null);
    void api.playerSetSpeed(speedBeforeHold.current);
  };

  const enterPip = () => {
    setSheet(null);
    setPanel(false);
    void videoRef.current?.startPictureInPicture().catch((err: unknown) => {
      toast(err instanceof Error ? err.message : String(err));
    });
  };

  /** Runs the start again, optionally another way (transcoded, or online instead of the file). */
  const restart = (mode: { forceTranscode?: boolean; skipLocal?: boolean } | null) => {
    if (mode) startMode.current = { movie, ...mode };
    setPlayError(null);
    setAttempt((n) => n + 1);
  };

  const runErrorAction = (action: ErrorAction) => {
    switch (action) {
      case "transcode":
        restart({ forceTranscode: true });
        break;
      case "stream":
        restart({ skipLocal: true });
        break;
      case "source":
        picker.open(movie);
        break;
      case "retry":
        restart(null);
        break;
      case "external":
        if (playError?.url) void openInExternalPlayer(playError.url).catch(() => undefined);
        break;
    }
  };

  const onPinch = (scale: number) => {
    if (scale > 1.1) void api.playerSetAspect("fill");
    else if (scale < 0.9) void api.playerSetAspect("auto");
  };

  // Skip intro / recap / credits and the next-episode card ---------------------

  const segments: MediaSegment[] = useSegments(movie, state.duration, !live);
  const outro = segments.find((segment) => segment.kind === "outro") ?? null;
  const skipPrompt = useSkipPrompt({
    segments,
    time: state.time,
    duration: state.duration,
    ready,
    settings,
    controlsVisible: visible,
    nextEpisode,
    onSeekTo: seekTo,
    onPlayNext: playNext,
  });
  revealRef.current = skipPrompt.reveal;
  const nextCard = useNextEpisodeCard({
    nextEpisode,
    outro,
    time: state.time,
    duration: state.duration,
    eof: state.eof,
    ready,
    countdownSeconds: settings.playback.nextEpisodeCountdown,
    onPlayNext: playNext,
  });
  const pauseInfo = usePauseInfo(state.paused, visible);
  /** Intro / recap / credits name under a scrub position. */
  const segmentLabelAt = (seconds: number): string | null => {
    const hit = segments.find((segment) => seconds >= segment.startSeconds && seconds < segment.endSeconds);
    if (!hit) return null;
    const key = hit.kind === "intro" ? "segIntro" : hit.kind === "recap" ? "segRecap" : hit.kind === "outro" ? "segOutro" : hit.kind === "preview" ? "segPreview" : "segCommercial";
    return t(key);
  };

  // Render --------------------------------------------------------------------

  const box = engine.aspectBox(state.aspect, width, height);
  const panelWidth = Math.min(420, width * 0.5);
  const cardRight = 24 + insets.right;
  const cardBottom = insets.bottom + (visible ? CHROME_BOTTOM_HEIGHT : 24);
  const gesturesEnabled = !locked && !panel && sheet === null && !pip;
  const errorSource: ErrorSourceKind = live ? "live" : offline ? "offline" : movie.external ? "addon" : "jellyfin";
  const actions = playError
    ? errorActions({ source: errorSource, code: playError.code, transcoding: Boolean(playError.transcoding), hasUrl: Boolean(playError.url) })
    : [];
  // A translated failure (`key`) has no technical text worth showing.
  const errorDetail = playError ? playError.detail || (playError.key ? "" : playError.message) : "";
  const actionMeta: Record<ErrorAction, { label: string; icon: typeof RotateCcw }> = {
    transcode: { label: t("tryTranscoding"), icon: Cpu },
    stream: { label: t("streamOnline"), icon: Globe },
    source: { label: t("chooseAnotherSource"), icon: ListVideo },
    retry: { label: t("retry"), icon: RotateCcw },
    external: { label: t("openExternalPlayer"), icon: ExternalLink },
  };

  return (
    <View style={s.root}>
      <StatusBar hidden style="light" />

      <View pointerEvents="none" style={s.videoWrap}>
        <VideoView
          ref={videoRef}
          player={engine.player}
          nativeControls={false}
          allowsPictureInPicture={pipSupported}
          // Leaving the app while playing floats the video (Settings › Playback).
          startsPictureInPictureAutomatically={pipSupported && settings.playback.autoPip && !state.paused && !playError}
          onPictureInPictureStart={() => {
            setPip(true);
            setSheet(null);
            setPanel(false);
            hideChrome();
          }}
          onPictureInPictureStop={() => setPip(false)}
          contentFit={box.contentFit}
          style={{ width: box.width, height: box.height }}
        />
      </View>

      {/* In picture-in-picture (Android shows the whole screen shrunk) only the video stays. */}
      {pip ? null : (
        <>
          <PlayerGestures
            enabled={gesturesEnabled}
            scrubEnabled={!live && state.duration > 0}
            width={width}
            height={height}
            onSingleTap={onSingleTap}
            onDoubleTap={onDoubleTap}
            onVerticalPan={onVerticalPan}
            onScrub={onScrubGesture}
            onPinch={onPinch}
            onHold={onHold}
          />

          {splash ? <Splash movie={movie} heading={heading} subheading={subheading} showYear={!isEpisode} /> : null}

          {state.buffering && !splash ? (
            <View pointerEvents="none" style={s.centre}>
              <Spinner size={56} thickness={2} />
            </View>
          ) : null}

          {extSub ? (
            <SubtitleOverlay
              cues={extSub.cues}
              time={state.time}
              delay={subDelay}
              scale={settings.playback.subScale}
              color={settings.playback.subColor}
              background={settings.playback.subBackground}
              position={settings.playback.subPosition}
              frameHeight={height}
              topInset={insets.top + (visible ? 72 : 20)}
              bottom={insets.bottom + (visible ? CHROME_BOTTOM_HEIGHT + 8 : 28)}
            />
          ) : null}

          {holdSpeed != null ? (
            <View pointerEvents="none" style={[s.holdPill, { top: insets.top + 20 }]}>
              <FastForward size={14} color="#ffffff" fill="#ffffff" />
              <Text style={s.holdText}>{t("holdSpeed", { speed: formatSpeed(holdSpeed) })}</Text>
            </View>
          ) : null}

          {flash ? <FlashIcon key={flash.id} flash={flash} width={width} /> : null}

          {hud ? <GestureHud hud={hud} top={insets.top + 20} /> : null}

          {preview ? (
            <View pointerEvents="none" style={s.preview}>
              <TimelinePreview
                key={timelineMovie.id}
                movie={timelineMovie}
                seconds={preview.seconds}
                delta={preview.delta}
                label={segmentLabelAt(preview.seconds)}
              />
            </View>
          ) : null}

          {!locked && !live && pauseInfo && !splash && !panel && sheet === null && layout.wide ? (
            <PauseInfo movie={detail ?? movie} heading={heading} top={insets.top + 72} left={24 + insets.left} />
          ) : null}

          {locked ? null : nextEpisode && nextCard.visible ? (
            <NextEpisodeCard
              episode={nextEpisode}
              countdown={nextCard.countdown}
              onPlay={playNext}
              onDismiss={nextCard.dismiss}
              right={cardRight}
              bottom={cardBottom}
            />
          ) : skipPrompt.prompt ? (
            <SkipButton
              key={`${skipPrompt.prompt.key}:${skipPrompt.prompt.showId}`}
              label={t(skipPrompt.prompt.labelKey)}
              onSkip={skipPrompt.skip}
              onDismiss={skipPrompt.dismiss}
              right={cardRight}
              bottom={cardBottom}
            />
          ) : null}

          {playError && !locked ? (
            <View style={s.errorOverlay}>
              <View style={s.errorCard}>
                <Text style={s.errorTitle}>{t("playbackFailed")}</Text>
                <Text style={s.errorBody}>{t(playError.key ?? errorMessageKey(playError.code))}</Text>
                <View style={s.errorActions}>
                  {actions.map((action, i) => (
                    <Pill
                      key={action}
                      variant={i === 0 ? "primary" : "tonal"}
                      size="sm"
                      pill
                      icon={actionMeta[action].icon}
                      label={actionMeta[action].label}
                      onPress={() => runErrorAction(action)}
                    />
                  ))}
                  <Pill variant="ghost" size="sm" pill label={t("back")} onPress={exit} />
                </View>
                {errorDetail ? (
                  <View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: errorOpen }}
                      hitSlop={8}
                      onPress={() => setErrorOpen((open) => !open)}
                      style={s.detailsToggle}
                    >
                      <Text style={s.detailsLabel}>{t("errorDetails")}</Text>
                      {errorOpen ? <ChevronUp size={14} color="#9a9a9a" /> : <ChevronDown size={14} color="#9a9a9a" />}
                    </Pressable>
                    {errorOpen ? (
                      <Text selectable style={s.errorDetail}>
                        {errorDetail}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          {locked ? (
            <LockScreen hint={lockHint} onUnlock={unlock} onHint={showLockHint} />
          ) : (
            <PlayerChrome
              movie={movie}
              timelineMovie={timelineMovie}
              segments={segments}
              state={state}
              visible={visible}
              sheet={sheet}
              remaining={remaining}
              panelOpen={panel}
              live={
                live?.catchup
                  ? {
                      number: live.number,
                      now: { start: live.catchup.start, stop: live.catchup.stop, title: live.catchup.title, desc: null, category: null },
                      next: null,
                      catchup: true,
                    }
                  : live
                    ? { number: live.number, now: liveEpg?.now ?? null, next: liveEpg?.next ?? null }
                    : null
              }
              onSheet={setSheet}
              onToggleRemaining={toggleRemaining}
              onBack={exit}
              onTogglePause={() => void togglePause()}
              onSeek={seekBy}
              onSeekTo={seekTo}
              onScrub={(seconds) => void api.playerSeek(seconds, false, true)}
              onMute={() => void api.playerSetMute(!stateRef.current.mute)}
              onAspect={cycleAspect}
              onLock={lock}
              onPanel={() => {
                setSheet(null);
                setPanel((open) => !open);
              }}
              onZap={zap}
              externalSub={extSub?.name ?? null}
              onPip={pipSupported ? enterPip : null}
              onReveal={bump}
              onHoldUi={holdUi}
            />
          )}

          {live ? (
            <ChannelsPanel
              visible={panel && !locked}
              live={live}
              channels={zapList}
              width={panelWidth}
              onPlay={playChannel}
              onClose={() => setPanel(false)}
            />
          ) : (
            <EpisodesPanel
              key={movie.id}
              visible={panel && !locked}
              movie={movie}
              time={state.time}
              duration={state.duration}
              width={panelWidth}
              onPlay={playFromPanel}
              onClose={() => setPanel(false)}
            />
          )}

          <TrackSheet
            kind={sheet === "audio" ? "audio" : "sub"}
            visible={sheet === "audio" || sheet === "sub"}
            tracks={state.tracks}
            onSelect={(kind, id) => {
              // Picking any embedded subtitle (or "off") drops the file the app was drawing.
              if (kind === "sub") setExtSub(null);
              void api.playerSetTrack(kind, id);
            }}
            onClose={() => setSheet(null)}
            footer={
              sheet === "sub" ? (
                <SubtitleTools
                  fileName={extSub?.name ?? null}
                  delay={subDelay}
                  onDelay={(value) => setSubDelay(Math.max(-30, Math.min(30, value)))}
                  onPickFile={() => void pickSubtitleFile()}
                  onClearFile={() => setExtSub(null)}
                />
              ) : null
            }
          />

          <StatsSheet visible={sheet === "stats"} state={state} subDelay={subDelay} onClose={() => setSheet(null)} />

          <SpeedSheet visible={sheet === "speed"} speed={state.speed} onSelect={setSpeed} onClose={() => setSheet(null)} />
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: "#000000" },
  videoWrap: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  centre: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", zIndex: 11 },
  preview: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", zIndex: 26 },
  errorOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 31,
  },
  errorCard: {
    width: "100%",
    maxWidth: 520,
    padding: 20,
    gap: 8,
    borderRadius: t.radii.card,
    backgroundColor: t.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.white(0.08),
  },
  errorTitle: { ...text(16, "semibold"), color: t.colors.text },
  errorBody: { ...text(13, "regular", { lineHeight: 19 }), color: t.colors.muted },
  errorDetail: { ...text(11, "regular", { lineHeight: 15 }), color: t.colors.dim, marginTop: 4 },
  errorActions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  detailsToggle: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", marginTop: 6, paddingVertical: 4 },
  detailsLabel: { ...text(12, "medium"), color: t.colors.dim },
  holdPill: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: t.radii.pill,
    backgroundColor: t.black(0.6),
    zIndex: 27,
  },
  holdText: { ...text(13, "semibold", { tabular: true }), color: "#ffffff" },
}));
