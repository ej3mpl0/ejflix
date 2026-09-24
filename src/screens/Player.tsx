import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { PlayerControls, type PlayerMenu } from "../components/PlayerControls";
import { SPEEDS } from "../components/SpeedMenu";
import { QualityBadges } from "../components/QualityBadge";
import { SkipButton } from "../components/SkipButton";
import { NextEpisodeCard } from "../components/NextEpisodeCard";
import { LockScreen } from "../components/LockScreen";
import { PauseInfo } from "../components/PauseInfo";
import { EpisodesPanel } from "../components/EpisodesPanel";
import { ChannelsPanel } from "../components/ChannelsPanel";
import { api } from "../lib/api";
import type { Channel, EpgNow, Movie, PlayerState, TorrentStatus } from "../lib/types";
import { channelToMovie } from "../lib/iptv";
import { episodeCode, ticksToSeconds } from "../lib/format";
import { nextAspect } from "../lib/aspect";
import { isSeriesEpisode, nextVideoOf, pickStream, resumeEntryOf, videoToMovie } from "../lib/addons";
import { useI18n } from "../lib/locale-context";
import { useSettings } from "../lib/settings-context";
import { useSegments } from "../hooks/useSegments";
import { useSkipPrompt } from "../hooks/useSkipPrompt";
import { useNextEpisodeCard } from "../hooks/useNextEpisodeCard";
import { usePauseInfo } from "../hooks/usePauseInfo";
import { ShortcutsHelp } from "../components/ShortcutsHelp";
import { StartCover } from "../components/StartCover";
import { StatsPanel } from "../components/StatsPanel";
import { MiniPlayerControls } from "../components/MiniPlayerControls";
import { SubtitleSearch } from "../components/SubtitleSearch";

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
  subDelay: 0,
  audioDelay: 0,
  night: false,
  mini: false,
};

const OSD_MS = 1400;

const LOCK_HINT_MS = 2000;

type Flash = "play" | "pause" | "back" | "fwd";

