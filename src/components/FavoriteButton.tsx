import { Check, Heart, Plus } from "lucide-react";
import type { Movie } from "../lib/types";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useUserData } from "../lib/userdata-context";

/**
 * "My list" toggle. `action`: labelled pill for detail pages and heroes;
 * `icon`: round heart for card hover overlays.
 */
export function FavoriteButton({
  movie,
  variant = "action",
  pill = false,
  className,
}: {
  movie: Movie;
  variant?: "action" | "icon";
  pill?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const { flags, setFavorite, pending } = useUserData();
  const favorite = flags(movie).favorite;
  const busy = pending(movie.id);
  const label = favorite ? t("removeFromList") : t("addToList");

  if (variant === "icon") {
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
        className={cn(
          "btn-press grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 disabled:opacity-60",
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
