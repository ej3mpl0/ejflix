import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { PlayerControls } from "../components/PlayerControls";
import { api } from "../lib/api";
import type { Movie, PlayerState } from "../lib/types";
import { ticksToSeconds } from "../lib/format";
import { useI18n } from "../lib/locale-context";

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
};

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
  const [visible, setVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [flash, setFlash] = useState<"play" | "pause" | null>(null);
  const [seekHud, setSeekHud] = useState<number | null>(null);
  const [volHud, setVolHud] = useState<number | null>(null);
  const hideTimer = useRef<number>(0);
  const volTimer = useRef<number>(0);
  const seekTimer = useRef<number>(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const overUi = useRef(false);
  const overlay = mode === "overlay";

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

  const onErrorRef = useRef(onError);
  const onExitRef = useRef(onExit);
  const tRef = useRef(t);
  onErrorRef.current = onError;
  onExitRef.current = onExit;
  tRef.current = t;

  const seekRel = async (delta: number) => {
    setSeekHud(delta);
    window.clearTimeout(seekTimer.current);
    seekTimer.current = window.setTimeout(() => setSeekHud(null), 500);
    await api.playerSeek(delta, true);
  };

  const togglePause = async () => {
    setFlash(state.paused ? "play" : "pause");
    window.setTimeout(() => setFlash(null), 400);
    await api.playerTogglePause();
  };

  const changeVolume = async (value: number) => {
    const next = await api.playerSetVolume(value);
    setVolHud(next);
    window.clearTimeout(volTimer.current);
    volTimer.current = window.setTimeout(() => setVolHud(null), 1200);
  };

  const toggleFullscreen = async () => {
    const next = !fullscreen;
    await api.playerSetFullscreen(next);
    setFullscreen(next);
  };

  useEffect(() => {
    bump();
    let cancelled = false;
    const unlistenState = api.onPlayerState(setState);
    const unlistenHotkey = api.onPlayerHotkey((key) => {
      if (key === "escape") onExitRef.current();
      if (key === "space") void togglePause();
    });

    if (!overlay) {
      const start = ticksToSeconds(movie.playbackPositionTicks);
      api
        .playerStart({
          itemId: movie.id,
          title: movie.name,
          startSeconds: start > 5 ? start : 0,
          mediaSourceId: movie.mediaSourceId,
        })
        .then((next) => {
          if (cancelled) return;
          void api.openPlayer(movie);
          setState(next);
        })
        .catch((err) => {
          if (cancelled) return;
          onErrorRef.current(err instanceof Error ? err.message : tRef.current("playerStartError"));
          onExitRef.current();
        });
    }

    return () => {
      cancelled = true;
      void unlistenState.then((fn) => fn());
      void unlistenHotkey.then((fn) => fn());
      if (!overlay) void api.playerStop();
    };
  }, [movie, overlay]);

  useEffect(() => {
    if (state.eof) onExit();
  }, [state.eof, onExit]);

  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      bump();
      if (e.key === " " || e.key === "k" || e.key === "K") {
        e.preventDefault();
        void togglePause();
      } else if (e.key === "ArrowLeft" || e.key === "j" || e.key === "J") {
        void seekRel(-10);
      } else if (e.key === "ArrowRight" || e.key === "l" || e.key === "L") {
        void seekRel(10);
      } else if (e.key >= "0" && e.key <= "9") {
        const dur = stateRef.current.duration;
        if (dur > 0) void api.playerSeek((Number(e.key) / 10) * dur, false);
      } else if (e.key === "ArrowUp") {
        void changeVolume(state.volume + 5);
      } else if (e.key === "ArrowDown") {
        void changeVolume(state.volume - 5);
      } else if (e.key === "m" || e.key === "M") {
        void api.playerSetMute(!state.mute);
      } else if (e.key === "f" || e.key === "F") {
        void toggleFullscreen();
      } else if (e.key === "Escape") {
        if (fullscreen) void toggleFullscreen();
        else onExit();
      }
    };
    const onMove = () => bump();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      void changeVolume(state.volume + (e.deltaY < 0 ? 5 : -5));
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("wheel", onWheel);
    };
  }, [overlay, state.volume, state.mute, fullscreen, onExit]);

  if (!overlay) {
    return <div className="h-full w-full bg-base" />;
  }

  return (
    <div
      className="relative h-full w-full bg-transparent"
      onMouseMove={bump}
      onDoubleClick={() => void toggleFullscreen()}
    >
      {state.buffering ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <div className="h-14 w-14 rounded-full border-2 border-white/15 border-t-accent animate-spin" />
        </div>
      ) : null}
      {flash ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <div className="flash-icon grid h-20 w-20 place-items-center rounded-full bg-black/40 text-white">
            {flash === "play" ? <Play size={36} fill="currentColor" /> : <Pause size={36} />}
          </div>
        </div>
      ) : null}
      {volHud != null ? (
        <div className="pointer-events-none absolute top-6 right-6 z-30 rounded-full bg-black/60 px-3 py-1 text-sm tabular backdrop-blur-sm">
          {Math.round(volHud)}%
        </div>
      ) : null}
      {seekHud != null ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <div className="flash-icon rounded-full bg-black/45 px-5 py-2 text-lg font-semibold tabular text-white">
            {seekHud > 0 ? "+" : ""}{seekHud}s
          </div>
        </div>
      ) : null}
      <PlayerControls
        movie={movie}
        state={state}
        visible={visible}
        fullscreen={fullscreen}
        hoverTime={hoverTime}
        onHoverTime={setHoverTime}
        onBack={onExit}
        onTogglePause={() => void togglePause()}
        onSeek={(delta) => void seekRel(delta)}
        onSeekTo={(seconds) => void api.playerSeek(seconds, false)}
        onVolume={(value) => void changeVolume(value)}
        onMute={() => void api.playerSetMute(!state.mute)}
        onTrack={(kind, id) => void api.playerSetTrack(kind, id)}
        onFullscreen={() => void toggleFullscreen()}
        onReveal={bump}
        onHoldUi={holdUi}
      />
    </div>
  );
}
