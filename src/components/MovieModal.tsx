import { useEffect, useState } from "react";
import { Play, RotateCcw, X } from "lucide-react";
import type { Movie } from "../lib/types";
import { api } from "../lib/api";
import { formatClock, formatRuntime, ticksToSeconds } from "../lib/format";
import { QualityBadges } from "./QualityBadge";
import { useI18n } from "../lib/locale-context";

function Ratings({
  community,
  critic,
  criticsLabel,
}: {
  community: number | null;
  critic: number | null;
  criticsLabel: string;
}) {
  if (!community && !critic) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {community ? (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-white/8 px-2 py-1 text-[13px] text-white">
          <span className="text-amber-300">★</span>
          <span className="tabular">{community.toFixed(1)}</span>
          <span className="text-[11px] text-dim">TMDB</span>
        </span>
      ) : null}
      {critic ? (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-white/8 px-2 py-1 text-[13px] text-white">
          <span className="tabular">{Math.round(critic)}%</span>
          <span className="text-[11px] text-dim">{criticsLabel}</span>
        </span>
      ) : null}
    </div>
  );
}

export function MovieModal({
  movie,
  onClose,
  onPlay,
}: {
  movie: Movie;
  onClose: () => void;
  onPlay: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState(movie);

  useEffect(() => {
    let alive = true;
    api.getItem(movie.id).then((full) => {
      if (alive) setDetail(full);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [movie.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter") onPlay(detail);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPlay, detail]);

  const resume = detail.playbackPositionTicks > 10_000_000 * 30;
  const playFromStart = () => onPlay({ ...detail, playbackPositionTicks: 0 });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="modal-enter relative max-h-[90vh] w-[min(920px,92vw)] overflow-y-auto rounded-2xl bg-surface shadow-[0_24px_80px_rgb(0_0_0_/_0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="btn-press absolute top-4 right-4 z-10 grid h-10 w-10 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
          aria-label={t("close")}
        >
          <X size={18} />
        </button>
        <div className="relative aspect-video w-full overflow-hidden">
          {detail.backdropUrl ? (
            <img src={detail.backdropUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-panel" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/20 to-transparent" />
          <div className="absolute bottom-6 left-6 right-16">
            {detail.logoUrl ? (
              <img src={detail.logoUrl} alt={detail.name} className="mb-4 max-h-20 object-contain object-left" />
            ) : (
              <h2 className="mb-4 text-3xl font-extrabold tracking-tight [text-wrap:balance]">{detail.name}</h2>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onPlay(detail)}
                className="btn-press btn-play inline-flex h-11 items-center gap-2 rounded-md bg-white pr-6 pl-5 text-[15px] font-semibold text-black hover:bg-white/85"
              >
                <Play size={18} fill="currentColor" />
                {resume
                  ? t("resumeFrom", { time: formatClock(ticksToSeconds(detail.playbackPositionTicks)) })
                  : t("play")}
              </button>
              {resume ? (
                <button
                  type="button"
                  onClick={playFromStart}
                  className="btn-press inline-flex h-11 items-center gap-2 rounded-md bg-[rgba(109,109,110,0.7)] pr-6 pl-5 text-[15px] font-semibold text-white hover:bg-[rgba(109,109,110,0.5)]"
                >
                  <RotateCcw size={16} />
                  {t("startOver")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="grid gap-8 px-6 py-6 md:grid-cols-[1.4fr_0.8fr]">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
              {detail.year ? <span>{detail.year}</span> : null}
              {detail.runtimeTicks ? <span>{formatRuntime(detail.runtimeTicks)}</span> : null}
              {detail.officialRating ? <span>{detail.officialRating}</span> : null}
              <QualityBadges badges={detail.badges} />
            </div>
            <div className="mb-4">
              <Ratings
                community={detail.communityRating}
                critic={detail.criticRating}
                criticsLabel={t("criticsShort")}
              />
            </div>
            <p className="text-[15px] leading-[1.6] text-[#D4D4D8]">{detail.overview}</p>
          </div>
          <div className="space-y-3 text-[13px] text-muted">
            {detail.genres.length ? (
              <p>
                <span className="text-dim">{t("genres")}: </span>
                <span className="text-text">{detail.genres.join(", ")}</span>
              </p>
            ) : null}
            {detail.directors.length ? (
              <p>
                <span className="text-dim">{t("director")}: </span>
                <span className="text-text">{detail.directors.join(", ")}</span>
              </p>
            ) : null}
            {detail.cast.length ? (
              <p>
                <span className="text-dim">{t("cast")}: </span>
                <span className="text-text">{detail.cast.join(", ")}</span>
              </p>
            ) : null}
            {detail.videoLabel ? (
              <p>
                <span className="text-dim">{t("video")}: </span>
                <span className="text-text">{detail.videoLabel}</span>
              </p>
            ) : null}
            {detail.audioLabel ? (
              <p>
                <span className="text-dim">{t("audio")}: </span>
                <span className="text-text">{detail.audioLabel}</span>
              </p>
            ) : null}
            {detail.subtitleLabels.length ? (
              <p>
                <span className="text-dim">{t("subtitles")}: </span>
                <span className="text-text">{detail.subtitleLabels.join(", ")}</span>
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
