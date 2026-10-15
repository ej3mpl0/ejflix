import { cn } from "../lib/format";

/** 4K, HDR, 1080p…: small outlined tags, as on a disc box. */
export function QualityBadges({ badges, className }: { badges: string[]; className?: string }) {
  if (!badges.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {badges.map((badge) => (
        <span
          key={badge}
          className="rounded-[5px] border border-white/35 px-1.5 py-px text-[11.5px] font-bold text-text"
        >
          {/^\d+P$/i.test(badge) ? badge.toLowerCase() : badge}
        </span>
      ))}
    </span>
  );
}
