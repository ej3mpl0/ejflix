import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, RotateCw, SkipForward } from "lucide-react";
import { PlayerControls, type PlayerMenu } from "../components/PlayerControls";
import { SPEEDS } from "../components/SpeedMenu";
import { QualityBadges } from "../components/QualityBadge";
import { api } from "../lib/api";
import type { Movie, PlayerState } from "../lib/types";
import { episodeCode, ticksToSeconds } from "../lib/format";
import { useI18n } from "../lib/locale-context";

/** Seconds before the end at which the "next episode" button appears. */
const NEXT_BUTTON_WINDOW = 30;
/** Countdown (seconds) before the next episode starts automatically at the end. */
const AUTOPLAY_SECONDS = 5;

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
};

type Flash = "play" | "pause" | "back" | "fwd";

const REMAINING_KEY = "ejflix.timeRemaining";

function readRemainingPref(): boolean {
  try {
    return localStorage.getItem(REMAINING_KEY) === "1";
  } catch {
    return false;
  }
}

function writeRemainingPref(value: boolean) {
  try {
    localStorage.setItem(REMAINING_KEY, value ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

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
  const [state, setState] = useState<PlayerState>(emptyState);
  const [detail, setDetail] = useState<Movie | null>(null);
  const [visible, setVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [menu, setMenu] = useState<PlayerMenu>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [volHud, setVolHud] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [splash, setSplash] = useState(true);
  const [remaining, setRemaining] = useState(readRemainingPref);
  const [nextEpisode, setNextEpisode] = useState<Movie | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const mounted = useRef(true);
  /** Pending stop of the previous item; the next start waits for it (engine mode). */
  const stopping = useRef<Promise<void> | null>(null);
  /** Guards against asking for the next episode twice (button + countdown). */
  const nextSent = useRef(false);
  const hideTimer = useRef<number>(0);
  const volTimer = useRef<number>(0);
  const flashTimer = useRef<number>(0);
  const clickTimer = useRef<number>(0);
  const overUi = useRef(false);
  const overlay = mode === "overlay";
  const timelineMovie = detail ?? movie;
  const isEpisode = movie.kind === "Episode";
  const code = isEpisode ? episodeCode(movie, t("episodeCode")) : "";
  const heading = isEpisode ? (movie.seriesName ?? movie.name) : movie.name;
  const subheading = isEpisode ? [code, movie.name].filter(Boolean).join(" · ") : "";

  const bump = () => {
    setVisible(true);
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
    bump();
    let cancelled = false;
    const unlistenState = api.onPlayerState(setState);
    const unlistenHotkey = api.onPlayerHotkey((key) => hotkeyRef.current(key));

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
          onErrorRef.current(err instanceof Error ? err.message : tRef.current("playerStartError"));
          onExitRef.current();
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
  }, [movie, overlay]);

  // Episodes: look up what comes next so the end of the file can chain into it.
  useEffect(() => {
    if (!overlay || !isEpisode || !movie.seriesId) return;
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
  }, [overlay, isEpisode, movie.seriesId, movie.id]);

  // End of file (overlay decides): autoplay the next episode after a short countdown,
  // otherwise leave the player.
  useEffect(() => {
    if (!overlay || !state.eof) return;
    if (!nextEpisode) {
      onExit();
      return;
    }
    setCountdown(AUTOPLAY_SECONDS);
    const started = Date.now();
    const handle = window.setInterval(() => {
      const left = AUTOPLAY_SECONDS - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) {
        window.clearInterval(handle);
        if (!nextSent.current) {
          nextSent.current = true;
          void api.playNext(nextEpisode);
        }
      } else {
        setCountdown(left);
      }
    }, 250);
    return () => {
      window.clearInterval(handle);
      setCountdown(null);
    };
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
    if (!overlay) return;
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
      void changeVolume(stateRef.current.volume + (e.deltaY < 0 ? 5 : -5));
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
    const next = !fullscreen;
    setFullscreen(next);
    await api.playerSetFullscreen(next);
  };

  const setSpeed = (speed: number) => {
    void api.playerSetSpeed(speed);
  };

  const stepSpeed = (dir: 1 | -1) => {
    const current = stateRef.current.speed;
    let index = SPEEDS.findIndex((s) => Math.abs(s - current) < 0.01);
    if (index < 0) index = SPEEDS.indexOf(1);
    const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, index + dir))];
    setSpeed(next);
  };

  const toggleRemaining = () => {
    setRemaining((value) => {
      writeRemainingPref(!value);
      return !value;
    });
  };

  const playNext = () => {
    if (!nextEpisode || nextSent.current) return;
    nextSent.current = true;
    void api.playNext(nextEpisode);
  };

  const escape = () => {
    if (menu) setMenu(null);
    else if (fullscreen) void toggleFullscreen();
    else onExit();
  };

  const onVideoClick = () => {
    window.clearTimeout(clickTimer.current);
    if (menu) {
      setMenu(null);
      return;
    }
    clickTimer.current = window.setTimeout(() => void togglePause(), 250);
  };

  const onVideoDoubleClick = () => {
    window.clearTimeout(clickTimer.current);
    void toggleFullscreen();
  };

  hotkeyRef.current = (key) => {
    if (key === "escape") escape();
    if (key === "space") void togglePause();
  };

  keydownRef.current = (e) => {
    bump();
    if (e.ctrlKey || e.altKey || e.metaKey) return;
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
        seekBy(-10);
        break;
      case "ArrowRight":
      case "l":
      case "L":
        seekBy(10);
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
      default:
        if (/^[0-9]$/.test(e.key) && current.duration > 0) {
          seekTo((current.duration * Number(e.key)) / 10);
        }
    }
  };

  if (!overlay) {
    return <div className="fixed inset-0 z-[60] bg-base" />;
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
                <span className="absolute text-[11px] font-bold tabular">10</span>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      {volHud != null ? (
        <div className="pointer-events-none absolute top-6 right-6 z-30 rounded-full bg-black/60 px-3 py-1 text-sm tabular backdrop-blur-sm">
          {Math.round(volHud)}%
        </div>
      ) : null}
      {nextEpisode &&
      ready &&
      state.duration > 0 &&
      (state.eof || state.duration - state.time <= NEXT_BUTTON_WINDOW) ? (
        <button
          type="button"
          onClick={playNext}
          className="enter btn-press absolute right-6 bottom-[116px] z-30 inline-flex h-11 items-center gap-2 rounded-md bg-white pr-5 pl-4 text-[14px] font-semibold text-black shadow-[0_8px_24px_rgb(0_0_0_/_0.5)] hover:bg-white/85"
        >
          <SkipForward size={18} fill="currentColor" />
          {countdown != null ? t("nextEpisodeIn", { n: countdown }) : t("nextEpisode")}
        </button>
      ) : null}
      <PlayerControls
        movie={movie}
        timelineMovie={timelineMovie}
        state={state}
        visible={visible}
        fullscreen={fullscreen}
        menu={menu}
        remaining={remaining}
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
        onSpeed={setSpeed}
        onFullscreen={() => void toggleFullscreen()}
        onReveal={bump}
        onHoldUi={holdUi}
      />
    </div>
  );
}
