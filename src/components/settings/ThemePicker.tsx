import { Check } from "lucide-react";
import { THEMES } from "../../lib/theme";
import type { ThemeId } from "../../lib/types";
import { cn } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";

export function ThemePicker({ value, onChange }: { value: ThemeId; onChange: (id: ThemeId) => void }) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3">
      {THEMES.map((theme) => {
        const active = theme.id === value;
        return (
          <button
            key={theme.id}
            type="button"
            aria-pressed={active}
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
