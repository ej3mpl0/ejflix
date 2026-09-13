import { Globe, Play } from "lucide-react";
import type { Movie } from "../lib/types";
import { episodeCode, formatRuntime } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useItemFlags } from "../lib/userdata-context";
import { FavoriteButton } from "./FavoriteButton";
import { WatchedButton } from "./WatchedButton";
import { WatchedBadge } from "./WatchedBadge";

function EpisodeRow({
  episode,
  onPlay,
  onOnline,
}: {
  episode: Movie;
  onPlay: (movie: Movie) => void;
  onOnline?: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const flags = useItemFlags(episode);
  const runtime = formatRuntime(episode.runtimeTicks);
  const progress = flags.playedPercentage || 0;
  const number = episode.episodeNumber != null ? `${episode.episodeNumber}. ` : "";

  return (
    <div className="group/ep relative flex w-full items-start gap-4 rounded-xl p-2 transition-colors duration-150 hover:bg-white/5">
      <button
        type="button"
        onClick={() => onPlay(episode)}
        className="img-outline relative aspect-video w-[200px] shrink-0 overflow-hidden rounded-poster bg-panel text-left"
        aria-label={`${t("play")} ${episodeCode(episode, t("episodeCode"))} ${episode.name}`}
      >
        {episode.thumbUrl ? (
          <img src={episode.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : null}
        <div className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition-opacity duration-150 group-hover/ep:opacity-100">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-white/90 text-black">
            <Play size={18} fill="currentColor" className="translate-x-px" />
          </span>
        </div>
        <WatchedBadge movie={episode} className="absolute top-1.5 right-1.5" />
        {progress > 0 ? (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
            <div className="h-full bg-accent" style={{ width: `${Math.min(100, progress)}%` }} />
          </div>
        ) : null}
      </button>
      <button type="button" onClick={() => onPlay(episode)} className="min-w-0 flex-1 py-1 text-left">
        <div className="flex items-baseline justify-between gap-3 pr-20">
          <p className="truncate text-[15px] font-medium text-white">
            {number}
            {episode.name}
          </p>
          {runtime ? <span className="shrink-0 text-[12px] text-dim tabular">{runtime}</span> : null}
        </div>
        {episode.overview ? (
          <p className="mt-1 line-clamp-2 text-[13px] leading-[1.5] text-muted">{episode.overview}</p>
        ) : null}
      </button>
      <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 transition-opacity duration-150 group-hover/ep:opacity-100 focus-within:opacity-100">
        {onOnline ? (
          <button
            type="button"
            aria-label={t("onlineSources")}
            title={t("onlineSources")}
            onClick={(e) => {
              e.stopPropagation();
              onOnline(episode);
            }}
            className="btn-press grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80"
          >
            <Globe size={15} />
          </button>
        ) : null}
        <WatchedButton movie={episode} variant="icon" />
        <FavoriteButton movie={episode} variant="icon" />
      </div>
    </div>
  );
}

export function EpisodeList({
  episodes,
  onPlay,
  onOnline,
}: {
  episodes: Movie[];
  onPlay: (movie: Movie) => void;
  onOnline?: (movie: Movie) => void;
}) {
  return (
    <div className="space-y-1">
      {episodes.map((episode) => (
        <EpisodeRow key={episode.id} episode={episode} onPlay={onPlay} onOnline={onOnline} />
      ))}
    </div>
  );
}
