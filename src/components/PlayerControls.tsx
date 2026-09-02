import { useRef, useState } from "react";
import {
  ArrowLeft,
  Gauge,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Subtitles,
} from "lucide-react";
import type { Movie, PlayerState } from "../lib/types";
import { episodeCode, formatClock } from "../lib/format";
import { VolumeSlider } from "./VolumeSlider";
import { TrackMenu } from "./TrackMenu";
import { SpeedMenu, formatSpeed } from "./SpeedMenu";
import { Timeline } from "./Timeline";
import { QualityBadges } from "./QualityBadge";
import { useI18n } from "../lib/locale-context";

export type PlayerMenu = "tracks" | "speed" | null;

export function PlayerControls({
  movie,
  timelineMovie,
  state,
  visible,
  fullscreen,
  menu,
  remaining,
  onMenu,
  onToggleRemaining,
  onBack,
  onTogglePause,
  onVideoClick,
  onVideoDoubleClick,
  onSeek,
  onSeekTo,
  onScrub,
  onVolume,
  onMute,
  onTrack,
  onSpeed,
  onFullscreen,
  onReveal,
  onHoldUi,
}: {
  movie: Movie;
  /** Movie with trickplay/chapter detail for the timeline (may be a fuller copy). */
  timelineMovie: Movie;
  state: PlayerState;
  visible: boolean;
  fullscreen: boolean;
  menu: PlayerMenu;
  remaining: boolean;
  onMenu: (menu: PlayerMenu) => void;
  onToggleRemaining: () => void;
  onBack: () => void;
  onTogglePause: () => void;
  onVideoClick: () => void;
  onVideoDoubleClick: () => void;
  onSeek: (delta: number) => void;
  onSeekTo: (seconds: number) => void;
  onScrub: (seconds: number) => void;
  onVolume: (value: number) => void;
  onMute: () => void;
  onTrack: (kind: string, id: number) => void;
  onSpeed: (speed: number) => void;
  onFullscreen: () => void;
  onReveal: () => void;
  onHoldUi: (hold: boolean) => void;
}) {
  const { t } = useI18n();
  const [scrub, setScrub] = useState<number | null>(null);
  const overChrome = useRef(false);
  const shownTime = scrub ?? state.time;
  const clock =
    remaining && state.duration > 0
      ? `-${formatClock(Math.max(0, state.duration - shownTime))}`
      : `${formatClock(shownTime)} / ${formatClock(state.duration)}`;

  const toggleMenu = (next: Exclude<PlayerMenu, null>) => onMenu(menu === next ? null : next);
  const isEpisode = movie.kind === "Episode";
  const heading = isEpisode ? (movie.seriesName ?? movie.name) : movie.name;
  const episodeLine = isEpisode
    ? [episodeCode(movie, t("episodeCode")), movie.name].filter(Boolean).join(" · ")
    : "";

  return (
    <div
      className="absolute inset-0 z-20 cursor-default bg-black/[0.02]"
      style={{ pointerEvents: "auto" }}
      onMouseMove={onReveal}
      onClick={(e) => {
        if (e.target === e.currentTarget) onVideoClick();
      }}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) onVideoDoubleClick();
      }}
    >
      <div
        className="absolute inset-0 transition-opacity duration-200"
        style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none" }}
        onClick={(e) => {
          e.stopPropagation();
          if (e.target === e.currentTarget && menu) onMenu(null);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        onMouseEnter={() => {
          overChrome.current = true;
          onHoldUi(true);
        }}
        onMouseLeave={() => {
          overChrome.current = false;
          onHoldUi(false);
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[140px] bg-gradient-to-b from-black/85 via-black/40 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[220px] bg-gradient-to-t from-black via-black/70 to-transparent" />

        <div className="absolute top-0 inset-x-0 flex items-center gap-3 px-5 py-4">
          <button
            type="button"
            className="icon-hit grid h-10 w-10 place-items-center text-white"
            onClick={onBack}
            aria-label={t("back")}
          >
            <ArrowLeft size={22} />
          </button>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium">{heading}</p>
            <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted">
              {episodeLine ? <span className="truncate">{episodeLine}</span> : null}
              {!isEpisode && movie.year ? <span>{movie.year}</span> : null}
              <QualityBadges badges={movie.badges.slice(0, 3)} className="[&>span]:px-1.5 [&>span]:py-0 [&>span]:text-[9px]" />
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 px-6 pb-5">
          <Timeline
            movie={timelineMovie}
            time={state.time}
            duration={state.duration}
            cacheTime={state.cacheTime}
            onSeekTo={onSeekTo}
            onScrub={onScrub}
            onScrubbing={(seconds) => {
              setScrub(seconds);
              if (seconds != null) {
                onHoldUi(true);
              } else {
                // Keep holding only if the pointer is still over the controls.
                onHoldUi(overChrome.current);
                onReveal();
              }
            }}
          />

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
            <button
              type="button"
              className="icon-hit ml-2 rounded px-1.5 py-1 text-[13px] text-white/90 tabular hover:bg-white/8"
              onClick={onToggleRemaining}
              aria-label={remaining ? t("elapsedTime") : t("remainingTime")}
              title={remaining ? t("elapsedTime") : t("remainingTime")}
            >
              {clock}
            </button>
            <div className="ml-auto flex items-center gap-1">
              <div className="relative">
                <button
                  type="button"
                  className={`icon-hit flex h-10 items-center gap-1.5 rounded px-2 text-white ${
                    menu === "speed" ? "bg-white/10" : ""
                  }`}
                  onClick={() => toggleMenu("speed")}
                  aria-label={t("playbackSpeed")}
                  aria-expanded={menu === "speed"}
                >
                  <Gauge size={20} />
                  {Math.abs(state.speed - 1) > 0.01 ? (
                    <span className="text-[12px] font-semibold tabular">{formatSpeed(state.speed)}</span>
                  ) : null}
                </button>
                {menu === "speed" ? (
                  <SpeedMenu
                    speed={state.speed}
                    onSelect={(speed) => {
                      onSpeed(speed);
                      onMenu(null);
                    }}
                  />
                ) : null}
              </div>
              <div className="relative">
                <button
                  type="button"
                  className={`icon-hit grid h-10 w-10 place-items-center text-white ${
                    menu === "tracks" ? "bg-white/10 rounded" : ""
                  }`}
                  onClick={() => toggleMenu("tracks")}
                  aria-label={t("tracks")}
                  aria-expanded={menu === "tracks"}
                >
                  <Subtitles size={20} />
                </button>
                {menu === "tracks" ? (
                  <TrackMenu
                    tracks={state.tracks}
                    onSelect={(kind, id) => {
                      onTrack(kind, id);
                      onMenu(null);
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
