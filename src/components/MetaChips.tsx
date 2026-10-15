import type { Movie } from "../lib/types";
import { formatRuntime } from "../lib/format";
import { QualityBadges } from "./QualityBadge";
import { useI18n } from "../lib/locale-context";
import { cn } from "../lib/format";

/**
 * One line of facts, the same one the Home hero shows: kind, genres, years, certificate,
 * runtime or seasons, ratings, quality. Spacing separates them; the dot is kept for what is live.
 */
export function MetaChips({ movie, seasons, className }: { movie: Movie; seasons?: number; className?: string }) {
  const { t } = useI18n();
  const runtime = formatRuntime(movie.runtimeTicks);
  const isSeries = movie.kind === "Series";
  const years =
    isSeries && movie.year
      ? movie.endYear && movie.endYear !== movie.year
        ? `${movie.year}–${movie.endYear}`
        : movie.status === "Continuing"
          ? `${movie.year}–`
          : String(movie.year)
      : movie.year
        ? String(movie.year)
        : null;
  const genres = movie.genres.slice(0, 2).join(", ");

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[14px] font-medium text-text/80", className)}>
      <span>{isSeries ? t("kindSeries") : t("kindMovie")}</span>
      {genres ? <span>{genres}</span> : null}
      {years ? <span className="tabular">{years}</span> : null}
      {movie.officialRating ? (
        <span className="rounded-[5px] border border-white/35 px-1.5 text-[12px] font-bold">{movie.officialRating}</span>
      ) : null}
      {seasons ? (
        <span>{seasons === 1 ? t("seasonsOne") : t("seasonsCount", { n: seasons })}</span>
      ) : runtime ? (
        <span className="tabular">{runtime}</span>
      ) : null}
      {movie.communityRating ? <span className="text-star tabular">★ {movie.communityRating.toFixed(1)}</span> : null}
      {movie.criticRating ? (
        <span className="tabular">
          {Math.round(movie.criticRating)}% <span className="text-[12px] text-muted">{t("criticsShort")}</span>
        </span>
      ) : null}
      {isSeries && movie.status ? (
        <span className="text-muted">{movie.status === "Ended" ? t("ended") : t("continuing")}</span>
      ) : null}
      <QualityBadges badges={movie.badges} />
    </div>
  );
}
