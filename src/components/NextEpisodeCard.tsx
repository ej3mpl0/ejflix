import { Play, X } from "lucide-react";
import type { Movie } from "../lib/types";
import { episodeCode } from "../lib/format";
import { useI18n } from "../lib/locale-context";

/** Next-episode card (Nuvio style): thumbnail, code · title, countdown, play badge. */
export function NextEpisodeCard({
  episode,
  countdown,
  onPlay,
  onDismiss,
  shifted = false,
}: {
  episode: Movie;
  countdown: number | null;
  onPlay: () => void;
  onDismiss: () => void;
  /** A side panel is open: sit to its left instead of under it. */
  shifted?: boolean;
}) {
  const { t } = useI18n();
  const code = episodeCode(episode, t("episodeCode"));
  const image = episode.thumbUrl ?? episode.backdropUrl ?? episode.posterUrl;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`slide-in-right absolute bottom-[176px] z-30 w-[292px] rounded-2xl border border-white/12 bg-surface/90 p-3 transition-[right] duration-300 ${
        shifted ? "right-[452px]" : "right-8"
      } text-white shadow-[0_12px_32px_rgb(0_0_0_/_0.55)] backdrop-blur-md`}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("cancelAutoplay")}
        className="icon-hit absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-full text-white/60 hover:bg-white/10"
      >
        <X size={14} />
      </button>
      <button type="button" onClick={onPlay} className="flex w-full items-center gap-3 text-left">
        <span className="img-outline relative h-[44px] w-[78px] shrink-0 overflow-hidden rounded-md bg-black/40">
          {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : null}
        </span>
        <span className="min-w-0 flex-1 pr-6">
          <span className="block text-[11px] font-semibold tracking-[0.08em] text-white/60 uppercase">
            {t("nextEpisode")}
          </span>
          <span className="block truncate text-[13px] font-medium">
            {[code, episode.name].filter(Boolean).join(" · ")}
          </span>
          <span className="block truncate text-[12px] text-white/70 tabular">
            {countdown != null ? t("playingIn", { n: countdown }) : t("play")}
          </span>
        </span>
        <span className="btn-play grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-black">
          <Play size={16} fill="currentColor" />
        </span>
      </button>
    </div>
  );
}
