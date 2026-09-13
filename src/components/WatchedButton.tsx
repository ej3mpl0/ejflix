import { CircleCheck, Eye } from "lucide-react";
import type { Movie } from "../lib/types";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useUserData } from "../lib/userdata-context";

/** Mark as watched / unwatched. For seasons and series, watched = nothing left to play. */
export function WatchedButton({
  movie,
  variant = "action",
  scope = "item",
  pill = false,
  className,
}: {
  movie: Movie;
  variant?: "action" | "icon";
  scope?: "item" | "season";
  pill?: boolean;
  className?: string;
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

  if (variant === "icon") {
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
        className={cn(
          "btn-press grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 disabled:opacity-60",
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
