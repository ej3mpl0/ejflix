import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, Play } from "lucide-react";
import type { Movie } from "../lib/types";
import { formatRuntime } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useLocalizedInfo } from "../lib/localized";
import { FavoriteButton } from "./FavoriteButton";
import { WatchedButton } from "./WatchedButton";

const WIDTH = 340;
/** Space kept free between the card and the window edges (and under the header). */
const EDGE = 12;
const HEADER = 72;

/**
 * Hover card over a poster (Netflix style): backdrop, title, year / rating / runtime chips,
 * the start of the synopsis and quick actions (play or resume, My list, watched, details).
 * Placed in viewport coordinates over the poster and kept inside the window once its real
 * height is known. It is purely a mouse affordance: its buttons stay out of the tab order
 * and the poster card itself remains the keyboard target.
 */
export function PosterPreview({
  movie,
  anchor,
  onPlay,
  onOpen,
  onEnter,
  onLeave,
  onDismiss,
}: {
  movie: Movie;
  anchor: DOMRect;
  onPlay?: (movie: Movie) => void;
  onOpen: (movie: Movie) => void;
  onEnter: () => void;
  onLeave: () => void;
  /** The wheel was used over the card: close it so the page scrolls on. */
  onDismiss?: () => void;
}) {
  const { t } = useI18n();
  const overview = useLocalizedInfo(movie)?.overview ?? movie.overview;
  const runtime = formatRuntime(movie.runtimeTicks);
  const chips = [
    movie.year ? String(movie.year) : null,
    movie.officialRating ?? null,
    runtime || null,
  ].filter((chip): chip is string => Boolean(chip));
  const genres = movie.genres.slice(0, 3).join(" · ");
  const image = movie.backdropUrl ?? movie.posterUrl;
  const resume = movie.playbackPositionTicks > 10_000_000 * 30;
  // Channels have no watched state.
  const canWatch = !movie.live;
  const card = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(340);

  useLayoutEffect(() => {
    if (card.current) setHeight(card.current.offsetHeight);
  }, [movie.id]);

  // Centred on the poster, clamped to the window; lifted a little over it, never under the header.
  const left = Math.max(EDGE, Math.min(window.innerWidth - WIDTH - EDGE, anchor.left + anchor.width / 2 - WIDTH / 2));
  const top = Math.max(HEADER, Math.min(window.innerHeight - height - EDGE, anchor.top - 24));

  const iconButton =
    "btn-press grid h-9 w-9 place-items-center rounded-full border border-white/25 text-white hover:border-white/60";

  return createPortal(
    <div
      ref={card}
      className="preview-in fixed z-[45] overflow-hidden rounded-card bg-panel shadow-[0_24px_60px_rgb(0_0_0_/_0.6),0_0_0_1px_rgb(255_255_255_/_0.08)]"
      style={{ left, top, width: WIDTH }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onWheel={onDismiss}
      aria-hidden
    >
      <button type="button" tabIndex={-1} onClick={() => onOpen(movie)} aria-label={movie.name} className="block w-full text-left">
        <div className="relative aspect-video w-full bg-surface">
          {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : null}
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-panel to-transparent" />
          {movie.logoUrl ? (
            <img src={movie.logoUrl} alt="" className="absolute bottom-2 left-3 max-h-[46px] max-w-[60%] object-contain object-left" />
          ) : null}
        </div>
      </button>
      <div className="space-y-2.5 p-3.5 pt-2">
        <p className="truncate text-[15px] font-semibold">{movie.name}</p>
        {chips.length || movie.communityRating ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <span key={chip} className="inline-flex h-6 items-center rounded-md bg-white/8 px-1.5 text-[12px] text-text tabular">
                {chip}
              </span>
            ))}
            {movie.communityRating ? (
              <span className="inline-flex h-6 items-center gap-1 rounded-md bg-white/8 px-1.5 text-[12px] tabular">
                <span className="text-star">★</span>
                {movie.communityRating.toFixed(1)}
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          {onPlay ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => onPlay(movie)}
              className="btn-press inline-flex h-9 items-center gap-1.5 rounded-full bg-white pr-4 pl-3 text-[13px] font-semibold text-black hover:bg-white/90"
            >
              <Play size={15} fill="currentColor" className="translate-x-px" />
              {resume ? t("resume") : t("play")}
            </button>
          ) : null}
          <FavoriteButton movie={movie} variant="outline" tabIndex={-1} />
          {canWatch ? <WatchedButton movie={movie} variant="outline" tabIndex={-1} /> : null}
          <button
            type="button"
            tabIndex={-1}
            onClick={() => onOpen(movie)}
            aria-label={t("moreInfo")}
            title={t("moreInfo")}
            className={`${iconButton} ml-auto`}
          >
            <Info size={16} />
          </button>
        </div>
        {genres ? <p className="truncate text-[12px] text-dim">{genres}</p> : null}
        {overview ? <p className="line-clamp-3 text-[12.5px] leading-[1.5] text-muted">{overview}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
