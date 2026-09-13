import { useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  AudioLines,
  Gauge,
  ListVideo,
  Lock,
  Maximize,
  Minimize,
  Pause,
  Play,
  Ratio,
  RotateCcw,
  RotateCw,
  Subtitles,
} from "lucide-react";
import type { MediaSegment, Movie, PlayerState } from "../lib/types";
import { cn, episodeCode, formatClock } from "../lib/format";
import { aspectLabel } from "../lib/aspect";
import { VolumeSlider } from "./VolumeSlider";
import { TrackMenu } from "./TrackMenu";
import { SpeedMenu, formatSpeed } from "./SpeedMenu";
import { Timeline } from "./Timeline";
import { QualityBadges } from "./QualityBadge";
import { useI18n } from "../lib/locale-context";

export type PlayerMenu = "speed" | "audio" | "sub" | null;

function ControlChip({
  icon,
  label,
  active = false,
  onClick,
  ariaLabel,
  expanded,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  ariaLabel?: string;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      aria-expanded={expanded}
      aria-pressed={expanded == null ? active : undefined}
      className={cn(
        "btn-press inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium text-white/90 hover:bg-white/10 hover:text-white",
        active && "bg-white/15 text-white",
      )}
    >
      {icon}
      <span className="tabular">{label}</span>
    </button>
  );
}

