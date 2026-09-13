import { Check } from "lucide-react";
import type { Movie } from "../lib/types";
import { cn } from "../lib/format";
import { useItemFlags } from "../lib/userdata-context";

/** Small check badge for watched items (posters, episode thumbnails). */
export function WatchedBadge({ movie, className }: { movie: Movie; className?: string }) {
  const flags = useItemFlags(movie);
  const watched = flags.played || flags.unplayedCount === 0;
  if (!watched) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none grid h-6 w-6 place-items-center rounded-full bg-accent text-on-accent shadow-[0_2px_8px_rgb(0_0_0_/_0.5)]",
        className,
      )}
    >
      <Check size={13} strokeWidth={3} />
    </span>
  );
}
