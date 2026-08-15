import { Play } from "lucide-react";
import type { Movie } from "../lib/types";
import { remainingMinutes } from "../lib/format";
import { useI18n } from "../lib/locale-context";

export function ContinueCard({
  movie,
  onPlay,
  onOpen,
}: {
  movie: Movie;
  onPlay: (movie: Movie) => void;
  onOpen: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const remaining = remainingMinutes(movie.runtimeTicks, movie.playbackPositionTicks);
  const progress = movie.playedPercentage || 0;

  return (
    <div className="group relative w-[clamp(240px,24vw,320px)] shrink-0 snap-start">
      <div className="img-outline relative aspect-video w-full overflow-hidden rounded-md bg-surface">
        <button
          type="button"
          onClick={() => onOpen(movie)}
          className="absolute inset-0"
        >
          {movie.backdropUrl || movie.posterUrl ? (
            <img
              src={movie.backdropUrl || movie.posterUrl || ""}
              alt={movie.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted">{movie.name}</div>
          )}
        </button>
        <div className="pointer-events-none absolute inset-0 bg-black/20 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
        <button
          type="button"
          className="btn-play absolute top-1/2 left-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-black opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          onClick={() => onPlay(movie)}
          aria-label={`${t("play")} ${movie.name}`}
        >
          <Play size={20} fill="currentColor" />
        </button>
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, progress)}%` }} />
        </div>
      </div>
      <p className="mt-2 truncate text-sm text-text">{movie.name}</p>
      <p className="text-[12px] text-dim tabular">{t("remaining", { n: remaining })}</p>
    </div>
  );
}
