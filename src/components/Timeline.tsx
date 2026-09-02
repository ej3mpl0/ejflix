import { useEffect, useRef, useState } from "react";
import type { Movie } from "../lib/types";
import { PREVIEW_WIDTH } from "../lib/trickplay";
import { TimelinePreview } from "./TimelinePreview";
import { useI18n } from "../lib/locale-context";

const SCRUB_THROTTLE_MS = 200;
const SCRUB_MIN_DELTA = 1;
const PENDING_MS = 1200;
const PENDING_TOLERANCE = 1.5;

/**
 * Netflix-style seek bar: hover preview, drag scrubbing (pointer capture),
 * buffered segment and chapter ticks.
 */
export function Timeline({
  movie,
  time,
  duration,
  cacheTime,
  onSeekTo,
  onScrub,
  onScrubbing,
}: {
  movie: Movie;
  time: number;
  duration: number;
  cacheTime: number;
  /** Committed, exact seek (on release / click). */
  onSeekTo: (seconds: number) => void;
  /** Throttled live seek while dragging (keyframe accuracy). */
  onScrub?: (seconds: number) => void;
  /** Current scrub position, or null when the drag ends. */
  onScrubbing: (seconds: number | null) => void;
}) {
  const { t } = useI18n();
  const barRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ seconds: number; x: number; width: number } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [pending, setPending] = useState<{ seconds: number; at: number } | null>(null);
  const dragRef = useRef<number | null>(null);
  const lastScrub = useRef<{ seconds: number; at: number }>({ seconds: -Infinity, at: 0 });

  const interactive = duration > 0;

  useEffect(() => {
    if (!pending) return;
    if (Math.abs(time - pending.seconds) <= PENDING_TOLERANCE || performance.now() - pending.at > PENDING_MS) {
      setPending(null);
    }
  }, [time, pending]);

  const positionAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return { seconds: 0, x: 0, width: 1 };
    const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
    return { seconds: (x / rect.width) * duration, x, width: rect.width };
  };

  const updateDrag = (seconds: number) => {
    dragRef.current = seconds;
    setDrag(seconds);
    onScrubbing(seconds);
    const now = performance.now();
    if (
      onScrub &&
      now - lastScrub.current.at >= SCRUB_THROTTLE_MS &&
      Math.abs(seconds - lastScrub.current.seconds) >= SCRUB_MIN_DELTA
    ) {
      lastScrub.current = { seconds, at: now };
      onScrub(seconds);
    }
  };

  const commit = () => {
    const seconds = dragRef.current;
    if (seconds == null) return;
    dragRef.current = null;
    setDrag(null);
    setPending({ seconds, at: performance.now() });
    onSeekTo(seconds);
    onScrubbing(null);
  };

  const shown = drag ?? (pending && Math.abs(time - pending.seconds) > PENDING_TOLERANCE ? pending.seconds : time);
  const pct = (seconds: number) => (interactive ? Math.min(100, Math.max(0, (seconds / duration) * 100)) : 0);
  const progress = pct(shown);
  const buffered = interactive && cacheTime > shown ? pct(cacheTime) : 0;
  const previewSeconds = drag ?? hover?.seconds ?? null;
  const previewLeft = hover
    ? Math.min(hover.width - PREVIEW_WIDTH / 2 - 4, Math.max(PREVIEW_WIDTH / 2 + 4, hover.x))
    : 0;

  return (
    <div
      ref={barRef}
      role="slider"
      aria-label={t("timeline")}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      data-dragging={drag != null}
      className={`group/bar relative mb-3 h-1 rounded-full bg-white/20 transition-[height] duration-150 select-none touch-none before:absolute before:inset-x-0 before:-top-3 before:-bottom-3 before:content-[''] hover:h-1.5 data-[dragging=true]:h-1.5 ${
        interactive ? "cursor-pointer" : "cursor-default"
      }`}
      onPointerDown={(e) => {
        if (!interactive || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const pos = positionAt(e.clientX);
        setHover(pos);
        lastScrub.current = { seconds: -Infinity, at: 0 };
        updateDrag(pos.seconds);
      }}
      onPointerMove={(e) => {
        if (!interactive) return;
        const pos = positionAt(e.clientX);
        setHover(pos);
        if (dragRef.current != null) updateDrag(pos.seconds);
      }}
      onPointerUp={commit}
      onPointerCancel={commit}
      onLostPointerCapture={commit}
      onPointerLeave={() => {
        if (dragRef.current == null) setHover(null);
      }}
    >
      {buffered > 0 ? (
        <div className="absolute inset-y-0 left-0 rounded-full bg-white/35" style={{ width: `${buffered}%` }} />
      ) : null}
      {interactive
        ? movie.chapters
            .filter((chapter) => chapter.startSeconds > 0 && chapter.startSeconds < duration)
            .map((chapter) => (
              <div
                key={chapter.index}
                className="pointer-events-none absolute inset-y-0 w-px bg-white/70"
                style={{ left: `${pct(chapter.startSeconds)}%` }}
              />
            ))
        : null}
      <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${progress}%` }} />
      <div
        className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-accent opacity-0 shadow-[0_0_0_2px_rgb(0_0_0_/_0.25)] transition-[opacity,transform] duration-150 group-hover/bar:opacity-100 group-data-[dragging=true]/bar:scale-125 group-data-[dragging=true]/bar:opacity-100"
        style={{ left: `calc(${progress}% - 7px)` }}
      />
      {previewSeconds != null && interactive ? (
        <div
          className="pointer-events-none absolute bottom-[calc(100%+14px)] -translate-x-1/2"
          style={{ left: previewLeft }}
        >
          <TimelinePreview key={movie.id} movie={movie} seconds={previewSeconds} />
        </div>
      ) : null}
    </div>
  );
}
