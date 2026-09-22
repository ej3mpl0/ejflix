import type { Movie } from "../lib/types";
import { formatRuntime } from "../lib/format";
import { QualityBadges } from "./QualityBadge";
import { useI18n } from "../lib/locale-context";

/** Year · certificate · runtime · ratings · quality badges · series status. */
export function MetaChips({ movie, seasons }: { movie: Movie; seasons?: number }) {
  const { t } = useI18n();
  const runtime = formatRuntime(movie.runtimeTicks);
  const years =
    movie.kind === "Series" && movie.year
      ? movie.endYear && movie.endYear !== movie.year
        ? `${movie.year}–${movie.endYear}`
        : movie.status === "Continuing"
          ? `${movie.year}–`
          : String(movie.year)
      : movie.year
        ? String(movie.year)
        : null;

  const chip = (content: string, extra = "") => (
    <span className={`inline-flex h-7 items-center rounded-md bg-white/8 px-2 text-[13px] text-text tabular ${extra}`}>
      {content}
    </span>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {years ? chip(years) : null}
      {movie.officialRating ? (
        <span className="inline-flex h-7 items-center rounded-md border border-white/20 px-2 text-[12px] font-semibold text-text">
          {movie.officialRating}
        </span>
      ) : null}
      {runtime ? chip(runtime) : null}
      {seasons ? chip(seasons === 1 ? t("seasonsOne") : t("seasonsCount", { n: seasons })) : null}
      {movie.communityRating ? (
        <span className="inline-flex h-7 items-center gap-1 rounded-md bg-white/8 px-2 text-[13px] tabular">
          <span className="text-star">★</span>
          {movie.communityRating.toFixed(1)}
        </span>
      ) : null}
      {movie.criticRating ? (
        <span className="inline-flex h-7 items-center gap-1 rounded-md bg-white/8 px-2 text-[13px] tabular">
          {Math.round(movie.criticRating)}%
          <span className="text-[11px] text-dim">{t("criticsShort")}</span>
        </span>
      ) : null}
      {movie.kind === "Series" && movie.status ? (
        <span className="inline-flex h-7 items-center rounded-md bg-white/8 px-2 text-[12px] text-muted">
          {movie.status === "Ended" ? t("ended") : t("continuing")}
        </span>
      ) : null}
      <QualityBadges badges={movie.badges} />
    </div>
  );
}
