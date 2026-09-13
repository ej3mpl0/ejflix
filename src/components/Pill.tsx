import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/format";

type Variant = "primary" | "tonal" | "ghost";

/**
 * Button primitive: accent-filled `primary`, translucent `tonal`, borderless `ghost`.
 * `pill` rounds it fully (hero / details actions); otherwise the button radius applies.
 */
export function Pill({
  variant = "tonal",
  pill = false,
  size = "md",
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  pill?: boolean;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "btn-press inline-flex shrink-0 items-center justify-center gap-2 font-semibold whitespace-nowrap disabled:opacity-[var(--opacity-disabled)] disabled:active:scale-100",
        size === "sm" && "h-9 px-4 text-[13px]",
        size === "md" && "h-11 px-5 text-[14px]",
        size === "lg" && "h-12 px-7 text-[15px]",
        pill ? "rounded-pill" : "rounded-btn",
        variant === "primary" && "bg-accent text-on-accent hover:bg-accent-hover",
        variant === "tonal" && "bg-white/12 text-text hover:bg-white/18",
        variant === "ghost" && "bg-transparent text-text hover:bg-white/8",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
