import { Check, Play, X } from "lucide-react";
import type { Movie } from "../lib/types";
import { episodeCode, formatRuntime, remainingMinutes } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useItemFlags, useUserData } from "../lib/userdata-context";
import { KebabMenu } from "./KebabMenu";

/** 16:9 card for "Continue watching" and "Next up" (movies and episodes). */
export function ContinueCard({
  movie,
  onPlay,
  onOpen,
  variant = "resume",
}: {
  movie: Movie;
  onPlay: (movie: Movie) => void;
  onOpen: (movie: Movie) => void;
  /** "nextUp" items get a badge instead of a progress bar; "new" ones (just aired) a "New" badge. */
  variant?: "resume" | "nextUp" | "new";
}) {
  const { t } = useI18n();
  const flags = useItemFlags(movie);
  const { setPlayed, removeProgress } = useUserData();
  const progress = flags.playedPercentage || 0;
  const started = flags.playbackPositionTicks > 0 && progress > 0;
  const remaining = remainingMinutes(movie.runtimeTicks, flags.playbackPositionTicks);
  const isEpisode = movie.kind === "Episode";
  const code = isEpisode ? episodeCode(movie, t("episodeCode")) : "";
  const title = isEpisode ? (movie.seriesName ?? movie.name) : movie.name;
  const subtitle = isEpisode ? [code, movie.name].filter(Boolean).join(" · ") : null;
  const image = movie.thumbUrl || movie.backdropUrl || movie.posterUrl;
  const label = isEpisode ? `${title} ${subtitle ?? ""}`.trim() : movie.name;

  return (
    <div className="group relative w-[clamp(240px,24vw,320px)] shrink-0 snap-start" data-item-id={movie.id}>
      <div className="img-outline card-depth relative aspect-video w-full overflow-hidden rounded-poster bg-surface">
        <button type="button" onClick={() => onOpen(movie)} className="absolute inset-0" aria-label={label}>
          {image ? (
            <img
              src={image}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover opacity-0 transition-opacity duration-300"
              onLoad={(e) => e.currentTarget.classList.remove("opacity-0")}
            />
          ) : (
            <div className="grid h-full place-items-center px-3 text-center text-sm text-muted">{title}</div>
          )}
        </button>
        {variant === "new" && !started ? (
          <span className="pointer-events-none absolute top-2 left-2 rounded-[4px] bg-accent px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-on-accent uppercase shadow-[0_2px_8px_rgb(0_0_0_/_0.5)]">
            {t("newBadge")}
          </span>
        ) : null}
        {variant === "nextUp" && !started ? (
          <span className="pointer-events-none absolute top-2 left-2 rounded-[4px] bg-black/70 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase backdrop-blur-sm">
            {t("nextUpBadge")}
          </span>
        ) : null}
        <div className="pointer-events-none absolute inset-0 bg-black/20 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
        <button
          type="button"
          className="btn-play absolute top-1/2 left-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-black opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => onPlay(movie)}
          aria-label={`${t("play")} ${label}`}
        >
          <Play size={20} fill="currentColor" />
        </button>
        {variant === "resume" ? (
          <div className="absolute top-1.5 right-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100">
            <KebabMenu
              label={t("moreOptions")}
              className="bg-black/55 text-white/90 backdrop-blur-sm hover:bg-black/75"
              actions={[
                {
                  id: "remove",
                  label: t("removeFromContinue"),
                  icon: <X size={15} />,
                  onSelect: () => void removeProgress(movie),
                },
                {
                  id: "watched",
                  label: t("markWatched"),
                  icon: <Check size={15} />,
                  // Online progress lives apart from the watched flag: drop it as well.
                  onSelect: () =>
                    void setPlayed(movie, true).then(() => (movie.external ? removeProgress(movie) : undefined)),
                },
              ]}
            />
          </div>
        ) : null}
        {started ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
            <div className="h-full bg-accent" style={{ width: `${Math.min(100, progress)}%` }} />
          </div>
        ) : null}
      </div>
      <p className="mt-2 truncate text-sm text-text">{title}</p>
      {subtitle ? <p className="truncate text-[12px] text-muted">{subtitle}</p> : null}
      <p className="text-[12px] text-dim tabular">
        {started ? t("remaining", { n: remaining }) : formatRuntime(movie.runtimeTicks)}
      </p>
    </div>
  );
}
