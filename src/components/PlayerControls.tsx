import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Subtitles,
} from "lucide-react";
import type { Movie, PlayerState } from "../lib/types";
import { formatClock } from "../lib/format";
import { VolumeSlider } from "./VolumeSlider";
import { TrackMenu } from "./TrackMenu";
import { useI18n } from "../lib/locale-context";

export function PlayerControls({
  movie,
  state,
  visible,
  fullscreen,
  hoverTime,
  onHoverTime,
  onBack,
  onTogglePause,
  onSeek,
  onSeekTo,
  onVolume,
  onMute,
  onTrack,
  onFullscreen,
  onReveal,
  onHoldUi,
}: {
  movie: Movie;
  state: PlayerState;
  visible: boolean;
  fullscreen: boolean;
  hoverTime: number | null;
  onHoverTime: (value: number | null) => void;
  onBack: () => void;
  onTogglePause: () => void;
  onSeek: (delta: number) => void;
  onSeekTo: (seconds: number) => void;
  onVolume: (value: number) => void;
  onMute: () => void;
  onTrack: (kind: string, id: number) => void;
  onFullscreen: () => void;
  onReveal: () => void;
  onHoldUi: (hold: boolean) => void;
}) {
  const { t } = useI18n();
  const [tracksOpen, setTracksOpen] = useState(false);
  const progress = state.duration > 0 ? (state.time / state.duration) * 100 : 0;

  const tooltip = useMemo(() => {
    if (hoverTime == null) return null;
    return formatClock(hoverTime);
  }, [hoverTime]);

  return (
    <div
      className="absolute inset-0 z-20 cursor-default bg-black/[0.02]"
      style={{ pointerEvents: "auto" }}
      onMouseMove={onReveal}
      onClick={(e) => {
        if (e.target === e.currentTarget) onTogglePause();
      }}
    >
      <div
        className="absolute inset-0 transition-opacity duration-200"
        style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none" }}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => onHoldUi(true)}
        onMouseLeave={() => onHoldUi(false)}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[140px] bg-gradient-to-b from-black/85 via-black/40 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[200px] bg-gradient-to-t from-black via-black/70 to-transparent" />

        <div className="absolute top-0 inset-x-0 flex items-center gap-3 px-5 py-4">
          <button
            type="button"
            className="icon-hit grid h-10 w-10 place-items-center text-white"
            onClick={onBack}
            aria-label={t("back")}
          >
            <ArrowLeft size={22} />
          </button>
          <div>
            <p className="text-[15px] font-medium">{movie.name}</p>
            {movie.year ? <p className="text-[12px] text-muted">{movie.year}</p> : null}
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 px-6 pb-5">
          <div
            className="group/bar relative mb-3 h-1 cursor-pointer rounded-full bg-white/20 transition-[height] before:absolute before:inset-x-0 before:-top-3 before:-bottom-3 before:content-[''] hover:h-1.5"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
              onHoverTime(ratio * state.duration);
            }}
            onMouseLeave={() => onHoverTime(null)}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
              onSeekTo(ratio * state.duration);
            }}
          >
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: "100%" }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${progress}%` }} />
            <div
              className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-accent opacity-0 group-hover/bar:opacity-100"
              style={{ left: `calc(${progress}% - 6px)` }}
            />
            {tooltip && hoverTime != null ? (
              <div
                className="absolute -top-8 -translate-x-1/2 rounded bg-black/80 px-2 py-1 text-[11px] tabular"
                style={{ left: `${(hoverTime / Math.max(state.duration, 1)) * 100}%` }}
              >
                {tooltip}
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              className="icon-hit grid h-10 w-10 place-items-center text-white"
              onClick={onTogglePause}
              aria-label={state.paused ? t("play") : t("pause")}
            >
              <span className="relative grid h-6 w-6 place-items-center">
                <Play
                  size={22}
                  fill="currentColor"
                  className={`icon-swap absolute ${state.paused ? "icon-swap-on" : "icon-swap-off"}`}
                />
                <Pause
                  size={22}
                  className={`icon-swap absolute ${state.paused ? "icon-swap-off" : "icon-swap-on"}`}
                />
              </span>
            </button>
            <button
              type="button"
              className="icon-hit grid h-10 w-10 place-items-center text-white"
              onClick={() => onSeek(-10)}
              aria-label={t("seekBack")}
            >
              <RotateCcw size={18} />
            </button>
            <button
              type="button"
              className="icon-hit grid h-10 w-10 place-items-center text-white"
              onClick={() => onSeek(10)}
              aria-label={t("seekForward")}
            >
              <RotateCw size={18} />
            </button>
            <VolumeSlider
              volume={state.volume}
              mute={state.mute}
              onVolume={onVolume}
              onMute={onMute}
            />
            <span className="ml-2 text-[13px] text-white/90 tabular">
              {formatClock(state.time)} / {formatClock(state.duration)}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <div className="relative">
                <button
                  type="button"
                  className="icon-hit grid h-10 w-10 place-items-center text-white"
                  onClick={() => setTracksOpen((v) => !v)}
                  aria-label={t("tracks")}
                >
                  <Subtitles size={20} />
                </button>
                {tracksOpen ? (
                  <TrackMenu
                    tracks={state.tracks}
                    onSelect={(kind, id) => {
                      onTrack(kind, id);
                      setTracksOpen(false);
                    }}
                  />
                ) : null}
              </div>
              <button
                type="button"
                className="icon-hit grid h-10 w-10 place-items-center text-white"
                onClick={onFullscreen}
                aria-label={t("fullscreen")}
              >
                <span className="relative grid h-5 w-5 place-items-center">
                  <Minimize
                    size={20}
                    className={`icon-swap absolute ${fullscreen ? "icon-swap-on" : "icon-swap-off"}`}
                  />
                  <Maximize
                    size={20}
                    className={`icon-swap absolute ${fullscreen ? "icon-swap-off" : "icon-swap-on"}`}
                  />
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
