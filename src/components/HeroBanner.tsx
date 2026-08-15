import { Info, Play, RotateCcw } from "lucide-react";
import type { Movie } from "../lib/types";
import { formatRuntime } from "../lib/format";
import { QualityBadges } from "./QualityBadge";
import { useI18n } from "../lib/locale-context";

export function HeroBanner({
  movie,
  onPlay,
  onMore,
}: {
  movie: Movie;
  onPlay: (movie: Movie) => void;
  onMore: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const resume = movie.playbackPositionTicks > 10_000_000 * 30;

  return (
    <section className="relative min-h-[480px] h-[78vh] w-full overflow-hidden">
      {movie.backdropUrl ? (
        <img
          src={movie.backdropUrl}
          alt=""
          className="fade-in absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-surface" />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-base via-base/70 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-base via-base/20 to-black/20" />

      <div className="absolute bottom-20 left-12 max-w-xl">
        {movie.logoUrl ? (
          <img
            src={movie.logoUrl}
            alt={movie.name}
            className="enter mb-5 max-h-[120px] max-w-[420px] object-contain object-left"
          />
        ) : (
          <h1 className="enter mb-4 text-[clamp(32px,5vw,56px)] leading-[1.05] font-extrabold tracking-[-0.02em] [text-wrap:balance]">
            {movie.name}
          </h1>
        )}
        <div className="enter enter-d1 mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
          {movie.year ? <span>{movie.year}</span> : null}
          {movie.runtimeTicks ? (
            <>
              <span>•</span>
              <span>{formatRuntime(movie.runtimeTicks)}</span>
            </>
          ) : null}
          {movie.officialRating ? (
            <>
              <span>•</span>
              <span className="rounded border border-white/20 px-1.5 py-0.5 text-[11px]">
                {movie.officialRating}
              </span>
            </>
          ) : null}
          {movie.communityRating ? (
            <>
              <span>•</span>
              <span className="text-amber-300 tabular">★ {movie.communityRating.toFixed(1)}</span>
            </>
          ) : null}
          {movie.criticRating ? (
            <>
              <span>•</span>
              <span className="tabular">{Math.round(movie.criticRating)}% {t("critics")}</span>
            </>
          ) : null}
          <QualityBadges badges={movie.badges} />
        </div>
        {movie.overview ? (
          <p className="enter enter-d2 mb-6 line-clamp-3 text-[15px] leading-[1.6] text-[#D4D4D8]">
            {movie.overview}
          </p>
        ) : null}
        <div className="enter enter-d3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onPlay(movie)}
            className="btn-press btn-play inline-flex h-11 items-center gap-2 rounded-md bg-white pr-6 pl-5 text-[15px] font-semibold text-black hover:bg-white/85"
          >
            <Play size={18} fill="currentColor" />
            {resume ? t("resume") : t("play")}
          </button>
          {resume ? (
            <button
              type="button"
              onClick={() => onPlay({ ...movie, playbackPositionTicks: 0 })}
              className="btn-press inline-flex h-11 items-center gap-2 rounded-md bg-[rgba(109,109,110,0.7)] pr-6 pl-5 text-[15px] font-semibold text-white hover:bg-[rgba(109,109,110,0.5)]"
            >
              <RotateCcw size={16} />
              {t("playFromStart")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onMore(movie)}
              className="btn-press inline-flex h-11 items-center gap-2 rounded-md bg-[rgba(109,109,110,0.7)] pr-6 pl-5 text-[15px] font-semibold text-white hover:bg-[rgba(109,109,110,0.5)]"
            >
              <Info size={18} />
              {t("moreInfo")}
            </button>
          )}
          {resume ? (
            <button
              type="button"
              onClick={() => onMore(movie)}
              className="btn-press inline-flex h-11 items-center gap-2 rounded-md bg-[rgba(109,109,110,0.45)] pr-6 pl-5 text-[15px] font-semibold text-white hover:bg-[rgba(109,109,110,0.35)]"
            >
              <Info size={18} />
              {t("moreInfo")}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
