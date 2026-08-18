import { useState } from "react";
import type { Movie } from "../lib/types";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";

export function PosterCard({
  movie,
  onOpen,
  delay = 0,
}: {
  movie: Movie;
  onOpen: (movie: Movie) => void;
  delay?: number;
}) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);

  return (
    <button
      type="button"
      onClick={() => onOpen(movie)}
      className="poster-card group relative w-[clamp(150px,16vw,210px)] shrink-0 snap-start overflow-hidden rounded-[6px] bg-surface text-left"
      style={{ animationDelay: `${delay}ms` }}
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
        {movie.kind === "Series" ? (
          <span className="absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white/90">
            {t("series").toUpperCase()}
          </span>
        ) : null}
      </div>
      {movie.playedPercentage > 2 ? (
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/15">
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, movie.playedPercentage)}%` }} />
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-2.5 pt-10 opacity-0 transition-opacity duration-180 group-hover:opacity-100">
        <p className="line-clamp-2 text-[13px] font-medium text-white">{movie.name}</p>
        {movie.year ? <p className="text-[11px] text-white/70">{movie.year}</p> : null}
      </div>
    </button>
  );
}
