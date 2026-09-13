import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/format";

/** Pill-shaped chip; `selected` tints it with the accent (season pickers, genre filters). */
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
        "btn-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150",
        selected
          ? "bg-accent-soft text-accent ring-1 ring-accent/40 ring-inset"
          : "bg-white/6 text-text/80 hover:bg-white/12 hover:text-text",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
