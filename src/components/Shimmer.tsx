import { cn } from "../lib/format";

/** Loading placeholder with a moving highlight. Size and radius come from `className`. */
export function Shimmer({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <div
      aria-hidden
      className={cn("shimmer relative overflow-hidden bg-white/6", className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    />
  );
}
