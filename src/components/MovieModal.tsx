import { useEffect, useState } from "react";
import { Check, Play, RotateCcw, X, Plus } from "lucide-react";
import type { Movie } from "../lib/types";
import { api } from "../lib/api";
import { formatClock, formatRuntime, ticksToSeconds } from "../lib/format";
import { QualityBadges } from "./QualityBadge";
import { useI18n } from "../lib/locale-context";
import { cn } from "../lib/format";

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

function EpisodeRow({
  episode,
  onPlay,
  code,
}: {
  episode: Movie;
  onPlay: (item: Movie) => void;
  code: string | null;
}) {
  const { t } = useI18n();
  const resume = episode.playbackPositionTicks > 10_000_000 * 30;
  return (
    <button
      type="button"
      onClick={() => onPlay(episode)}
      className="group flex w-full gap-3 rounded-lg p-2 text-left hover:bg-white/5"
    >
      <div className="relative h-[72px] w-[128px] shrink-0 overflow-hidden rounded-md bg-white/5">
        {episode.backdropUrl || episode.posterUrl ? (
          <img
            src={episode.backdropUrl || episode.posterUrl || ""}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : null}
        <div className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
          <Play size={18} fill="white" className="text-white" />
        </div>
        {episode.played ? (
          <span className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white">
            <Check size={12} />
          </span>
        ) : null}
        {episode.playedPercentage > 0 && !episode.played ? (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
            <div className="h-full bg-accent" style={{ width: `${Math.min(100, episode.playedPercentage)}%` }} />
          </div>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-[14px] font-medium", episode.played && "text-muted")}>
          {code ? <span className="mr-2 text-dim tabular">{code}</span> : null}
          {episode.name}
        </p>
        <p className="mt-0.5 text-[12px] text-dim">
          {episode.runtimeTicks ? formatRuntime(episode.runtimeTicks) : null}
          {resume ? ` · ${t("resumeFrom", { time: formatClock(ticksToSeconds(episode.playbackPositionTicks)) })}` : null}
          {episode.played ? ` · ${t("played")}` : null}
        </p>
        {episode.overview ? (
          <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted">{episode.overview}</p>
        ) : null}
      </div>
    </button>
  );
}

export function MovieModal({
  movie,
  onClose,
  onPlay,
  onOpen,
  onFavorite,
}: {
  movie: Movie;
  onClose: () => void;
  onPlay: (movie: Movie) => void;
  onOpen?: (movie: Movie) => void;
  onFavorite?: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState(movie);
  const [seasons, setSeasons] = useState<Movie[]>([]);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<Movie[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [saving, setSaving] = useState(false);

  const series = detail.kind === "Series";
  const episode = detail.kind === "Episode";
  const seriesId = series ? detail.id : detail.seriesId;

  useEffect(() => {
    let alive = true;
    setDetail(movie);
    setSeasons([]);
    setEpisodes([]);
    setSeasonId(movie.kind === "Season" ? movie.id : movie.seasonId);
    api.getItem(movie.id).then((full) => {
      if (alive) setDetail(full);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [movie.id]);

  useEffect(() => {
    if (!seriesId) return;
    let alive = true;
    api.getSeasons(seriesId).then((rows) => {
      if (!alive) return;
      const usable = rows.filter((row) => row.kind !== "Season" || row.name.toLowerCase() !== "specials" || rows.length === 1);
      setSeasons(usable);
      setSeasonId((current) => current && usable.some((row) => row.id === current) ? current : usable[0]?.id ?? null);
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [seriesId]);

  useEffect(() => {
    if (!seriesId || !seasonId) return;
    let alive = true;
    setLoadingEpisodes(true);
    api.getEpisodes(seriesId, seasonId).then((rows) => {
      if (alive) setEpisodes(rows);
    }).catch(() => undefined).finally(() => {
      if (alive) setLoadingEpisodes(false);
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

  const resume = detail.playbackPositionTicks > 10_000_000 * 30;
  const playFromStart = () => onPlay({ ...detail, playbackPositionTicks: 0 });
  const episodeLabel =
    episode && detail.seasonNumber != null && detail.episodeNumber != null
      ? t("episodeCode", { s: detail.seasonNumber, e: detail.episodeNumber })
      : null;

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
              <h2 className="mb-2 text-3xl font-extrabold tracking-tight [text-wrap:balance]">{detail.name}</h2>
            )}
            {episode && detail.seriesName ? (
              <p className="mb-3 text-sm text-muted">
                {detail.seriesName}
                {episodeLabel ? ` · ${episodeLabel}` : ""}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onPlay(detail)}
                className="btn-press btn-play inline-flex h-11 items-center gap-2 rounded-md bg-white pr-6 pl-5 text-[15px] font-semibold text-black hover:bg-white/85"
              >
                <Play size={18} fill="currentColor" />
                {series
                  ? t("play")
                  : resume
                    ? t("resumeFrom", { time: formatClock(ticksToSeconds(detail.playbackPositionTicks)) })
                    : t("play")}
              </button>
              {resume && !series ? (
                <button
                  type="button"
                  onClick={playFromStart}
                  className="btn-press inline-flex h-11 items-center gap-2 rounded-md bg-[rgba(109,109,110,0.7)] pr-6 pl-5 text-[15px] font-semibold text-white hover:bg-[rgba(109,109,110,0.5)]"
                >
                  <RotateCcw size={16} />
                  {t("startOver")}
                </button>
              ) : null}
              {episode && detail.seriesId && onOpen ? (
                <button
                  type="button"
                  onClick={() => onOpen({ ...detail, id: detail.seriesId!, kind: "Series", name: detail.seriesName || detail.name })}
                  className="btn-press inline-flex h-11 items-center rounded-md bg-[rgba(109,109,110,0.45)] px-5 text-[15px] font-semibold text-white hover:bg-[rgba(109,109,110,0.35)]"
                >
                  {t("goToSeries")}
                </button>
              ) : null}
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    const next = !detail.favorite;
                    await api.setFavorite(detail.id, next);
                    const updated = { ...detail, favorite: next };
                    setDetail(updated);
                    onFavorite?.(updated);
                  } catch {
                    /* toast handled by parent if needed */
                  } finally {
                    setSaving(false);
                  }
                }}
                className="btn-press inline-flex h-11 items-center gap-2 rounded-md bg-[rgba(109,109,110,0.7)] pr-6 pl-5 text-[15px] font-semibold text-white hover:bg-[rgba(109,109,110,0.5)]"
                aria-label={detail.favorite ? t("removeFromList") : t("addToList")}
              >
                {detail.favorite ? <Check size={16} /> : <Plus size={16} />}
                {detail.favorite ? t("removeFromList") : t("addToList")}
              </button>
            </div>
          </div>
        </div>
        <div className="grid gap-8 px-6 py-6 md:grid-cols-[1.4fr_0.8fr]">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
              {detail.year ? <span>{detail.year}</span> : null}
              {series && detail.childCount ? <span>{t("seasonsCount", { n: detail.childCount })}</span> : null}
              {!series && detail.runtimeTicks ? <span>{formatRuntime(detail.runtimeTicks)}</span> : null}
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
        {seriesId && seasons.length ? (
          <div className="border-t border-white/5 px-6 py-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-[16px] font-semibold">{t("episodes")}</h3>
              <div className="flex flex-wrap gap-1.5">
                {seasons.map((season) => (
                  <button
                    key={season.id}
                    type="button"
                    onClick={() => setSeasonId(season.id)}
                    className={cn(
                      "h-8 rounded-md px-3 text-[12px] font-medium",
                      seasonId === season.id ? "bg-white text-black" : "bg-white/8 text-muted hover:bg-white/12",
                    )}
                  >
                    {season.seasonNumber != null ? t("seasonN", { n: season.seasonNumber }) : season.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              {loadingEpisodes ? (
                <p className="py-6 text-sm text-muted">…</p>
              ) : (
                episodes.map((ep) => (
                  <EpisodeRow
                    key={ep.id}
                    episode={ep}
                    onPlay={onPlay}
                    code={
                      ep.seasonNumber != null && ep.episodeNumber != null
                        ? t("episodeCode", { s: ep.seasonNumber, e: ep.episodeNumber })
                        : null
                    }
                  />
                ))
              )}
              {!loadingEpisodes && !episodes.length ? (
                <p className="py-4 text-sm text-muted">{t("noResults")}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
