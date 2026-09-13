import { useState } from "react";
import { Globe, Play } from "lucide-react";
import type { Movie } from "../lib/types";
import { cn, formatRuntime, isRecentlyAdded } from "../lib/format";
import { QualityBadges } from "./QualityBadge";
import { FavoriteButton } from "./FavoriteButton";
import { WatchedBadge } from "./WatchedBadge";
import { useI18n } from "../lib/locale-context";
import { useItemFlags } from "../lib/userdata-context";

/**
 * 2:3 poster with the title under it (Nuvio style). The hover overlay carries the
 * runtime/quality line, the play button and the "My list" heart.
 */
export function PosterCard({
  movie,
  onOpen,
  onPlay,
  delay = 0,
}: {
  movie: Movie;
  onOpen: (movie: Movie) => void;
  onPlay?: (movie: Movie) => void;
  delay?: number;
}) {
  const { t } = useI18n();
  const flags = useItemFlags(movie);
  const [loaded, setLoaded] = useState(false);
  const runtime = formatRuntime(movie.runtimeTicks);
  const meta = [movie.year ? String(movie.year) : null, runtime || null].filter(Boolean).join(" • ");

  return (
    <div
      className="group relative w-[var(--poster-w)] shrink-0 snap-start"
      style={{ animationDelay: `${delay}ms` }}
      data-item-id={movie.id}
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
        {movie.external ? (
          <span className="pointer-events-none absolute top-2 right-2 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white/80 backdrop-blur-sm" title={t("online")}>
            <Globe size={13} />
          </span>
        ) : (
          <div className="absolute top-2 right-2 flex flex-col items-end gap-1.5">
            <WatchedBadge movie={movie} />
            <FavoriteButton
              movie={movie}
              variant="icon"
              className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
            />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-2.5 pt-12 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
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
      <button type="button" onClick={() => onOpen(movie)} className="mt-2 block w-full text-left" tabIndex={-1}>
        <p className="truncate text-[13px] font-medium text-text group-hover:text-white">{movie.name}</p>
        {meta ? <p className="truncate text-[11px] text-dim tabular">{meta}</p> : null}
      </button>
    </div>
  );
}
