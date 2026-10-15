import { cn } from "../../lib/format";

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ease-std disabled:cursor-not-allowed disabled:opacity-[var(--opacity-disabled)]",
        checked ? "bg-accent" : "bg-panel hover:bg-line",
      )}
    >
      <span
        className={cn(
          "absolute top-1 left-1 grid h-5 w-5 place-items-center rounded-full shadow-[0_1px_3px_rgb(0_0_0_/_0.4)] transition-transform duration-200 ease-std",
          checked ? "translate-x-5 bg-on-accent" : "translate-x-0 bg-muted",
        )}
      >
        {/* On is alive: the knob carries the red dot. */}
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full bg-live transition-opacity duration-200",
            checked ? "opacity-100" : "opacity-0",
          )}
        />
      </span>
    </button>
  );
}
