import { cn } from "../lib/format";

/**
 * The ejFlix symbol: the j of the wordmark with its red dot. `tile` draws it on the dark
 * rounded square used for the app icon; `lighting` plays the start-up moment where the dot
 * switches on like a projector lamp (the one animation the user does not trigger).
 */
export function Mark({
  size = 32,
  tile = false,
  lighting = false,
  className,
}: {
  size?: number;
  tile?: boolean;
  lighting?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn("shrink-0 overflow-visible", className)}
    >
      {tile ? <rect width="120" height="120" rx="27" fill="var(--color-base)" /> : null}
      <path
        d="M66 50v34c0 11-7 17-18 17h-4"
        fill="none"
        stroke="var(--color-text)"
        strokeWidth="17"
        strokeLinecap="round"
      />
      <circle cx="66" cy="27" r="11" fill="var(--color-live)" className={lighting ? "mark-lamp" : undefined} />
    </svg>
  );
}

/** The red dot on its own: the mark of whatever is live (active tab, progress head, on air). */
export function LiveDot({ className, glow = false }: { className?: string; glow?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-live",
        glow && "shadow-[0_0_0_4px_var(--color-live-soft)]",
        className,
      )}
    />
  );
}
