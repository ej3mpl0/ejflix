import { useState } from "react";
import { Play } from "lucide-react";
import type { Movie } from "../lib/types";
import { cn, formatRuntime, isRecentlyAdded } from "../lib/format";
import { QualityBadges } from "./QualityBadge";
import { useI18n } from "../lib/locale-context";

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
  const [loaded, setLoaded] = useState(false);
  const runtime = formatRuntime(movie.runtimeTicks);

  return (
    <div
      className="poster-card group relative w-[clamp(150px,16vw,210px)] shrink-0 snap-start overflow-hidden rounded-[6px] bg-surface text-left"
      style={{ animationDelay: `${delay}ms` }}
    >
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
              alt={movie.name}
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
        <span className="pointer-events-none absolute top-2 left-2 rounded-[3px] bg-accent px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase shadow-[0_2px_8px_rgb(0_0_0_/_0.5)]">
          {t("newBadge")}
        </span>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent p-2.5 pt-14 opacity-0 transition-opacity duration-180 group-hover:opacity-100 group-focus-within:opacity-100">
        <p className="line-clamp-2 text-[13px] font-medium text-white">{movie.name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-white/70 tabular">
          {movie.year ? <span>{movie.year}</span> : null}
          {movie.year && runtime ? <span aria-hidden>•</span> : null}
          {runtime ? <span>{runtime}</span> : null}
        </p>
        {movie.badges.length ? (
          <QualityBadges
            badges={movie.badges.slice(0, 2)}
            className="mt-1.5 [&>span]:px-1.5 [&>span]:py-0 [&>span]:text-[9px]"
          />
        ) : null}
      </div>
      {movie.playedPercentage > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, movie.playedPercentage)}%` }} />
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
  );
}
