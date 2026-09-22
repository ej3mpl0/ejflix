import { Check } from "lucide-react";
import { THEMES } from "../../lib/theme";
import type { ThemeId } from "../../lib/types";
import { cn } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";

export function ThemePicker({ value, onChange }: { value: ThemeId; onChange: (id: ThemeId) => void }) {
  const { t } = useI18n();
  const selected = Math.max(
    0,
    THEMES.findIndex((theme) => theme.id === value),
  );
  return (
    <div
      role="radiogroup"
      aria-label={t("appearance")}
      className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3"
      onKeyDown={(e) => {
        const step =
          e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        onChange(THEMES[(selected + step + THEMES.length) % THEMES.length].id);
        const group = e.currentTarget;
        requestAnimationFrame(() => group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
      }}
    >
      {THEMES.map((theme, index) => {
        const active = theme.id === value;
        return (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => onChange(theme.id)}
            className="group flex flex-col items-center gap-2 rounded-xl p-2 hover:bg-white/5"
          >
            <span
              className={cn(
                "grid h-11 w-11 place-items-center rounded-full shadow-[inset_0_1px_0_rgb(255_255_255_/_0.25),0_4px_12px_rgb(0_0_0_/_0.4)] transition-transform duration-150 ease-std group-hover:scale-105",
                active && "ring-2 ring-white ring-offset-2 ring-offset-surface",
              )}
              style={{ backgroundImage: theme.gradient }}
            >
              {active ? <Check size={18} strokeWidth={3} className="text-black/80 mix-blend-luminosity" /> : null}
            </span>
            <span className={cn("text-[12px]", active ? "font-semibold text-text" : "text-muted")}>
              {t(theme.labelKey)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
