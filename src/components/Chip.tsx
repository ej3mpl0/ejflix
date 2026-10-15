import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/format";

/** Pill-shaped chip; `selected` turns it white (season pickers, genre filters). */
export function Chip({
  selected = false,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      {...rest}
      className={cn(
        "btn-press inline-flex h-9 shrink-0 items-center gap-2 rounded-pill px-4 text-[14px] font-medium whitespace-nowrap transition-colors duration-150",
        selected ? "bg-accent font-semibold text-on-accent" : "bg-surface text-muted hover:bg-panel hover:text-text",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
