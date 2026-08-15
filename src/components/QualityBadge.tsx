import { cn } from "../lib/format";

export function QualityBadges({ badges, className }: { badges: string[]; className?: string }) {
  if (!badges.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {badges.map((badge) => (
        <span
          key={badge}
          className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text"
        >
          {badge}
        </span>
      ))}
    </span>
  );
}
