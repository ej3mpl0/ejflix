import { useEffect, useRef, useState } from "react";
import { Globe, ListPlus, Play } from "lucide-react";
import type { Movie } from "../lib/types";
import { cn, formatRuntime, isRecentlyAdded } from "../lib/format";
import { QualityBadges } from "./QualityBadge";
import { FavoriteButton } from "./FavoriteButton";
import { WatchedBadge } from "./WatchedBadge";
import { useI18n } from "../lib/locale-context";
import { useItemFlags } from "../lib/userdata-context";
import { PosterPreview } from "./PosterPreview";
import { KebabMenu, type MenuAction } from "./KebabMenu";
import { listKeyOf, useCustomLists } from "../lib/lists-context";

const PREVIEW_DELAY_MS = 500;
/** Only a real mouse gets the hover card (touch screens and pens would trip it on tap). */
const finePointer = typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches;

/**
 * 2:3 poster card in one of three shapes:
 *
 * - `row`  fixed width with the title under it, for the horizontal rails.
 * - `grid` the same card, but filling its grid column so the last column does not
 *          leave a ragged margin on the right of the page.
 * - `wall` art only: no text under the poster, the title appears over it on hover.
 *
 * The hover overlay carries the quality badges, the play button and the "My list" heart.
 */
export function PosterCard({
  movie,
  onOpen,
  onPlay,
  delay = 0,
  layout = "row",
  menu = [],
}: {
  movie: Movie;
  onOpen: (movie: Movie) => void;
  onPlay?: (movie: Movie) => void;
  delay?: number;
  layout?: "row" | "grid" | "wall";
  /** Extra entries of the card's menu ("Remove from this list" on a list page). */
  menu?: MenuAction[];
}) {
  const { t } = useI18n();
  const { openPicker } = useCustomLists();
  const actions: MenuAction[] = listKeyOf(movie)
    ? [{ id: "lists", label: t("addToLists"), icon: <ListPlus size={15} />, onSelect: () => openPicker(movie) }, ...menu]
    : menu;
  const flags = useItemFlags(movie);
  const [loaded, setLoaded] = useState(false);
  const runtime = formatRuntime(movie.runtimeTicks);
  const meta = [movie.year ? String(movie.year) : null, runtime || null].filter(Boolean).join(" • ");
  const wall = layout === "wall";
  const [preview, setPreview] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const armed = useRef(false);
  // Armed by the mouse actually moving over the card: a card that slides under a still
  // pointer (keyboard or gamepad scrolling the row) does not pop its preview.
  const armPreview = () => {
    if (!finePointer || armed.current) return;
    armed.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const rect = cardRef.current?.getBoundingClientRect();
      if (rect) setPreview(rect);
    }, PREVIEW_DELAY_MS);
  };
  const dropPreview = () => {
    armed.current = false;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPreview(null), 120);
  };
  useEffect(() => {
    if (!preview) return;
    // Any scroll moves the poster away from the card, and a key press means the keyboard
    // (or a gamepad) is driving: close it.
    const close = () => setPreview(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", close, true);
    };
  }, [preview]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div
      className={cn(
        // Lifted over its neighbours: in a tight grid the hover scale would otherwise
        // slide under the card that comes after it in the DOM.
        "group relative z-0 shrink-0 snap-start hover:z-10 focus-within:z-10",
        layout === "row" ? "w-[var(--poster-w)]" : "w-full",
      )}
      style={{ animationDelay: `${delay}ms` }}
      data-item-id={movie.id}
      data-poster
      ref={cardRef}
      onMouseMove={armPreview}
      onMouseLeave={dropPreview}
    >
      <div className="poster-card card-depth relative overflow-hidden rounded-poster bg-surface">
        <button
          type="button"
          onClick={() => onOpen(movie)}
          className="block w-full text-left"
          aria-label={movie.name}
        >
          <div className="aspect-[2/3] w-full bg-white/5">
            {movie.posterUrl ? (
              <img
                src={movie.posterUrl}
                alt=""
                loading="lazy"
                onLoad={() => setLoaded(true)}
                className={cn("h-full w-full object-cover", loaded && "img-fade")}
              />
            ) : (
              <div className="grid h-full place-items-center px-3 text-center text-sm text-muted">
                {movie.name}
              </div>
            )}
          </div>
        </button>
        {isRecentlyAdded(movie.dateCreated) ? (
          <span className="pointer-events-none absolute top-2 left-2 rounded-[4px] bg-accent px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-on-accent uppercase shadow-[0_2px_8px_rgb(0_0_0_/_0.5)]">
            {t("newBadge")}
          </span>
        ) : null}
        {/* Online titles keep their globe and get the "My list" heart too (saved locally). */}
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1.5">
          {movie.external ? (
            <span className="pointer-events-none grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white/80 backdrop-blur-sm" title={t("online")}>
              <Globe size={13} />
            </span>
          ) : (
            <WatchedBadge movie={movie} />
          )}
          <FavoriteButton
            movie={movie}
            variant="icon"
            className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
          />
          {actions.length ? (
            <div className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100">
              <KebabMenu
                label={t("moreOptions")}
                className="bg-black/60 text-white/90 backdrop-blur-sm hover:bg-black/80"
                actions={actions}
              />
            </div>
          ) : null}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent p-2.5 pt-14 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          {wall ? (
            <p className="mb-1 line-clamp-2 text-[12.5px] leading-tight font-semibold text-white">{movie.name}</p>
          ) : null}
          {movie.badges.length ? (
            <QualityBadges
              badges={movie.badges.slice(0, 2)}
              className="[&>span]:px-1.5 [&>span]:py-0 [&>span]:text-[9px]"
            />
          ) : null}
        </div>
        {flags.playedPercentage > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
            <div className="h-full bg-accent" style={{ width: `${Math.min(100, flags.playedPercentage)}%` }} />
          </div>
        ) : null}
        {onPlay ? (
          <button
            type="button"
            className="btn-play btn-press absolute top-1/2 left-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-black opacity-0 shadow-[0_6px_20px_rgb(0_0_0_/_0.45)] transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => onPlay(movie)}
            aria-label={`${t("play")} ${movie.name}`}
          >
            <Play size={18} fill="currentColor" />
          </button>
        ) : null}
      </div>
      {wall ? null : (
        <button type="button" onClick={() => onOpen(movie)} className="mt-2 block w-full text-left" tabIndex={-1}>
          <p className="truncate text-[13px] font-medium text-text group-hover:text-white">{movie.name}</p>
          {meta ? <p className="truncate text-[11px] text-dim tabular">{meta}</p> : null}
        </button>
      )}
      {preview ? (
        <PosterPreview
          movie={movie}
          anchor={preview}
          onPlay={onPlay}
          onOpen={(m) => {
            setPreview(null);
            onOpen(m);
          }}
          onEnter={() => window.clearTimeout(timer.current)}
          onLeave={dropPreview}
          onDismiss={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