export function Player({
  movie,
  mode = "engine",
  onExit,
  onError,
}: {
  movie: Movie;
  mode?: "engine" | "overlay";
  onExit: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const { settings, update: updateSettings } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [state, setState] = useState<PlayerState>(emptyState);
  /** What the splash says while a source is still being prepared (torrent peers). */
  const [startHint, setStartHint] = useState("");
  /** Starting failed: the cover shows it with retry / other source instead of leaving. */
  const [startError, setStartError] = useState<string | null>(null);
  /** Bumped by "Retry" to run the start again. */
  const [attempt, setAttempt] = useState(0);
  /** Info hash of the torrent being opened (engine side) or played (overlay side). */
  const [torrentHash, setTorrentHash] = useState<string | null>(null);
  const [torrent, setTorrent] = useState<TorrentStatus | null>(null);
  const [detail, setDetail] = useState<Movie | null>(null);
  // Controls stay hidden on start (Nuvio); any mouse or key activity reveals them.
  const [visible, setVisible] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [menu, setMenu] = useState<PlayerMenu>(null);
  const [panel, setPanel] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockHint, setLockHint] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  /** "?" overlay with the keyboard shortcuts. */
  const [help, setHelp] = useState(false);
  /** Subtitle and audio delays of this file (remembered per title, reapplied by Rust on start). */
  const delays = { sub: state.subDelay, audio: state.audioDelay };
  /** OpenSubtitles search dialog. */
  const [subSearch, setSubSearch] = useState(false);
  /** Short on-screen message (delay changed, night mode...). */
  const [osd, setOsd] = useState<string | null>(null);
  const osdTimer = useRef<number>(0);
  const mini = state.mini;
  /** Technical numbers overlay (I). */
  const [stats, setStats] = useState(false);
  /** Subtitle track to bring back when V turns subtitles on again. */
  const lastSub = useRef<number | null>(null);
  const [volHud, setVolHud] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [splash, setSplash] = useState(true);
  const remaining = settings.playback.showTimeRemaining;
  const [nextEpisode, setNextEpisode] = useState<Movie | null>(null);
  const mounted = useRef(true);
  /** Re-shows the skip prompt on mouse/keyboard activity (set once the hook exists). */
  const revealRef = useRef<() => void>(() => undefined);
  /** Pending stop of the previous item; the next start waits for it (engine mode). */
  const stopping = useRef<Promise<void> | null>(null);
  /** Guards against asking for the next episode twice (button + countdown). */
  const nextSent = useRef(false);
  const hideTimer = useRef<number>(0);
  const volTimer = useRef<number>(0);
  const flashTimer = useRef<number>(0);
  const clickTimer = useRef<number>(0);
  const lockHintTimer = useRef<number>(0);
  const overUi = useRef(false);
  const lockedRef = useRef(false);
  lockedRef.current = locked;
  const overlay = mode === "overlay";
  /** IPTV channel: no timeline, arrows and the wheel (optionally) change channel. */
  const live = movie.live ?? null;
  const timelineMovie = detail ?? movie;
  const isEpisode = movie.kind === "Episode";
  const code = isEpisode ? episodeCode(movie, t("episodeCode")) : "";
  const heading = isEpisode ? (movie.seriesName ?? movie.name) : movie.name;
  const subheading = isEpisode ? [code, movie.name].filter(Boolean).join(" · ") : live?.group ?? "";

  const showLockHint = () => {
    setLockHint(true);
    window.clearTimeout(lockHintTimer.current);
    lockHintTimer.current = window.setTimeout(() => setLockHint(false), LOCK_HINT_MS);
  };

  const bump = () => {
    if (lockedRef.current) {
      showLockHint();
      return;
    }
    setVisible(true);
    revealRef.current();
    window.clearTimeout(hideTimer.current);
    if (overUi.current) return;
    hideTimer.current = window.setTimeout(() => {
      if (overUi.current) return;
      setVisible(false);
    }, 3000);
  };

  const holdUi = (hold: boolean) => {
    overUi.current = hold;
    if (hold) {
      window.clearTimeout(hideTimer.current);
      setVisible(true);
    } else {
      bump();
    }
  };

  // Latest values for callbacks registered once (event listeners).
  const onErrorRef = useRef(onError);
  const onExitRef = useRef(onExit);
  const tRef = useRef(t);
  const stateRef = useRef(state);
  const hotkeyRef = useRef<(key: string) => void>(() => undefined);
  const keydownRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  const wheelRef = useRef<(deltaY: number) => void>(() => undefined);
  onErrorRef.current = onError;
  onExitRef.current = onExit;
  tRef.current = t;
  stateRef.current = state;

  // Declared before the start effect so that, on unmount, its cleanup runs first and
  // the stop below knows whether the player is closing or just switching items.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlistenState = api.onPlayerState(setState);
    const unlistenHotkey = api.onPlayerHotkey((key) => hotkeyRef.current(key));
    // The start's own state event went out before this overlay mounted (delays, mini...).
    if (overlay) {
      api
        .playerState()
        .then((current) => {
          if (!cancelled) setState(current);
        })
        .catch(() => undefined);
    }

    if (!overlay) {
      const start = ticksToSeconds(movie.playbackPositionTicks);
      const title = isEpisode
        ? [movie.seriesName, episodeCode(movie, "S{s}:E{e}"), movie.name].filter(Boolean).join(" · ")
        : movie.name;
      const begin = async () => {
        // Commands run concurrently on the backend: make sure the previous item's
        // stop has finished before loading the next one, or it could stop the new file.
        try {
          await stopping.current;
        } catch {
          /* the previous stop failing does not block the new start */
        }
        if (cancelled) return;
        try {
          if (movie.live) {
            // IPTV channel: Rust resolves the stream URL (Xtream credentials stay there).
            const next = await api.iptvPlay(movie.live.channelId);
            if (cancelled) return;
            void api.openPlayer(movie);
            setState(next);
            return;
          }
          if (movie.external) {
            // Online title: resolve the stream (chosen in the picker, or auto-picked when
            // chaining episodes), work out the next episode and start by URL.
            const ext = movie.external;
            const torrents = settingsRef.current.torrents.enabled;
            let stream = ext.stream ?? null;
            if (!stream) {
              stream = pickStream(await api.addonStreams(ext.type, ext.videoId), ext.prefer ?? null, torrents);
            }
            if (cancelled) return;
            let url = stream?.url ?? null;
            if (!url && stream?.infoHash && torrents) {
              // A bare torrent: the built-in engine turns it into a local URL first.
              setStartHint(tRef.current("torrentConnecting"));
              setTorrentHash(stream.infoHash);
              const resolved = await api.torrentResolve({
                infoHash: stream.infoHash,
                fileIdx: stream.fileIdx,
                sources: stream.sources,
              });
              if (cancelled) return;
              setStartHint("");
              url = resolved.url;
            }
            if (!stream || !url) throw new Error(tRef.current("noStreams"));
            const prefer = { addonUrl: stream.addonUrl, bingeGroup: stream.bingeGroup };
            let nextMovie: Movie | null = null;
            if (ext.type === "series") {
              try {
                const meta = await api.addonMeta("series", ext.metaId);
                const nextVideo = nextVideoOf(meta, ext.videoId);
                if (nextVideo) {
                  const candidate = videoToMovie(meta, nextVideo);
                  nextMovie = { ...candidate, external: { ...candidate.external!, prefer } };
                }
              } catch {
                /* no metadata: no chaining */
              }
            }
            if (cancelled) return;
            const full: Movie = { ...movie, external: { ...ext, stream, prefer, next: nextMovie } };
            const entry = resumeEntryOf(full);
            if (!entry) throw new Error(tRef.current("playerStartError"));
            const next = await api.playerStartUrl({
              url,
              title,
              headers: stream.headers,
              startSeconds: start > 5 ? start : 0,
              entry,
            });
            if (cancelled) return;
            void api.openPlayer(full);
            setState(next);
            return;
          }
          const next = await api.playerStart({
            itemId: movie.id,
            title,
            startSeconds: start > 5 ? start : 0,
            mediaSourceId: movie.mediaSourceId,
          });
          if (cancelled) return;
          void api.openPlayer(movie);
          setState(next);
        } catch (err) {
          if (cancelled) return;
          setStartHint("");
          setStartError(err instanceof Error ? err.message : tRef.current("playerStartError"));
        }
      };
      void begin();
    }

    return () => {
      cancelled = true;
      void unlistenState.then((fn) => fn());
      void unlistenHotkey.then((fn) => fn());
      // Still mounted here means the movie prop changed (next episode): keep the window.
      if (!overlay) stopping.current = api.playerStop(mounted.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movie, overlay, attempt]);

  // Live peers / speed of the torrent while it opens (engine) or plays (overlay).
  const playingHash = overlay ? (movie.external?.stream?.infoHash ?? null) : torrentHash;
  useEffect(() => {
    if (!playingHash) {
      setTorrent(null);
      return;
    }
    let alive = true;
    const load = () => {
      api
        .torrentStatus(playingHash)
        .then((status) => {
          if (alive) setTorrent(status);
        })
        .catch(() => undefined);
    };
    load();
    const handle = window.setInterval(load, 1000);
    return () => {
      alive = false;
      window.clearInterval(handle);
    };
  }, [playingHash]);

  // A new item (next episode, another version) may chain again later.
  useEffect(() => {
    nextSent.current = false;
    setPanel(false);
    setSubSearch(false);
  }, [movie]);

  const showOsd = (text: string) => {
    setOsd(text);
    window.clearTimeout(osdTimer.current);
    osdTimer.current = window.setTimeout(() => setOsd(null), OSD_MS);
  };

  const changeDelay = (kind: "sub" | "audio", seconds: number) => {
    const value = Math.max(-30, Math.min(30, Math.round(seconds * 10) / 10));
    // Shown right away; mpv confirms it through the state events. Rust remembers it for the title.
    setState((current) => ({ ...current, [kind === "sub" ? "subDelay" : "audioDelay"]: value }));
    showOsd(`${t(kind === "sub" ? "subDelay" : "audioDelay")}: ${value > 0 ? "+" : ""}${value.toFixed(1)} s`);
    void api.playerSetDelay(kind, value).catch(() => undefined);
  };

  const toggleNight = () => {
    const on = !stateRef.current.night;
    setState((current) => ({ ...current, night: on }));
    showOsd(on ? t("nightModeOn") : t("nightModeOff"));
    void api.playerSetNight(on).catch(() => undefined);
  };

  const toggleMini = async () => {
    setMenu(null);
    setPanel(false);
    setHelp(false);
    if (!stateRef.current.mini) {
      setFullscreen(false);
      await api.playerSetMini(true).catch(() => undefined);
    } else {
      const fs = await api.playerSetMini(false).catch(() => false);
      setFullscreen(fs);
    }
  };

  // Episodes: look up what comes next so the end of the file can chain into it.
  // Online episodes carry their successor already (resolved by the engine side).
  useEffect(() => {
    if (!overlay) return;
    if (movie.external) {
      setNextEpisode(movie.external.next ?? null);
      return;
    }
    if (!isEpisode || !movie.seriesId) return;
    let alive = true;
    api
      .getNextEpisode(movie.seriesId, movie.id)
      .then((next) => {
        if (alive) setNextEpisode(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [overlay, isEpisode, movie.seriesId, movie.id, movie.external]);

  // End of file without anything to chain into: leave the player. With a next episode
  // the card (below) decides whether and when to continue.
  useEffect(() => {
    if (!overlay || !state.eof || nextEpisode) return;
    onExit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, state.eof, nextEpisode]);

  // First frame: the file is loaded once mpv reports a duration or advances time.
  useEffect(() => {
    if (!ready && (state.duration > 0 || state.time > 0)) setReady(true);
  }, [ready, state.duration, state.time]);

  useEffect(() => {
    if (!ready) return;
    const handle = window.setTimeout(() => setSplash(false), 450);
    return () => window.clearTimeout(handle);
  }, [ready]);

  // Items coming from list queries lack trickplay/chapters; fetch the detail once.
  useEffect(() => {
    if (!overlay || movie.external || movie.live) return;
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
  }, [overlay, movie]);

  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => keydownRef.current(e);
    const onMove = () => bump();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (lockedRef.current) return;
      wheelRef.current(e.deltaY);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay]);

  const showFlash = (kind: Flash) => {
    setFlash(kind);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 450);
  };

  const togglePause = async () => {
    showFlash(stateRef.current.paused ? "play" : "pause");
    await api.playerTogglePause();
  };

  const seekBy = (delta: number) => {
    showFlash(delta < 0 ? "back" : "fwd");
    void api.playerSeek(delta, true);
  };

  const seekTo = (seconds: number) => {
    void api.playerSeek(seconds, false);
  };

  const changeVolume = async (value: number) => {
    const next = await api.playerSetVolume(value);
    setVolHud(next);
    window.clearTimeout(volTimer.current);
    volTimer.current = window.setTimeout(() => setVolHud(null), 1200);
  };

  const toggleFullscreen = async () => {
    if (stateRef.current.mini) {
      // From the mini player straight to fullscreen.
      await api.playerSetMini(false).catch(() => false);
      setFullscreen(true);
      await api.playerSetFullscreen(true);
      return;
    }
    const next = !fullscreen;
    setFullscreen(next);
    await api.playerSetFullscreen(next);
  };

  const setSpeed = (speed: number) => {
    void api.playerSetSpeed(speed);
    if (settings.playback.rememberSpeed) void updateSettings({ playback: { lastSpeed: speed } });
  };

  const stepSpeed = (dir: 1 | -1) => {
    const current = stateRef.current.speed;
    let index = SPEEDS.findIndex((s) => Math.abs(s - current) < 0.01);
    if (index < 0) index = SPEEDS.indexOf(1);
    const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, index + dir))];
    setSpeed(next);
  };

  const toggleRemaining = () => {
    void updateSettings({ playback: { showTimeRemaining: !remaining } });
  };

  const playNext = () => {
    if (!nextEpisode || nextSent.current) return;
    nextSent.current = true;
    void api.playNext(nextEpisode);
  };

  // Live TV: channels of the same group for zapping, and the programme on air.
  const [zapList, setZapList] = useState<Channel[]>([]);
  const [liveEpg, setLiveEpg] = useState<EpgNow | null>(null);
  useEffect(() => {
    if (!overlay || !live) return;
    let alive = true;
    api
      .iptvChannels({ sourceId: live.sourceId, group: live.group, limit: 1000 })
      .then((page) => {
        if (alive) setZapList(page.items);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [overlay, live?.sourceId, live?.group]);
  useEffect(() => {
    if (!overlay || !live) return;
    let alive = true;
    const channelId = live.channelId;
    const load = () => {
      api
        .iptvEpgNow([channelId])
        .then((map) => {
          if (alive) setLiveEpg(map[channelId] ?? null);
        })
        .catch(() => undefined);
    };
    setLiveEpg(null);
    load();
    const handle = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(handle);
    };
  }, [overlay, live?.channelId]);

  const playChannel = (channel: Channel) => {
    if (!live || nextSent.current || channel.id === live.channelId) return;
    nextSent.current = true;
    setPanel(false);
    void api.playNext(channelToMovie(channel, live.sourceName));
  };

  /** Previous / next channel of the group (wraps around). */
  const zap = (dir: 1 | -1) => {
    if (!live || !zapList.length) return;
    const index = zapList.findIndex((c) => c.id === live.channelId);
    const target = zapList[((index < 0 ? 0 : index + dir) + zapList.length) % zapList.length];
    if (target) playChannel(target);
  };

  wheelRef.current = (deltaY) => {
    if (live && settings.iptv.wheelZap) zap(deltaY > 0 ? 1 : -1);
    else void changeVolume(stateRef.current.volume + (deltaY < 0 ? 5 : -5));
  };

  // Skip intro / recap / credits and the next-episode card (overlay only).
  const segments = useSegments(movie, state.duration, overlay && !live);
  const outro = segments.find((segment) => segment.kind === "outro") ?? null;
  // Stopping inside the credits marks the title watched (decided in Rust on stop).
  const creditsStart = outro?.startSeconds ?? null;
  useEffect(() => {
    if (!overlay || live) return;
    void api.playerSetCredits(creditsStart).catch(() => undefined);
  }, [overlay, live, creditsStart]);
  const skipPrompt = useSkipPrompt({
    segments,
    time: state.time,
    duration: state.duration,
    ready: overlay && ready,
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
    ready: overlay && ready,
    countdownSeconds: settings.playback.nextEpisodeCountdown,
    onPlayNext: playNext,
  });

  const pauseInfo = usePauseInfo(state.paused, visible);

  const stream = movie.external?.stream ?? null;
  const sourceLabel = live
    ? t("statsSourceLive", { name: live.sourceName })
    : movie.external
      ? stream?.infoHash && !stream.url
        ? t("statsSourceTorrent")
        : t("statsSourceAddon", { name: stream?.addonName ?? "" })
      : t("statsSourceDirect");

  const escape = () => {
    if (help) setHelp(false);
    else if (subSearch) setSubSearch(false);
    else if (panel) setPanel(false);
    else if (menu) setMenu(null);
    else if (stateRef.current.mini) void toggleMini();
    else if (fullscreen) void toggleFullscreen();
    else onExit();
  };

  const togglePanel = () => {
    setPanel((open) => !open);
    setMenu(null);
  };

  const lock = () => {
    setLocked(true);
    setMenu(null);
    setPanel(false);
    setVisible(false);
    window.clearTimeout(hideTimer.current);
    showLockHint();
  };

  const unlock = () => {
    setLocked(false);
    setLockHint(false);
    window.clearTimeout(lockHintTimer.current);
    // Reveal the controls right away so the user sees where they are.
    window.setTimeout(bump, 0);
  };

  const cycleAspect = () => {
    void api.playerSetAspect(nextAspect(stateRef.current.aspect));
  };

  const playFromPanel = (target: Movie) => {
    if (nextSent.current) return;
    nextSent.current = true;
    setPanel(false);
    void api.playNext(target);
  };

  const onVideoClick = () => {
    window.clearTimeout(clickTimer.current);
    if (panel) {
      setPanel(false);
      return;
    }
    if (menu) {
      setMenu(null);
      return;
    }
    clickTimer.current = window.setTimeout(() => void togglePause(), 250);
  };

  const onVideoDoubleClick = () => {
    window.clearTimeout(clickTimer.current);
    if (stateRef.current.mini) void toggleMini();
    else void toggleFullscreen();
  };

  hotkeyRef.current = (key) => {
    if (lockedRef.current) {
      showLockHint();
      return;
    }
    if (key === "escape") escape();
    if (key === "space") void togglePause();
  };

  keydownRef.current = (e) => {
    bump();
    if (lockedRef.current) return;
    // The subtitle search dialog owns the keyboard (its field, its list, Escape).
    if (subSearch) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    // A focused control owns its own keys: the volume slider its arrows, a button Enter/Space.
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target && e.key !== "Escape") {
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      if ((e.key === " " || e.key === "Enter") && (tag === "BUTTON" || target.getAttribute("role") === "menuitemradio")) {
        return;
      }
    }
    const current = stateRef.current;
    switch (e.key) {
      case " ":
      case "k":
      case "K":
        e.preventDefault();
        void togglePause();
        break;
      case "ArrowLeft":
      case "j":
      case "J":
        if (live) zap(-1);
        else seekBy(-settings.playback.seekStep);
        break;
      case "ArrowRight":
      case "l":
      case "L":
        if (live) zap(1);
        else seekBy(settings.playback.seekStep);
        break;
      case "PageUp":
        if (live) {
          e.preventDefault();
          zap(-1);
        }
        break;
      case "PageDown":
        if (live) {
          e.preventDefault();
          zap(1);
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        void changeVolume(current.volume + 5);
        break;
      case "ArrowDown":
        e.preventDefault();
        void changeVolume(current.volume - 5);
        break;
      case "m":
      case "M":
        void api.playerSetMute(!current.mute);
        break;
      case "f":
      case "F":
        void toggleFullscreen();
        break;
      case "<":
        stepSpeed(-1);
        break;
      case ">":
        stepSpeed(1);
        break;
      case "Home":
        seekTo(0);
        break;
      case "End":
        if (current.duration > 0) seekTo(Math.max(0, current.duration - 5));
        break;
      case "Escape":
        escape();
        break;
      case "n":
      case "N":
        playNext();
        break;
      case "Enter":
      case "s":
      case "S":
        if (skipPrompt.prompt) {
          e.preventDefault();
          skipPrompt.skip();
        }
        break;
      case "e":
      case "E":
        if (live || isSeriesEpisode(movie) || movie.mediaSources.length > 1) togglePanel();
        break;
      case "c":
      case "C":
        if (live) togglePanel();
        break;
      case "v":
      case "V": {
        if (live) break;
        const subs = current.tracks.filter((track) => track.kind === "sub");
        const on = subs.find((track) => track.selected);
        if (on) {
          lastSub.current = on.id;
          void api.playerSetTrack("sub", 0);
        } else if (subs.length) {
          const back = subs.find((track) => track.id === lastSub.current) ?? subs[0];
          void api.playerSetTrack("sub", back.id);
        }
        break;
      }
      case "z":
      case "Z":
        if (!live) changeDelay("sub", delays.sub - 0.1);
        break;
      case "x":
      case "X":
        if (!live) changeDelay("sub", delays.sub + 0.1);
        break;
      case "g":
      case "G":
        changeDelay("audio", delays.audio - 0.1);
        break;
      case "h":
      case "H":
        changeDelay("audio", delays.audio + 0.1);
        break;
      case "d":
      case "D":
        toggleNight();
        break;
      case "p":
      case "P":
        void toggleMini();
        break;
      case "i":
      case "I":
        setStats((open) => !open);
        break;
      case "?":
        setHelp((open) => !open);
        setMenu(null);
        break;
      default:
        if (!live && /^[0-9]$/.test(e.key) && current.duration > 0) {
          seekTo((current.duration * Number(e.key)) / 10);
        }
    }
  };

  if (!overlay) {
    return (
      <StartCover
        movie={movie}
        heading={heading}
        subheading={subheading}
        hint={startHint}
        torrent={torrent}
        error={startError}
        onCancel={onExit}
        onRetry={() => {
          setStartError(null);
          setAttempt((n) => n + 1);
        }}
        onOtherSource={
          movie.external
            ? () => {
                // The app reopens the source picker on a failed start.
                onError(startError ?? t("playerStartError"));
                onExit();
              }
            : undefined
        }
      />
    );
  }

  return (
    <div
      className={`relative h-full w-full bg-transparent ${visible ? "" : "cursor-none"}`}
      onMouseMove={bump}
    >
      {splash ? (
        <div className={`pointer-events-none absolute inset-0 z-10 bg-black ${ready ? "splash-out" : ""}`}>
          {movie.backdropUrl ? (
            <img src={movie.backdropUrl} alt="" className="fade-in h-full w-full object-cover opacity-50" />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/30" />
          <div className="absolute inset-0 grid place-items-center">
            <div className="enter flex flex-col items-center gap-5 px-8 text-center">
              {movie.logoUrl ? (
                <img src={movie.logoUrl} alt={heading} className="max-h-[110px] max-w-[min(420px,70vw)] object-contain" />
              ) : (
                <h1 className="text-[clamp(28px,4vw,48px)] leading-[1.05] font-extrabold tracking-[-0.02em] [text-wrap:balance]">
                  {heading}
                </h1>
              )}
              {subheading ? <p className="text-[16px] font-medium text-white/90">{subheading}</p> : null}
              <div className="flex items-center gap-2 text-[13px] text-muted">
                {!isEpisode && movie.year ? <span>{movie.year}</span> : null}
                <QualityBadges badges={movie.badges.slice(0, 4)} />
              </div>
              <div className="mt-2 h-10 w-10 rounded-full border-2 border-white/15 border-t-accent animate-spin" />
              {startHint ? <p className="text-[13px] text-muted">{startHint}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
      {state.buffering && !splash ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <div className="h-14 w-14 rounded-full border-2 border-white/15 border-t-accent animate-spin" />
        </div>
      ) : null}
      {flash ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <div className="flash-icon grid h-20 w-20 place-items-center rounded-full bg-black/40 text-white">
            {flash === "play" ? <Play size={36} fill="currentColor" /> : null}
            {flash === "pause" ? <Pause size={36} /> : null}
            {flash === "back" || flash === "fwd" ? (
              <span className="relative grid place-items-center">
                {flash === "back" ? <RotateCcw size={40} strokeWidth={1.5} /> : <RotateCw size={40} strokeWidth={1.5} />}
                <span className="absolute text-[11px] font-bold tabular">{settings.playback.seekStep}</span>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      {osd && !locked ? (
        <div
          className={`pointer-events-none absolute left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/60 px-3.5 py-1 text-sm whitespace-nowrap tabular backdrop-blur-sm ${
            mini ? "top-10" : "top-[72px]"
          }`}
          role="status"
        >
          {osd}
        </div>
      ) : null}
      {volHud != null ? (
        <div className="pointer-events-none absolute top-[72px] right-6 z-30 rounded-full bg-black/60 px-3 py-1 text-sm tabular backdrop-blur-sm">
          {Math.round(volHud)}%
        </div>
      ) : null}
      {!locked && !mini && !live && pauseInfo && !splash && !menu && !panel ? (
        <PauseInfo movie={detail ?? movie} heading={heading} />
      ) : null}
      {locked || mini ? null : nextEpisode && nextCard.visible ? (
        <NextEpisodeCard
          episode={nextEpisode}
          countdown={nextCard.countdown}
          onPlay={playNext}
          onDismiss={nextCard.dismiss}
          shifted={panel}
        />
      ) : skipPrompt.prompt ? (
        <SkipButton
          key={`${skipPrompt.prompt.key}:${skipPrompt.prompt.showId}`}
          label={t(skipPrompt.prompt.labelKey)}
          onSkip={skipPrompt.skip}
          onDismiss={skipPrompt.dismiss}
          shifted={panel}
        />
      ) : null}
      {stats && !locked && !mini ? (
        <StatsPanel
          torrent={torrent}
          delays={delays}
          source={sourceLabel}
          speed={state.speed}
          night={state.night}
          onClose={() => setStats(false)}
        />
      ) : null}
      {help && !locked && !mini ? <ShortcutsHelp live={Boolean(live)} onClose={() => setHelp(false)} /> : null}
      {subSearch && !locked && !mini ? (
        <SubtitleSearch movie={detail ?? movie} onClose={() => setSubSearch(false)} onLoaded={() => showOsd(t("subSearchLoaded"))} />
      ) : null}
      {locked ? (
        <LockScreen hint={lockHint} onUnlock={unlock} onHint={showLockHint} />
      ) : mini ? (
        <MiniPlayerControls
          heading={heading}
          state={state}
          visible={visible}
          live={Boolean(live)}
          onTogglePause={() => void togglePause()}
          onRestore={() => void toggleMini()}
          onClose={onExit}
          onVideoClick={onVideoClick}
          onVideoDoubleClick={onVideoDoubleClick}
        />
      ) : (
        <PlayerControls
          movie={movie}
          timelineMovie={timelineMovie}
          segments={segments}
          state={state}
          visible={visible}
          fullscreen={fullscreen}
          menu={menu}
          remaining={remaining}
          panelOpen={panel}
          live={live ? { number: live.number, now: liveEpg?.now ?? null, next: liveEpg?.next ?? null } : null}
          onMenu={setMenu}
          onToggleRemaining={toggleRemaining}
          onBack={onExit}
          onTogglePause={() => void togglePause()}
          onVideoClick={onVideoClick}
          onVideoDoubleClick={onVideoDoubleClick}
          onSeek={seekBy}
          onSeekTo={seekTo}
          onScrub={(seconds) => void api.playerSeek(seconds, false, true)}
          onVolume={(value) => void changeVolume(value)}
          onMute={() => void api.playerSetMute(!state.mute)}
          onTrack={(kind, id) => void api.playerSetTrack(kind, id)}
          delays={delays}
          onDelay={changeDelay}
          onSpeed={setSpeed}
          onAspect={cycleAspect}
          onFullscreen={() => void toggleFullscreen()}
          onLock={lock}
          onPanel={togglePanel}
          onReveal={bump}
          onHoldUi={holdUi}
          onNight={toggleNight}
          onMini={() => void toggleMini()}
          onSearchSubs={() => setSubSearch(true)}
        />
      )}
      {panel && !locked && !mini && live ? (
        <ChannelsPanel live={live} channels={zapList} onPlay={playChannel} onClose={() => setPanel(false)} onHoldUi={holdUi} />
      ) : panel && !locked && !mini ? (
        <EpisodesPanel
          key={movie.id}
          movie={movie}
          time={state.time}
          duration={state.duration}
          onPlay={playFromPanel}
          onClose={() => setPanel(false)}
          onHoldUi={holdUi}
        />
      ) : null}
    </div>
  );
}
