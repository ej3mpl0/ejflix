import { useEffect, useRef, useState } from "react";
import { Info, Pause, Play } from "lucide-react";
import type { Movie } from "../lib/types";
import { cn, formatRuntime } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { Pill } from "./Pill";
import { FavoriteButton } from "./FavoriteButton";
import { QualityBadges } from "./QualityBadge";
import { TrailerBackdrop, TrailerMuteButton, type TrailerPhase } from "./TrailerBackdrop";
import { useTrailerGate, useTrailerUrl } from "../lib/trailer-autoplay";
import { useSettings } from "../lib/settings-context";
import { useArtworkAccent } from "../lib/auto-accent";

const AUTO_ADVANCE_MS = 8000;
const DRAG_THRESHOLD = 60;
const FADE_MS = 700;

/**
 * Full-bleed hero carousel (Nuvio style): cross-fading backdrops with scroll parallax,
 * logo or title, meta line, actions and stretchy page dots. Auto-advances every 8 s
 * unless hovered, hidden or the user prefers reduced motion. After a few seconds on a
 * slide its trailer (when it has one) plays muted behind it, holding the rotation until
 * it ends.
 */
export function HeroCarousel({
  items,
  onPlay,
  onDetails,
}: {
  items: Movie[];
  onPlay: (movie: Movie) => void;
  onDetails: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [previous, setPrevious] = useState<Movie | null>(null);
  const [dir, setDir] = useState<1 | -1>(1);
  const [hover, setHover] = useState(false);
  /** Keyboard focus inside the hero pauses it too (WCAG 2.2.2), and so does the pause button. */
  const [focused, setFocused] = useState(false);
  const [paused, setPaused] = useState(false);
  const dragStart = useRef<number | null>(null);
  const dragged = useRef(false);
  const root = useRef<HTMLElement>(null);
  const reduced = useRef(
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const count = items.length;
  const safeIndex = count ? index % count : 0;
  const current = items[safeIndex];
  const { settings } = useSettings();
  const gate = useTrailerGate();
  const trailer = useTrailerUrl(current, gate.hero && settings.appearance.autoplayTrailers && !reduced.current);
  const [trailerPhase, setTrailerPhase] = useState<TrailerPhase>("idle");
  const [muted, setMuted] = useState(true);
  const trailerBusy = trailerPhase === "loading" || trailerPhase === "playing";
  useArtworkAccent("hero", gate.hero ? current?.backdropUrl ?? null : null);

  const go = (delta: 1 | -1) => {
    if (count < 2) return;
    setPrevious(items[safeIndex]);
    setDir(delta);
    setIndex((safeIndex + delta + count) % count);
  };

  const goTo = (target: number) => {
    if (target === safeIndex || count < 2) return;
    setPrevious(items[safeIndex]);
    setDir(target > safeIndex ? 1 : -1);
    setIndex(target);
  };

  // Drop the outgoing backdrop once the cross-fade is over.
  useEffect(() => {
    if (!previous) return;
    const handle = window.setTimeout(() => setPrevious(null), FADE_MS);
    return () => window.clearTimeout(handle);
  }, [previous]);

  useEffect(() => {
    if (count < 2 || hover || focused || paused || trailerBusy || reduced.current) return;
    const handle = window.setInterval(() => {
      // Also still while Home sits invisible behind the player or the first-run setup.
      if (document.hidden || (root.current && getComputedStyle(root.current).visibility === "hidden")) return;
      go(1);
    }, AUTO_ADVANCE_MS);
    return () => window.clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, hover, focused, paused, trailerBusy, safeIndex]);

  if (!current) return null;

  const resume = current.playbackPositionTicks > 10_000_000 * 30;
  const typeLabel = current.kind === "Series" ? t("seriesOne") : current.kind === "Episode" ? t("episode") : t("movie");
  const meta = [typeLabel, current.genres[0] ?? null, current.year ? String(current.year) : null].filter(Boolean);
  const runtime = formatRuntime(current.runtimeTicks);

  return (
    <section
      ref={root}
      className="group/hero relative h-[min(78vh,720px)] min-h-[min(480px,70vh)] w-full overflow-hidden rounded-b-[var(--radius-hero)] bg-surface outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      tabIndex={0}
      aria-roledescription="carousel"
      aria-label={t("featured")}
      onFocus={(e) => {
        if (e.currentTarget.matches(":focus-visible, :has(:focus-visible)")) setFocused(true);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onKeyDown={(e) => {
        // Only on the carousel itself or its dots: on the action buttons the arrows move focus.
        const own = e.target === e.currentTarget || (e.target as HTMLElement).closest("[data-hero-dots]");
        if (!own || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
        e.preventDefault();
        go(e.key === "ArrowRight" ? 1 : -1);
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        dragStart.current = e.clientX;
        dragged.current = false;
      }}
      onPointerMove={(e) => {
        if (dragStart.current == null) return;
        const dx = e.clientX - dragStart.current;
        if (Math.abs(dx) >= DRAG_THRESHOLD) {
          dragStart.current = null;
          dragged.current = true;
          go(dx < 0 ? 1 : -1);
        }
      }}
      onPointerUp={() => {
        dragStart.current = null;
      }}
      onClickCapture={(e) => {
        if (dragged.current) {
          e.stopPropagation();
          dragged.current = false;
        }
      }}
    >
      {/* Backdrops: the wrapper carries the scroll parallax, each image its own fade. */}
      <div
        className="absolute inset-0 will-change-transform"
        style={{ transform: "translateY(calc(var(--scroll-y, 0) * 0.3px))" }}
      >
        {previous?.backdropUrl ? (
          <img
            key={`prev-${previous.id}`}
            src={previous.backdropUrl}
            alt=""
            className="absolute inset-0 h-full w-full scale-[1.14] object-cover"
          />
        ) : null}
        {current.backdropUrl ? (
          <img
            key={current.id}
            src={current.backdropUrl}
            alt=""
            className={cn("hero-in absolute inset-0 h-full w-full object-cover", reduced.current && "!animate-none")}
            style={{ ["--hero-dx" as string]: dir > 0 ? "3%" : "-3%" }}
          />
        ) : null}
        <TrailerBackdrop
          key={current.id}
          url={trailer}
          active={gate.hero}
          muted={muted}
          onPhase={(phase) => {
            setTrailerPhase(phase);
            // Played to the end: on to the next slide instead of sitting on its last frame.
            if (phase === "ended") go(1);
          }}
        />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-base)_2%,transparent)_0%,color-mix(in_oklab,var(--color-base)_12%,transparent)_40%,color-mix(in_oklab,var(--color-base)_34%,transparent)_70%,color-mix(in_oklab,var(--color-base)_78%,transparent)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[220px] bg-gradient-to-t from-base to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[55%] bg-gradient-to-r from-base/80 via-base/30 to-transparent" />

      <div key={current.id} className="absolute bottom-16 left-page max-w-[min(640px,60%)]">
        {current.logoUrl ? (
          <img
            src={current.logoUrl}
            alt={current.name}
            className="enter mb-5 max-h-[112px] max-w-[62%] object-contain object-left drop-shadow-[0_4px_16px_rgb(0_0_0_/_0.5)]"
          />
        ) : (
          <h1 className="enter mb-4 text-[clamp(40px,6vw,72px)] leading-[1] font-extrabold tracking-[-0.02em] [text-wrap:balance]">
            {current.name}
          </h1>
        )}
        <div className="enter enter-d1 mb-3 flex flex-wrap items-center gap-2 text-[14px] text-text/80">
          {meta.map((part, i) => (
            <span key={`${part}-${i}`} className="flex items-center gap-2">
              {i > 0 ? <span aria-hidden className="h-1 w-1 rounded-full bg-text/50" /> : null}
              <span>{part}</span>
            </span>
          ))}
          {runtime ? (
            <span className="flex items-center gap-2">
              <span aria-hidden className="h-1 w-1 rounded-full bg-text/50" />
              <span className="tabular">{runtime}</span>
            </span>
          ) : null}
          {current.communityRating ? (
            <span className="flex items-center gap-2">
              <span aria-hidden className="h-1 w-1 rounded-full bg-text/50" />
              <span className="text-star tabular">★ {current.communityRating.toFixed(1)}</span>
            </span>
          ) : null}
          <QualityBadges badges={current.badges.slice(0, 3)} className="ml-1" />
        </div>
        {current.overview ? (
          <p className="enter enter-d2 mb-6 line-clamp-3 max-w-[560px] text-[15px] leading-[1.6] text-muted">
            {current.overview}
          </p>
        ) : null}
        <div className="enter enter-d3 flex flex-wrap items-center gap-3">
          <Pill variant="primary" pill size="lg" className="btn-play" icon={<Play size={18} fill="currentColor" />} onClick={() => onPlay(current)}>
            {resume ? t("resume") : t("play")}
          </Pill>
          <Pill variant="tonal" pill size="lg" icon={<Info size={18} />} onClick={() => onDetails(current)}>
            {t("viewDetails")}
          </Pill>
          {current.external ? null : <FavoriteButton movie={current} pill className="h-12" />}
        </div>
      </div>

      {count > 1 || trailerPhase === "playing" ? (
        <div className="absolute right-page bottom-16 flex items-center gap-2" data-hero-dots>
          {trailerPhase === "playing" ? (
            <TrailerMuteButton muted={muted} onToggle={() => setMuted((v) => !v)} className="mr-2 h-8 w-8" />
          ) : null}
          {reduced.current || count < 2 ? null : (
            <button
              type="button"
              onClick={() => setPaused((v) => !v)}
              aria-label={paused ? t("playSlides") : t("pauseSlides")}
              aria-pressed={paused}
              className="mr-1 grid h-7 w-7 place-items-center rounded-full bg-black/40 text-white/80 opacity-0 transition-opacity duration-150 group-hover/hero:opacity-100 hover:bg-black/60 hover:text-white focus-visible:opacity-100 data-[paused=true]:opacity-100"
              data-paused={paused}
            >
              {paused ? <Play size={12} fill="currentColor" /> : <Pause size={12} fill="currentColor" />}
            </button>
          )}
          {count < 2 ? null : items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              aria-current={i === safeIndex ? "true" : undefined}
              aria-label={t("slide", { n: i + 1 })}
              onClick={() => goTo(i)}
              className="grid h-6 place-items-center px-0.5"
            >
              <span
                className={cn(
                  "block h-2 rounded-full transition-[width,background-color] duration-[var(--duration-normal)] ease-std",
                  i === safeIndex ? "w-8 bg-accent" : "w-2 bg-white/40 hover:bg-white/70",
                )}
              />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
