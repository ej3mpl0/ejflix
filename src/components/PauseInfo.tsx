import type { Movie } from "../lib/types";
import { formatRuntime } from "../lib/format";

/** Compact metadata block shown under the title while playback is paused. */
export function PauseInfo({ movie, heading }: { movie: Movie; heading: string }) {
  const meta = [
    movie.year ? String(movie.year) : null,
    formatRuntime(movie.runtimeTicks) || null,
    movie.officialRating,
  ].filter(Boolean);
  const genres = movie.genres.slice(0, 3).join(" • ");

  return (
    <div className="fade-in pointer-events-none absolute top-[92px] left-5 z-20 flex max-w-[460px] items-start gap-4">
      {movie.posterUrl ? (
        <img
          src={movie.posterUrl}
          alt=""
          className="img-outline h-[84px] w-[56px] shrink-0 rounded-md object-cover shadow-[0_8px_24px_rgb(0_0_0_/_0.5)]"
        />
      ) : movie.logoUrl ? (
        <img src={movie.logoUrl} alt="" className="max-h-10 max-w-[120px] shrink-0 object-contain" />
      ) : null}
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-white">{heading}</p>
        {meta.length ? <p className="mt-0.5 text-[12px] text-white/70 tabular">{meta.join(" · ")}</p> : null}
        {genres ? <p className="text-[12px] text-white/60">{genres}</p> : null}
        {movie.overview ? (
          <p className="mt-1.5 line-clamp-3 text-[13px] leading-[1.5] text-muted">{movie.overview}</p>
        ) : null}
      </div>
    </div>
  );
}
