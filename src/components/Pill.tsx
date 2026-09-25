import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/format";

type Variant = "primary" | "tonal" | "ghost" | "danger";

/**
 * Button primitive: accent-filled `primary`, translucent `tonal`, borderless `ghost`, and
 * `danger` for destructive actions (never the accent: a white or green accent reads as "ok").
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
}: ComponentProps<"button"> & {
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
        variant === "danger" && "bg-danger text-white hover:bg-[color-mix(in_oklab,var(--color-danger)_88%,white)]",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * Icon-only round action for the row next to a details page's Play button, the size of a
 * `lg` pill. The label is its accessible name and its tooltip.
 */
export function IconPill({
  label,
  icon,
  className,
  ...rest
}: Omit<ComponentProps<"button">, "children"> & { label: string; icon: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cn(ICON_PILL, "text-text", className)}
    >
      {icon}
    </button>
  );
}

/** Shared with the toggles that draw their own round button (My list, watched); no text colour, each sets its own. */
export const ICON_PILL =
  "btn-press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white/12 hover:bg-white/18 disabled:opacity-[var(--opacity-disabled)] disabled:active:scale-100";
