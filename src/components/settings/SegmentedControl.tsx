import { cn } from "../../lib/format";

/**
 * Radio group drawn as pills. One stop in the Tab order (the checked option); the arrows
 * move and select, like a native radio group. Wraps onto a second line when narrow.
 */
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
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex max-w-full flex-wrap gap-y-1 rounded-[20px] bg-white/6 p-1"
      onKeyDown={(e) => {
        const step =
          e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!step || !options.length) return;
        e.preventDefault();
        const next = (selectedIndex + step + options.length) % options.length;
        onChange(options[next].value);
        const group = e.currentTarget;
        requestAnimationFrame(() => group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
      }}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={index === selectedIndex ? 0 : -1}
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
