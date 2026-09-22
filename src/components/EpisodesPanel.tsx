import { useEffect, useState } from "react";
import { Check, Play, X } from "lucide-react";
import type { AddonMetaFull, Movie, ResumeEntry } from "../lib/types";
import { api } from "../lib/api";
import { sortedVideos, videoToMovie } from "../lib/addons";
import { cn, episodeCode, formatRuntime } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { Chip } from "./Chip";
import { Shimmer } from "./Shimmer";
import { SeasonChips } from "./SeasonChips";

/**
 * Side panel inside the player: versions of the current item (when it has several
 * media sources) and, for episodes, the season list to jump to another episode.
 */
export function EpisodesPanel({
  movie,
  time,
  duration,
  onPlay,
  onClose,
  onHoldUi,
}: {
  movie: Movie;
  time: number;
  duration: number;
  /** Plays another episode or another version through the next-episode flow. */
  onPlay: (movie: Movie) => void;
  onClose: () => void;
  onHoldUi: (hold: boolean) => void;
}) {
  const { t } = useI18n();
  /** Addon series: the episode list comes from the addon metadata instead of Jellyfin. */
  const online = movie.kind === "Episode" && movie.external?.type === "series" ? movie.external : null;
  const seriesId = movie.kind === "Episode" && !online ? movie.seriesId : null;
  const listed = Boolean(seriesId || online);
  const [seasons, setSeasons] = useState<Array<{ id: string; name: string }>>([]);
  const [seasonId, setSeasonId] = useState<string | null>(
    online ? String(online.season ?? 0) : movie.seasonId,
  );
  const [episodes, setEpisodes] = useState<Movie[] | null>(null);
  const [onlineMeta, setOnlineMeta] = useState<AddonMetaFull | null>(null);
  const [progress, setProgress] = useState<ResumeEntry[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!online) return;
    let alive = true;
    api
      .addonMeta("series", online.metaId)
      .then((meta) => {
        if (!alive) return;
        const numbers = [...new Set(sortedVideos(meta.videos).map((v) => v.season ?? 0))];
        setSeasons(numbers.map((n) => ({ id: String(n), name: n === 0 ? t("specials") : t("seasonNumber", { n }) })));
        setOnlineMeta(meta);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    api
      .addonProgressList()
      .then((list) => {
        if (alive) setProgress(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online?.metaId]);

  useEffect(() => {
    if (!onlineMeta || seasonId == null) return;
    const prefer = online?.prefer;
    setEpisodes(
      sortedVideos(onlineMeta.videos)
        .filter((v) => String(v.season ?? 0) === seasonId)
        .map((v) => {
          const item = videoToMovie(onlineMeta, v);
          const entry = progress.find((p) => p.key === v.id);
          const pct = entry && entry.durationSeconds > 0 ? (entry.positionSeconds / entry.durationSeconds) * 100 : 0;
          return {
            ...item,
            external: { ...item.external!, prefer },
            playedPercentage: Math.min(100, pct),
            played: pct >= 95,
          };
        }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineMeta, seasonId, progress]);

  useEffect(() => {
    if (!seriesId) return;
    let alive = true;
    api
      .getSeasons(seriesId)
      .then((list) => {
        if (!alive) return;
        setSeasons(list.map((season) => ({ id: season.id, name: season.name })));
        setSeasonId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [seriesId]);

  useEffect(() => {
    if (!seriesId || !seasonId) return;
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

  // Keep the current episode in view when the panel opens on its season.
  useEffect(() => {
    if (!episodes) return;
    const el = document.querySelector<HTMLElement>(`[data-panel-episode="${movie.id}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [episodes, movie.id]);

  const liveProgress = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <aside
      className="panel-in absolute inset-y-0 right-0 z-[35] flex w-[420px] flex-col border-l border-white/10 bg-surface/95 text-text shadow-[-24px_0_48px_rgb(0_0_0_/_0.45)] backdrop-blur-md"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseEnter={() => onHoldUi(true)}
      onMouseLeave={() => onHoldUi(false)}
    >
      <div className="flex items-center gap-3 px-5 pt-5 pb-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">
            {listed ? t("episodes") : t("versions")}
          </p>
          <p className="truncate text-[16px] font-semibold">{movie.seriesName ?? movie.name}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="icon-hit grid h-9 w-9 place-items-center rounded-full text-white/70 hover:bg-white/10"
        >
          <X size={18} />
        </button>
      </div>

      {movie.mediaSources.length > 1 ? (
        <div className="px-5 pb-3">
          <p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">{t("versions")}</p>
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {movie.mediaSources.map((source) => (
              <Chip
                key={source.id}
                selected={source.id === movie.mediaSourceId}
                onClick={() => {
                  if (source.id !== movie.mediaSourceId) onPlay({ ...movie, mediaSourceId: source.id });
                }}
              >
                {source.name}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      {listed ? (
        <>
          {seasons.length > 1 ? (
            <div className="px-5 pb-3">
              <SeasonChips seasons={seasons} value={seasonId} onChange={setSeasonId} />
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {error ? <p className="px-2 text-sm text-muted">{error}</p> : null}
            {episodes && !episodes.length && !error ? (
              <p className="px-2 text-sm text-muted">{t("noEpisodes")}</p>
            ) : null}
            {episodes == null && !error
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex gap-3 p-2">
                    <Shimmer className="aspect-video w-[120px] shrink-0 rounded-md" delay={i * 80} />
                    <div className="flex-1 space-y-2 py-1">
                      <Shimmer className="h-3.5 w-3/4 rounded" />
                      <Shimmer className="h-3 w-1/3 rounded" />
                    </div>
                  </div>
                ))
              : null}
            {episodes?.map((episode) => {
              const current = episode.id === movie.id;
              const progress = current ? liveProgress : episode.playedPercentage || 0;
              const code = episodeCode(episode, t("episodeCode"));
              const runtime = formatRuntime(episode.runtimeTicks);
              return (
                <button
                  key={episode.id}
                  type="button"
                  data-panel-episode={episode.id}
                  onClick={() => (current ? onClose() : onPlay(episode))}
                  className={cn(
                    "group/ep relative flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors duration-150 hover:bg-white/6",
                    current && "bg-white/8",
                  )}
                  aria-current={current ? "true" : undefined}
                >
                  {current ? <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent" /> : null}
                  <div className="img-outline relative aspect-video w-[120px] shrink-0 overflow-hidden rounded-md bg-panel">
                    {episode.thumbUrl ? (
                      <img src={episode.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : null}
                    {!current ? (
                      <div className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition-opacity duration-150 group-hover/ep:opacity-100">
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-white/90 text-black">
                          <Play size={14} fill="currentColor" className="translate-x-px" />
                        </span>
                      </div>
                    ) : null}
                    {episode.played && !current ? (
                      <span className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    ) : null}
                    {progress > 0 ? (
                      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
                        <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
                      </div>
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-[13px]", current ? "font-semibold text-white" : "text-text")}>
                      {[code, episode.name].filter(Boolean).join(" · ")}
                    </p>
                    {runtime ? <p className="text-[11px] text-dim tabular">{runtime}</p> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </aside>
  );
}
