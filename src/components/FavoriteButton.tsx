import { Check, Heart, Plus } from "lucide-react";
import type { Movie } from "../lib/types";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useUserData } from "../lib/userdata-context";
import { ICON_PILL } from "./Pill";

/**
 * "My list" toggle. `action`: labelled pill for heroes; `round`: icon-only pill for the
 * details page row; `icon`: round heart for card hover overlays; `outline`: bordered round
 * button (hover card).
 */
export function FavoriteButton({
  movie,
  variant = "action",
  pill = false,
  className,
  tabIndex,
}: {
  movie: Movie;
  variant?: "action" | "round" | "icon" | "outline";
  pill?: boolean;
  className?: string;
  tabIndex?: number;
}) {
  const { t } = useI18n();
  const { flags, setFavorite, pending } = useUserData();
  const favorite = flags(movie).favorite;
  const busy = pending(movie.id);
  const label = favorite ? t("removeFromList") : t("addToList");

  if (variant === "round") {
    return (
      <button
        type="button"
        disabled={busy}
        aria-pressed={favorite}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          void setFavorite(movie, !favorite);
        }}
        className={cn(ICON_PILL, favorite ? "text-accent" : "text-text", className)}
      >
        <span className="relative grid h-5 w-5 place-items-center">
          <Check size={19} className={`icon-swap absolute ${favorite ? "icon-swap-on" : "icon-swap-off"}`} />
          <Plus size={19} className={`icon-swap absolute ${favorite ? "icon-swap-off" : "icon-swap-on"}`} />
        </span>
      </button>
    );
  }

  if (variant !== "action") {
    return (
      <button
        type="button"
        tabIndex={tabIndex}
        disabled={busy}
        aria-pressed={favorite}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          void setFavorite(movie, !favorite);
        }}
        className={cn(
          "btn-press grid place-items-center rounded-full text-white disabled:opacity-60",
          variant === "outline"
            ? "h-9 w-9 border border-white/25 hover:border-white/60"
            : "h-8 w-8 bg-black/60 backdrop-blur-sm hover:bg-black/80",
          className,
        )}
      >
        <Heart size={15} fill={favorite ? "currentColor" : "none"} className={favorite ? "text-accent" : ""} />
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={favorite}
      onClick={(e) => {
        e.stopPropagation();
        void setFavorite(movie, !favorite);
      }}
      className={cn(
        "btn-press inline-flex h-11 items-center gap-2 bg-white/12 pr-5 pl-4 text-[14px] font-semibold text-white hover:bg-white/18 disabled:opacity-60",
        pill ? "rounded-pill" : "rounded-btn",
        className,
      )}
    >
      <span className="relative grid h-5 w-5 place-items-center">
        <Check size={18} className={`icon-swap absolute ${favorite ? "icon-swap-on" : "icon-swap-off"}`} />
        <Plus size={18} className={`icon-swap absolute ${favorite ? "icon-swap-off" : "icon-swap-on"}`} />
      </span>
      {favorite ? t("inList") : t("myList")}
    </button>
  );
}