export function PlayerControls({
  movie,
  timelineMovie,
  segments,
  state,
  visible,
  fullscreen,
  menu,
  remaining,
  panelOpen,
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
  onAspect,
  onFullscreen,
  onLock,
  onPanel,
  onReveal,
  onHoldUi,
}: {
  movie: Movie;
  /** Movie with trickplay/chapter detail for the timeline (may be a fuller copy). */
  timelineMovie: Movie;
  segments: MediaSegment[];
  state: PlayerState;
  visible: boolean;
  fullscreen: boolean;
  menu: PlayerMenu;
  remaining: boolean;
  panelOpen: boolean;
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
  onAspect: () => void;
  onFullscreen: () => void;
  onLock: () => void;
  onPanel: () => void;
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
  const isEpisode = movie.kind === "Episode" && Boolean(movie.seriesId);
  const heading = isEpisode ? (movie.seriesName ?? movie.name) : movie.name;
  const episodeLine = isEpisode
    ? [episodeCode(movie, t("episodeCode")), movie.name].filter(Boolean).join(" · ")
    : "";
  const hasVersions = movie.mediaSources.length > 1;
  const showPanelChip = isEpisode || hasVersions;

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
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[160px] bg-gradient-to-b from-black/80 via-black/40 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[280px] bg-gradient-to-t from-black via-black/70 to-transparent" />

        <div className="absolute top-0 inset-x-0 flex items-center gap-3 px-5 py-4">
          <button
            type="button"
            className="icon-hit grid h-10 w-10 place-items-center text-white"
            onClick={onBack}
            aria-label={t("back")}
          >
            <ArrowLeft size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium">{heading}</p>
            <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted">
              {episodeLine ? <span className="truncate">{episodeLine}</span> : null}
              {!isEpisode && movie.year ? <span>{movie.year}</span> : null}
              <QualityBadges badges={movie.badges.slice(0, 3)} className="[&>span]:px-1.5 [&>span]:py-0 [&>span]:text-[9px]" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="icon-hit grid h-10 w-10 place-items-center text-white/85"
              onClick={onLock}
              aria-label={t("lockControls")}
              title={t("lockControls")}
            >
              <Lock size={19} />
            </button>
            {showPanelChip ? (
              <button
                type="button"
                className={cn(
                  "icon-hit grid h-10 w-10 place-items-center rounded-full text-white/85",
                  panelOpen && "bg-white/15 text-white",
                )}
                onClick={onPanel}
                aria-label={isEpisode ? t("episodes") : t("versions")}
                title={isEpisode ? t("episodes") : t("versions")}
                aria-pressed={panelOpen}
              >
                <ListVideo size={20} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 px-6 pb-4">
          <Timeline
            movie={timelineMovie}
            time={state.time}
            duration={state.duration}
            cacheTime={state.cacheTime}
            segments={segments}
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

          <div className="relative flex h-12 items-center">
            <VolumeSlider volume={state.volume} mute={state.mute} onVolume={onVolume} onMute={onMute} />
            <button
              type="button"
              className="icon-hit ml-2 rounded px-1.5 py-1 text-[13px] text-white/90 tabular hover:bg-white/8"
              onClick={onToggleRemaining}
              aria-label={remaining ? t("elapsedTime") : t("remainingTime")}
              title={remaining ? t("elapsedTime") : t("remainingTime")}
            >
              {clock}
            </button>

            <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
              <button
                type="button"
                className="icon-hit grid h-10 w-10 place-items-center text-white"
                onClick={() => onSeek(-10)}
                aria-label={t("seekBack")}
              >
                <RotateCcw size={20} />
              </button>
              <button
                type="button"
                className="btn-press grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
                onClick={onTogglePause}
                aria-label={state.paused ? t("play") : t("pause")}
              >
                <span className="relative grid h-6 w-6 place-items-center">
                  <Play
                    size={24}
                    fill="currentColor"
                    className={`icon-swap absolute translate-x-px ${state.paused ? "icon-swap-on" : "icon-swap-off"}`}
                  />
                  <Pause
                    size={24}
                    fill="currentColor"
                    className={`icon-swap absolute ${state.paused ? "icon-swap-off" : "icon-swap-on"}`}
                  />
                </span>
              </button>
              <button
                type="button"
                className="icon-hit grid h-10 w-10 place-items-center text-white"
                onClick={() => onSeek(10)}
                aria-label={t("seekForward")}
              >
                <RotateCw size={20} />
              </button>
            </div>

            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className="icon-hit grid h-10 w-10 place-items-center text-white"
                onClick={onFullscreen}
                aria-label={t("fullscreen")}
              >
                <span className="relative grid h-5 w-5 place-items-center">
                  <Minimize size={20} className={`icon-swap absolute ${fullscreen ? "icon-swap-on" : "icon-swap-off"}`} />
                  <Maximize size={20} className={`icon-swap absolute ${fullscreen ? "icon-swap-off" : "icon-swap-on"}`} />
                </span>
              </button>
            </div>
          </div>

          <div className="mt-2 flex justify-center">
            <div className="glass-pill relative flex items-center gap-1 rounded-3xl px-2 py-1.5">
              <ControlChip
                icon={<Ratio size={16} />}
                label={aspectLabel(state.aspect, t)}
                ariaLabel={t("aspectRatio")}
                active={state.aspect !== "auto"}
                onClick={onAspect}
              />
              <div className="relative">
                <ControlChip
                  icon={<Gauge size={16} />}
                  label={formatSpeed(state.speed)}
                  ariaLabel={t("playbackSpeed")}
                  expanded={menu === "speed"}
                  active={menu === "speed"}
                  onClick={() => toggleMenu("speed")}
                />
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
                <ControlChip
                  icon={<Subtitles size={16} />}
                  label={t("subtitles")}
                  expanded={menu === "sub"}
                  active={menu === "sub"}
                  onClick={() => toggleMenu("sub")}
                />
                {menu === "sub" ? (
                  <TrackMenu
                    kind="sub"
                    tracks={state.tracks}
                    onSelect={(kind, id) => {
                      onTrack(kind, id);
                      onMenu(null);
                    }}
                  />
                ) : null}
              </div>
              <div className="relative">
                <ControlChip
                  icon={<AudioLines size={16} />}
                  label={t("audio")}
                  expanded={menu === "audio"}
                  active={menu === "audio"}
                  onClick={() => toggleMenu("audio")}
                />
                {menu === "audio" ? (
                  <TrackMenu
                    kind="audio"
                    tracks={state.tracks}
                    onSelect={(kind, id) => {
                      onTrack(kind, id);
                      onMenu(null);
                    }}
                  />
                ) : null}
              </div>
              {showPanelChip ? (
                <ControlChip
                  icon={<ListVideo size={16} />}
                  label={isEpisode ? t("episodes") : t("versions")}
                  active={panelOpen}
                  onClick={onPanel}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
