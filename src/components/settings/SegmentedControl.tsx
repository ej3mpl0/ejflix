import { cn } from "../../lib/format";

export function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-pill bg-white/6 p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "btn-press h-8 rounded-pill px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150",
              active ? "bg-accent text-on-accent" : "text-muted hover:bg-white/8 hover:text-text",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
