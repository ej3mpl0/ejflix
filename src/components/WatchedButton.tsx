import { CircleCheck, Eye } from "lucide-react";
import type { Movie } from "../lib/types";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useUserData } from "../lib/userdata-context";
import { ICON_PILL } from "./Pill";

/** Mark as watched / unwatched. For seasons and series, watched = nothing left to play. */
export function WatchedButton({
  movie,
  variant = "action",
  scope = "item",
  pill = false,
  className,
  tabIndex,
}: {
  movie: Movie;
  /**
   * `round`: icon-only pill for the details page row; `icon`: dark round button over
   * artwork; `outline`: bordered round button (hover card).
   */
  variant?: "action" | "round" | "icon" | "outline";
  scope?: "item" | "season";
  pill?: boolean;
  className?: string;
  tabIndex?: number;
}) {
  const { t } = useI18n();
  const { flags, setPlayed, pending } = useUserData();
  const state = flags(movie);
  const watched = state.played || state.unplayedCount === 0;
  const busy = pending(movie.id);
  const label =
    scope === "season"
      ? watched
        ? t("markSeasonUnwatched")
        : t("markSeasonWatched")
      : watched
        ? t("markUnwatched")
        : t("markWatched");

  if (variant === "round") {
    return (
      <button
        type="button"
        disabled={busy}
        aria-pressed={watched}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          void setPlayed(movie, !watched);
        }}
        className={cn(ICON_PILL, watched ? "text-accent" : "text-text", className)}
      >
        {watched ? <CircleCheck size={19} /> : <Eye size={19} />}
      </button>
    );
  }

  if (variant !== "action") {
    return (
      <button
        type="button"
        tabIndex={tabIndex}
        disabled={busy}
        aria-pressed={watched}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          void setPlayed(movie, !watched);
        }}
        className={cn(
          "btn-press grid place-items-center rounded-full text-white disabled:opacity-60",
          variant === "outline"
            ? "h-9 w-9 border border-white/25 hover:border-white/60"
            : "h-8 w-8 bg-black/60 backdrop-blur-sm hover:bg-black/80",
          className,
        )}
      >
        <CircleCheck size={15} className={watched ? "text-accent" : ""} />
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={watched}
      onClick={(e) => {
        e.stopPropagation();
        void setPlayed(movie, !watched);
      }}
      className={cn(
        "btn-press inline-flex h-11 items-center gap-2 bg-white/12 pr-5 pl-4 text-[14px] font-semibold text-white hover:bg-white/18 disabled:opacity-60",
        pill ? "rounded-pill" : "rounded-btn",
        watched && "text-accent",
        className,
      )}
    >
      {watched ? <CircleCheck size={18} /> : <Eye size={18} />}
      {watched ? t("watched") : t("markWatched")}
    </button>
  );
}
