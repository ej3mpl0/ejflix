import { cn } from "../../lib/format";

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ease-std",
        checked ? "bg-accent" : "bg-white/15 hover:bg-white/20",
      )}
    >
      <span
        className={cn(
          "absolute top-1 left-1 h-5 w-5 rounded-full shadow-[0_1px_3px_rgb(0_0_0_/_0.4)] transition-transform duration-200 ease-std",
          checked ? "translate-x-5 bg-on-accent" : "translate-x-0 bg-white",
        )}
      />
    </button>
  );
}
