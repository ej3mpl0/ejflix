import { useRef, useState, type ReactNode } from "react";
import type React from "react";
import {
  ArrowLeft,
  ListVideo,
  Lock,
  Maximize,
  Minimize,
  Moon,
  PartyPopper,
  Pause,
  PictureInPicture2,
  Play,
  Ratio,
  RotateCcw,
  RotateCw,
  Tv,
} from "lucide-react";
import type { MediaSegment, Movie, PlayerState, Programme } from "../lib/types";
import { cn, episodeCode, formatClock } from "../lib/format";
import { isSeriesEpisode } from "../lib/addons";
import { aspectLabel } from "../lib/aspect";
import { formatRange, programmeProgress } from "../lib/iptv";
import { VolumeSlider } from "./VolumeSlider";
import { TrackMenu, trackShortName } from "./TrackMenu";
import { SpeedMenu, formatSpeed } from "./SpeedMenu";
import { Timeline } from "./Timeline";
import { QualityBadges } from "./QualityBadge";
import { useI18n } from "../lib/locale-context";
import { DelayStepper, SubtitleTools } from "./SubtitleTools";
import { useSettings } from "../lib/settings-context";
import { api } from "../lib/api";

export type PlayerMenu = "speed" | "audio" | "sub" | null;

/** What the controls show while an IPTV channel plays. */
export type LiveInfo = {
  number: number | null;
  now: Programme | null;
  next: Programme | null;
  /** A past programme from the archive: its own progress, not the clock's. */
  catchup?: boolean;
};

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
  live = null,
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
  delays,
  onDelay,
  onSpeed,
  onAspect,
  onFullscreen,
  onLock,
  onPanel,
  onReveal,
  onHoldUi,
  onNight,
  onMini,
  onSearchSubs,
  party = null,
  partyOpen = false,
  onParty,
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
  /** Set while a live channel plays: no timeline, programme on air instead of the clock. */
  live?: LiveInfo | null;
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
  /** Current subtitle / audio delay in seconds and how to change it. */
  delays: { sub: number; audio: number };
  onDelay: (kind: "sub" | "audio", seconds: number) => void;
  onSpeed: (speed: number) => void;
  onAspect: () => void;
  onFullscreen: () => void;
  onLock: () => void;
  onPanel: () => void;
  onReveal: () => void;
  onHoldUi: (hold: boolean) => void;
  /** Night mode (dynamic range compression) on/off. */
  onNight: () => void;
  /** Into the always-on-top mini player. */
  onMini: () => void;
  /** Opens the OpenSubtitles search. */
  onSearchSubs: () => void;
  /** Watch party in progress: how many are in (the button shows it). */
  party?: { count: number } | null;
  partyOpen?: boolean;
  /** Opens the watch party panel; no button without it (live TV). */
  onParty?: () => void;
}) {
  const { t, locale } = useI18n();
  const seekStep = useSettings().settings.playback.seekStep;
  const [scrub, setScrub] = useState<number | null>(null);
  const overChrome = useRef(false);
  const shownTime = scrub ?? state.time;

  // Only the bars hold the controls on screen; the layer between them is the video.
  const holdHandlers = {
    onMouseEnter: () => {
      overChrome.current = true;
      onHoldUi(true);
    },
    onMouseLeave: () => {
      overChrome.current = false;
      onHoldUi(false);
    },
  };

  const toggleMenu = (next: Exclude<PlayerMenu, null>) => onMenu(menu === next ? null : next);
  const isEpisode = isSeriesEpisode(movie);
  const heading = isEpisode ? (movie.seriesName ?? movie.name) : movie.name;
  const episodeLine = isEpisode
    ? [episodeCode(movie, t("episodeCode")), movie.name].filter(Boolean).join(" ")
    : "";
  const hasVersions = movie.mediaSources.length > 1;
  // The chips name the track in use ("English"), not just the kind of menu they open.
  const currentSub = state.tracks.find((track) => track.kind === "sub" && track.selected) ?? null;
  const currentAudio = state.tracks.find((track) => track.kind === "audio" && track.selected) ?? null;
  const subLabel = currentSub ? trackShortName(currentSub, locale) : t("subtitlesOff");
  const audioLabel = currentAudio ? trackShortName(currentAudio, locale) : t("audio");
  const showPanelChip = isEpisode || hasVersions || live != null;
  const panelLabel = live ? t("channels") : isEpisode ? t("episodes") : t("versions");
  const liveLine = live
    ? live.now
      ? `${formatRange(live.now, locale)} ${live.now.title}`
      : movie.genres[0] ?? ""
    : "";

  /** Grabbing the empty top bar moves the window (the overlay follows); not in fullscreen. */
  const dragWindow = (e: React.PointerEvent) => {
    if (e.button !== 0 || fullscreen || (e.target as Element).closest("button, a, input")) return;
    void api.playerMiniDrag().catch(() => undefined);
  };
  const glass = "bg-white/12 backdrop-blur-md hover:bg-white/20";

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
          // The empty area is the video: close what is open, else play / pause.
          if (e.target === e.currentTarget) onVideoClick();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (e.target === e.currentTarget) onVideoDoubleClick();
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[170px] bg-gradient-to-b from-black/75 via-black/30 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[240px] bg-gradient-to-t from-black/90 via-black/55 to-transparent" />

        {/* Top bar: where you are, and the handle that moves the window. */}
        <div
          className="absolute inset-x-0 top-0 flex items-center gap-4 px-8 pt-7 pb-6"
          {...holdHandlers}
          onPointerDown={dragWindow}
          onDoubleClick={(e) => {
            if (!(e.target as Element).closest("button")) onFullscreen();
          }}
        >
          <button
            type="button"
            className={cn("btn-press grid h-11 w-11 shrink-0 place-items-center rounded-full text-white", glass)}
            onClick={onBack}
            aria-label={t("back")}
            title={`${t("back")} (Esc)`}
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0 flex-1 select-none">
            <p className="truncate font-display text-[21px] leading-tight font-bold tracking-[-0.01em] text-white">{heading}</p>
            <div className="mt-0.5 flex min-w-0 items-center gap-3 text-[14px] text-white/65">
              {live ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-white">
                  <span className="h-[7px] w-[7px] rounded-full bg-live shadow-[0_0_0_3px_var(--color-live-soft)]" />
                  {live.catchup ? t("catchup") : t("liveBadge")}
                </span>
              ) : null}
              {live && live.number != null ? <span className="tabular">{live.number}</span> : null}
              {liveLine ? <span className="truncate">{liveLine}</span> : null}
              {episodeLine ? <span className="truncate">{episodeLine}</span> : null}
              {!isEpisode && !live && movie.year ? <span className="tabular">{movie.year}</span> : null}
              <QualityBadges badges={movie.badges.slice(0, 3)} className="[&>span]:border-white/30 [&>span]:text-[10.5px] [&>span]:text-white/80" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onParty ? (
              <button
                type="button"
                className={cn(
                  "btn-press flex h-10 items-center justify-center gap-2 rounded-full text-white",
                  glass,
                  party ? "px-4 text-[14px] font-semibold" : "w-10",
                  partyOpen && "bg-white/24",
                )}
                onClick={onParty}
                aria-label={t("partyTitle")}
                title={`${t("partyTitle")} (W)`}
                aria-pressed={partyOpen}
              >
                {party ? (
                  // A running party is live: it carries the red dot and how many are in it.
                  <>
                    <span className="h-[7px] w-[7px] rounded-full bg-live" />
                    {t("partyTitle")}
                    {party.count > 0 ? <span className="text-white/65 tabular">{party.count}</span> : null}
                  </>
                ) : (
                  <PartyPopper size={18} />
                )}
              </button>
            ) : null}
            <button
              type="button"
              className={cn("btn-press grid h-10 w-10 place-items-center rounded-full text-white", glass)}
              onClick={onMini}
              aria-label={t("miniPlayer")}
              title={`${t("miniPlayer")} (P)`}
            >
              <PictureInPicture2 size={18} />
            </button>
            <button
              type="button"
              className={cn("btn-press grid h-10 w-10 place-items-center rounded-full text-white", glass)}
              onClick={onLock}
              aria-label={t("lockControls")}
              title={t("lockControls")}
            >
              <Lock size={17} />
            </button>
          </div>
        </div>

        {/* Bottom: where you are in it, then one row of controls. */}
        <div className="absolute inset-x-0 bottom-0 px-8 pb-6" {...holdHandlers}>
          {live ? (
            live.now ? (
              <div className="mb-4">
                <div className="flex items-baseline justify-between gap-4 text-[13.5px] text-white/75">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold text-white">{live.now.title}</span>
                    <span className="tabular">, {formatRange(live.now, locale)}</span>
                  </span>
                  {live.next ? (
                    <span className="shrink-0 truncate text-white/55">
                      {t("nextProgramme")}: {live.next.title}
                    </span>
                  ) : null}
                </div>
                <div className="relative mt-2.5 h-[5px] w-full rounded-full bg-white/22">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-live"
                    style={{
                      width: `${
                        live.catchup
                          ? Math.min(100, (state.time / Math.max(1, live.now.stop - live.now.start)) * 100)
                          : programmeProgress(live.now)
                      }%`,
                    }}
                  />
                </div>
              </div>
            ) : null
          ) : (
            <div className="mb-3">
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
            </div>
          )}

          <div className="flex h-14 items-center gap-2">
            {/* Transport and sound. */}
            <button
              type="button"
              className="btn-press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent text-on-accent hover:bg-accent-hover"
              onClick={onTogglePause}
              aria-label={state.paused ? t("play") : t("pause")}
              title={`${state.paused ? t("play") : t("pause")} (K)`}
            >
              <span className="relative grid h-6 w-6 place-items-center">
                <Play
                  size={22}
                  fill="currentColor"
                  className={`icon-swap absolute translate-x-px ${state.paused ? "icon-swap-on" : "icon-swap-off"}`}
                />
                <Pause size={22} fill="currentColor" className={`icon-swap absolute ${state.paused ? "icon-swap-off" : "icon-swap-on"}`} />
              </span>
            </button>
            {!live || live.catchup ? (
              <>
                <button
                  type="button"
                  className="icon-hit ml-1 grid h-10 w-10 place-items-center rounded-full text-white hover:bg-white/10"
                  onClick={() => onSeek(-seekStep)}
                  aria-label={t("seekBack")}
                  title={`${t("seekBack")} (J)`}
                >
                  <RotateCcw size={20} />
                </button>
                <button
                  type="button"
                  className="icon-hit grid h-10 w-10 place-items-center rounded-full text-white hover:bg-white/10"
                  onClick={() => onSeek(seekStep)}
                  aria-label={t("seekForward")}
                  title={`${t("seekForward")} (L)`}
                >
                  <RotateCw size={20} />
                </button>
              </>
            ) : null}
            <VolumeSlider volume={state.volume} mute={state.mute} onVolume={onVolume} onMute={onMute} />
            {live && !live.catchup ? null : live?.catchup ? (
              <span className="ml-2 min-w-0 truncate text-[14px] whitespace-nowrap text-white/60 tabular">
                <span className="text-white">{formatClock(shownTime)}</span> /{" "}
                {formatClock(state.duration > 0 ? state.duration : live.now ? live.now.stop - live.now.start : 0)}
              </span>
            ) : (
              <button
                type="button"
                className="ml-2 min-w-0 truncate rounded-md px-1.5 py-1 text-[14px] whitespace-nowrap text-white/60 tabular hover:bg-white/8"
                onClick={onToggleRemaining}
                aria-label={remaining ? t("elapsedTime") : t("remainingTime")}
                title={remaining ? t("elapsedTime") : t("remainingTime")}
              >
                {remaining && state.duration > 0 ? (
                  <span className="text-white">-{formatClock(Math.max(0, state.duration - shownTime))}</span>
                ) : (
                  <>
                    {/* "51:02 de 1:22:10": the elapsed part in white, the rest in grey. */}
                    {t("timeOf", { time: " ", total: formatClock(state.duration) })
                      .split(" ")
                      .map((part, i) => (i === 0 ? <span key={i}>{part}<span className="text-white">{formatClock(shownTime)}</span></span> : <span key={i}>{part}</span>))}
                  </>
                )}
              </button>
            )}

            {/* What you hear and read, then how it looks. */}
            <div className="ml-auto flex min-w-0 items-center gap-1">
              <div className="relative">
                <OptionButton
                  name={t("audio")}
                  value={audioLabel}
                  expanded={menu === "audio"}
                  onClick={() => toggleMenu("audio")}
                />
                {menu === "audio" ? (
                  <TrackMenu
                    kind="audio"
                    footer={
                      <div className="mt-2 border-t border-white/10 pt-2">
                        <DelayStepper label={t("audioDelay")} value={delays.audio} onChange={(value) => onDelay("audio", value)} />
                      </div>
                    }
                    tracks={state.tracks}
                    onSelect={(kind, id) => {
                      onTrack(kind, id);
                      onMenu(null);
                    }}
                  />
                ) : null}
              </div>
              <div className="relative">
                <OptionButton
                  name={t("subtitles")}
                  value={subLabel}
                  expanded={menu === "sub"}
                  onClick={() => toggleMenu("sub")}
                />
                {menu === "sub" ? (
                  <TrackMenu
                    kind="sub"
                    footer={
                      <SubtitleTools
                        delay={delays.sub}
                        onDelay={(value) => onDelay("sub", value)}
                        onSearchOnline={() => {
                          onMenu(null);
                          onSearchSubs();
                        }}
                      />
                    }
                    tracks={state.tracks}
                    onSelect={(kind, id) => {
                      onTrack(kind, id);
                      onMenu(null);
                    }}
                  />
                ) : null}
              </div>
              {!live ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => toggleMenu("speed")}
                    aria-label={`${t("playbackSpeed")}: ${formatSpeed(state.speed)}`}
                    aria-expanded={menu === "speed"}
                    title={t("playbackSpeed")}
                    className={cn(
                      "h-10 rounded-full px-3 text-[14px] font-semibold text-white tabular hover:bg-white/10",
                      (menu === "speed" || state.speed !== 1) && "bg-white/14",
                    )}
                  >
                    {formatSpeed(state.speed)}
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
              ) : null}
              <span aria-hidden className="mx-2 h-6 w-px shrink-0 bg-white/18" />
              <IconToggle label={`${t("aspectRatio")}: ${aspectLabel(state.aspect, t)}`} on={state.aspect !== "auto"} onClick={onAspect}>
                <Ratio size={19} />
              </IconToggle>
              <IconToggle label={`${t("nightMode")} (D)`} on={state.night} onClick={onNight}>
                <Moon size={19} />
              </IconToggle>
              {showPanelChip ? (
                <IconToggle label={panelLabel} on={panelOpen} onClick={onPanel}>
                  {live ? <Tv size={19} /> : <ListVideo size={19} />}
                </IconToggle>
              ) : null}
              <IconToggle label={fullscreen ? t("exitFullscreen") : t("fullscreen")} on={false} onClick={onFullscreen}>
                <span className="relative grid h-5 w-5 place-items-center">
                  <Minimize size={19} className={`icon-swap absolute ${fullscreen ? "icon-swap-on" : "icon-swap-off"}`} />
                  <Maximize size={19} className={`icon-swap absolute ${fullscreen ? "icon-swap-off" : "icon-swap-on"}`} />
                </span>
              </IconToggle>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Audio  Español 5.1": the kind in grey, the track in use in white; opens its menu. */
function OptionButton({
  name,
  value,
  expanded,
  onClick,
}: {
  name: string;
  value: string;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${name}: ${value}`}
      aria-expanded={expanded}
      className={cn(
        "flex h-10 max-w-[220px] items-center gap-1.5 rounded-full px-3 text-[14px] whitespace-nowrap hover:bg-white/10",
        expanded && "bg-white/14",
      )}
    >
      <span className="text-white/55">{name}</span>
      <span className="truncate font-semibold text-white">{value}</span>
    </button>
  );
}

/** Round icon button; `on` marks a mode that is active (night mode, a forced aspect). */
function IconToggle({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      title={label}
      className={cn(
        "icon-hit grid h-10 w-10 place-items-center rounded-full text-white hover:bg-white/10",
        on && "bg-white/16",
      )}
    >
      {children}
    </button>
  );
}
