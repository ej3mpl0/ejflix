import { Play, X } from "lucide-react";
import type { Movie } from "../lib/types";
import { episodeCode, formatRuntime } from "../lib/format";
import { useI18n } from "../lib/locale-context";

/**
 * Next-episode card: a 16:9 still beside the title, and a white play button that fills
 * up while the countdown runs. The button restarts its fill every time the countdown
 * starts again (it unmounts while playback is paused).
 */
export function NextEpisodeCard({
  episode,
  countdown,
  total,
  onPlay,
  onDismiss,
  shifted = false,
}: {
  episode: Movie;
  countdown: number | null;
  /** Length of the countdown in seconds, for the fill of the play button. */
  total: number;
  onPlay: () => void;
  onDismiss: () => void;
  /** A side panel is open: sit to its left instead of under it. */
  shifted?: boolean;
}) {
  const { t } = useI18n();
  const isEpisode = episode.kind === "Episode";
  const image = episode.thumbUrl ?? episode.backdropUrl ?? episode.posterUrl;
  const meta = [
    isEpisode ? episodeCode(episode, t("episodeCode")) : episode.year,
    formatRuntime(episode.runtimeTicks),
  ]
    .filter(Boolean)
    .join(" · ");
  const counting = countdown != null && total > 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`slide-in-right absolute bottom-[176px] z-30 w-[384px] rounded-[18px] bg-surface/92 p-3 text-white shadow-[0_16px_40px_rgb(0_0_0_/_0.6),0_0_0_1px_rgb(255_255_255_/_0.1)] backdrop-blur-xl transition-[right] duration-300 ${
        shifted ? "right-[452px]" : "right-8"
      }`}
    >
      <div className="flex gap-3.5">
        <span className="img-outline relative aspect-video w-[144px] shrink-0 overflow-hidden rounded-[10px] bg-black/40">
          {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : null}
        </span>
        <div className="min-w-0 flex-1 self-center pr-7">
          <p className="text-[11.5px] font-semibold tracking-[0.06em] text-white/55 uppercase">
            {isEpisode ? t("nextEpisode") : t("upNextQueue")}
          </p>
          <p className="mt-1 line-clamp-2 font-display text-[15px] leading-[1.25] font-semibold">{episode.name}</p>
          {meta ? <p className="mt-1 truncate text-[12.5px] text-white/60 tabular">{meta}</p> : null}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={counting ? t("cancelAutoplay") : t("close")}
        className="absolute top-2.5 right-2.5 grid h-7 w-7 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
      >
        <X size={15} />
      </button>
      <button
        type="button"
        onClick={onPlay}
        className="btn-press relative mt-3 flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-btn bg-white text-[14.5px] font-semibold text-black hover:bg-white/92"
      >
        {counting ? (
          <span aria-hidden className="next-fill absolute inset-0" style={{ animationDuration: `${total}s` }} />
        ) : null}
        <Play size={16} fill="currentColor" className="relative" />
        <span className="relative tabular">{counting ? t("playingIn", { n: countdown }) : t("play")}</span>
      </button>
    </div>
  );
}
