import { createPortal } from "react-dom";
import { Info, Play } from "lucide-react";
import type { Movie } from "../lib/types";
import { formatRuntime } from "../lib/format";
import { useI18n } from "../lib/locale-context";

const WIDTH = 340;

/**
 * Hover card over a poster (Netflix style): backdrop, title, a meta line and the start of
 * the synopsis, with play and details. Placed in viewport coordinates beside the poster
 * and kept inside the window; it is purely a mouse affordance (the card itself stays the
 * keyboard target).
 */
export function PosterPreview({
  movie,
  anchor,
  onPlay,
  onOpen,
  onEnter,
  onLeave,
}: {
  movie: Movie;
  anchor: DOMRect;
  onPlay?: (movie: Movie) => void;
  onOpen: (movie: Movie) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { t } = useI18n();
  const runtime = formatRuntime(movie.runtimeTicks);
  const meta = [movie.year ? String(movie.year) : null, movie.genres.slice(0, 2).join(" · ") || null, runtime || null]
    .filter(Boolean)
    .join(" • ");
  const image = movie.backdropUrl ?? movie.posterUrl;
  // Centred on the poster, clamped to the window; above it when there is room below the header.
  const left = Math.max(12, Math.min(window.innerWidth - WIDTH - 12, anchor.left + anchor.width / 2 - WIDTH / 2));
  const top = Math.max(72, Math.min(window.innerHeight - 340, anchor.top - 24));

  return createPortal(
    <div
      className="preview-in fixed z-[45] overflow-hidden rounded-card bg-panel shadow-[0_24px_60px_rgb(0_0_0_/_0.6),0_0_0_1px_rgb(255_255_255_/_0.08)]"
      style={{ left, top, width: WIDTH }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      aria-hidden
    >
      <button type="button" tabIndex={-1} onClick={() => onOpen(movie)} className="block w-full text-left">
        <div className="relative aspect-video w-full bg-surface">
          {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : null}
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-panel to-transparent" />
          {movie.logoUrl ? (
            <img src={movie.logoUrl} alt="" className="absolute bottom-2 left-3 max-h-[46px] max-w-[60%] object-contain object-left" />
          ) : null}
        </div>
      </button>
      <div className="space-y-2 p-3.5 pt-2">
        <div className="flex items-center gap-2">
          {onPlay ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => onPlay(movie)}
              aria-label={`${t("play")} ${movie.name}`}
              className="btn-press grid h-9 w-9 place-items-center rounded-full bg-white text-black hover:bg-white/90"
            >
              <Play size={16} fill="currentColor" className="translate-x-px" />
            </button>
          ) : null}
          <button
            type="button"
            tabIndex={-1}
            onClick={() => onOpen(movie)}
            aria-label={t("viewDetails")}
            className="btn-press grid h-9 w-9 place-items-center rounded-full border border-white/25 text-white hover:border-white/60"
          >
            <Info size={16} />
          </button>
          <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{movie.name}</p>
        </div>
        {meta ? <p className="text-[12px] text-dim tabular">{meta}</p> : null}
        {movie.overview ? <p className="line-clamp-3 text-[12.5px] leading-[1.5] text-muted">{movie.overview}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
