import { cn } from "../lib/format";

/**
 * How far into something you are, drawn over artwork: a thin track whose head is the red
 * dot. Sits at the bottom of a `relative` parent, inset from its edges.
 */
export function ProgressTrack({
  percent,
  className,
  size = "md",
}: {
  percent: number;
  className?: string;
  /** `sm` for small thumbnails (episode rows, channel tiles). */
  size?: "sm" | "md";
}) {
  const value = Math.min(100, Math.max(0, percent));
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute rounded-full bg-white/28",
        size === "md" ? "inset-x-3 bottom-3 h-[3px]" : "inset-x-2 bottom-2 h-[3px]",
        className,
      )}
    >
      <div className="relative h-full rounded-full bg-live" style={{ width: `${value}%` }}>
        <span className="absolute top-1/2 right-0 h-2 w-2 translate-x-1/2 -translate-y-1/2 rounded-full bg-live" />
      </div>
    </div>
  );
}
