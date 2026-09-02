import { useEffect, useState } from "react";
import { Play, X } from "lucide-react";
import type { Movie } from "../lib/types";
import { api } from "../lib/api";
import { cn, episodeCode, formatRuntime } from "../lib/format";
import { QualityBadges } from "./QualityBadge";
import { useI18n } from "../lib/locale-context";

/** Series details: header, metadata, season picker and the episode list. */
export function SeriesModal({
  seriesId,
  initialSeasonId = null,
  onClose,
  onPlay,
}: {
  seriesId: string;
  /** Season to open first (e.g. the season of the episode that was clicked). */
  initialSeasonId?: string | null;
  onClose: () => void;
  onPlay: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<Movie | null>(null);
  const [seasons, setSeasons] = useState<Movie[]>([]);
  const [seasonId, setSeasonId] = useState<string | null>(initialSeasonId);
  const [episodes, setEpisodes] = useState<Movie[] | null>(null);
  const [nextUp, setNextUp] = useState<Movie | null>(null);
  const [error, setError] = useState("");
  const [backdropLoaded, setBackdropLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getItem(seriesId)
      .then((full) => {
        if (alive) setDetail(full);
      })
      .catch(() => undefined);
    Promise.all([api.getSeasons(seriesId), api.getSeriesNextUp(seriesId).catch(() => null)])
      .then(([list, next]) => {
        if (!alive) return;
        setSeasons(list);
        setNextUp(next);
        setSeasonId((current) => current ?? next?.seasonId ?? list[0]?.id ?? null);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [seriesId]);

  useEffect(() => {
    if (!seasonId) return;
    let alive = true;
    setEpisodes(null);
    api
      .getEpisodes(seriesId, seasonId)
      .then((list) => {
        if (alive) setEpisodes(list);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [seriesId, seasonId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const startEpisode = nextUp ?? episodes?.[0] ?? null;
  const startCode = startEpisode ? episodeCode(startEpisode, t("episodeCode")) : "";
  const startResumes = (startEpisode?.playbackPositionTicks ?? 0) > 10_000_000 * 30;
  const playLabel = !startEpisode || !startCode
    ? t("play")
    : startResumes
      ? t("resumeEpisode", { code: startCode })
      : t("playEpisode", { code: startCode });
  const name = detail?.name ?? "";

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
          {detail?.backdropUrl ? (
            <img
              src={detail.backdropUrl}
              alt=""
              onLoad={() => setBackdropLoaded(true)}
              className={cn(
                "h-full w-full object-cover transition-opacity duration-300",
                backdropLoaded ? "opacity-100" : "opacity-0",
              )}
            />
          ) : (
            <div className="h-full w-full bg-panel" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/20 to-transparent" />
          <div className="absolute bottom-6 left-6 right-16">
            {detail?.logoUrl ? (
              <img src={detail.logoUrl} alt={name} className="mb-4 max-h-20 object-contain object-left" />
            ) : name ? (
              <h2 className="mb-4 text-3xl font-extrabold tracking-tight [text-wrap:balance]">{name}</h2>
            ) : (
              <div className="mb-4 h-9 w-72 rounded-md bg-white/8" />
            )}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!startEpisode}
                onClick={() => startEpisode && onPlay(startEpisode)}
                className="btn-press btn-play inline-flex h-11 items-center gap-2 rounded-md bg-white pr-6 pl-5 text-[15px] font-semibold text-black hover:bg-white/85 disabled:opacity-60"
              >
                <Play size={18} fill="currentColor" />
                {playLabel}
              </button>
            </div>
          </div>
        </div>
        <div className="grid gap-8 px-6 py-6 md:grid-cols-[1.4fr_0.8fr]">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
              {detail?.year ? <span>{detail.year}</span> : null}
              {detail?.officialRating ? <span>{detail.officialRating}</span> : null}
              {detail?.communityRating ? (
                <span className="text-amber-300 tabular">★ {detail.communityRating.toFixed(1)}</span>
              ) : null}
              {seasons.length ? (
                <span>
                  {seasons.length} {seasons.length === 1 ? t("season") : t("season").toLowerCase() + "s"}
                </span>
              ) : null}
              {detail ? <QualityBadges badges={detail.badges} /> : null}
            </div>
            {detail?.overview ? (
              <p className="text-[15px] leading-[1.6] text-[#D4D4D8]">{detail.overview}</p>
            ) : null}
          </div>
          <div className="space-y-3 text-[13px] text-muted">
            {detail?.genres.length ? (
              <p>
                <span className="text-dim">{t("genres")}: </span>
                <span className="text-text">{detail.genres.join(", ")}</span>
              </p>
            ) : null}
            {detail?.cast.length ? (
              <p>
                <span className="text-dim">{t("cast")}: </span>
                <span className="text-text">{detail.cast.join(", ")}</span>
              </p>
            ) : null}
          </div>
        </div>
        <div className="px-6 pb-6">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h3 className="text-[15px] font-semibold">{t("episodes")}</h3>
            {seasons.length > 1 ? (
              <select
                value={seasonId ?? ""}
                onChange={(e) => setSeasonId(e.target.value)}
                aria-label={t("season")}
                className="h-9 max-w-[240px] rounded-md border border-white/15 bg-black/60 px-3 text-sm text-white outline-none focus:border-white/40"
              >
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name}
                  </option>
                ))}
              </select>
            ) : seasons[0] ? (
              <span className="text-sm text-muted">{seasons[0].name}</span>
            ) : null}
          </div>
          {error ? <p className="text-sm text-muted">{error}</p> : null}
          {episodes == null && !error ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-4 p-2">
                  <div className="aspect-video w-[200px] shrink-0 animate-[pulse-soft_1.6s_ease-in-out_infinite] rounded-md bg-white/5" />
                  <div className="flex-1 space-y-2 py-2">
                    <div className="h-4 w-1/2 rounded bg-white/6" />
                    <div className="h-3 w-5/6 rounded bg-white/5" />
                    <div className="h-3 w-2/3 rounded bg-white/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {episodes && !episodes.length ? <p className="text-sm text-muted">{t("noEpisodes")}</p> : null}
          {episodes?.length ? (
            <div className="space-y-1">
              {episodes.map((episode) => {
                const runtime = formatRuntime(episode.runtimeTicks);
                const progress = episode.playedPercentage || 0;
                const number = episode.episodeNumber != null ? `${episode.episodeNumber}. ` : "";
                return (
                  <button
                    key={episode.id}
                    type="button"
                    onClick={() => onPlay(episode)}
                    className="group/ep flex w-full items-start gap-4 rounded-lg p-2 text-left transition-colors duration-150 hover:bg-white/5"
                  >
                    <div className="img-outline relative aspect-video w-[200px] shrink-0 overflow-hidden rounded-md bg-panel">
                      {episode.thumbUrl ? (
                        <img src={episode.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : null}
                      <div className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition-opacity duration-150 group-hover/ep:opacity-100">
                        <span className="grid h-10 w-10 place-items-center rounded-full bg-white/90 text-black">
                          <Play size={18} fill="currentColor" className="translate-x-px" />
                        </span>
                      </div>
                      {progress > 0 ? (
                        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
                          <div className="h-full bg-accent" style={{ width: `${Math.min(100, progress)}%` }} />
                        </div>
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1 py-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="truncate text-[15px] font-medium text-white">
                          {number}
                          {episode.name}
                        </p>
                        {runtime ? <span className="shrink-0 text-[12px] text-dim tabular">{runtime}</span> : null}
                      </div>
                      {episode.overview ? (
                        <p className="mt-1 line-clamp-2 text-[13px] leading-[1.5] text-muted">{episode.overview}</p>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
