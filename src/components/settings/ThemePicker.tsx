import { Check, Sparkles } from "lucide-react";
import { THEMES } from "../../lib/theme";
import type { ThemeId } from "../../lib/types";
import { cn } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";

/** Swatch of the "Auto" accent (follows the artwork): a hue wheel. */
const AUTO_GRADIENT = "conic-gradient(from 200deg,#e50914,#ffb300,#22d37c,#3185f5,#a044c4,#e50914)";

/**
 * Accent palettes as radio swatches. With `onAuto` an "Auto" swatch leads the list: the
 * accent then follows the artwork on screen and `value` is only its fallback.
 */
export function ThemePicker({
  value,
  onChange,
  auto = false,
  onAuto,
}: {
  value: ThemeId;
  onChange: (id: ThemeId) => void;
  auto?: boolean;
  onAuto?: () => void;
}) {
  const { t } = useI18n();
  const options: Array<{ id: ThemeId | "auto"; gradient: string; label: string }> = [
    ...(onAuto ? [{ id: "auto" as const, gradient: AUTO_GRADIENT, label: t("themeAuto") }] : []),
    ...THEMES.map((theme) => ({ id: theme.id, gradient: theme.gradient, label: t(theme.labelKey) })),
  ];
  const activeId = auto && onAuto ? "auto" : value;
  const selected = Math.max(
    0,
    options.findIndex((option) => option.id === activeId),
  );
  const pick = (id: ThemeId | "auto") => (id === "auto" ? onAuto?.() : onChange(id));
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
        pick(options[(selected + step + options.length) % options.length].id);
        const group = e.currentTarget;
        requestAnimationFrame(() => group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
      }}
    >
      {options.map((option, index) => {
        const active = option.id === activeId;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => pick(option.id)}
            title={option.id === "auto" ? t("themeAutoHint") : undefined}
            className="group flex flex-col items-center gap-2 rounded-xl p-2 hover:bg-white/5"
          >
            <span
              className={cn(
                "grid h-11 w-11 place-items-center rounded-full shadow-[inset_0_1px_0_rgb(255_255_255_/_0.25),0_4px_12px_rgb(0_0_0_/_0.4)] transition-transform duration-150 ease-std group-hover:scale-105",
                active && "ring-2 ring-white ring-offset-2 ring-offset-surface",
              )}
              style={{ backgroundImage: option.gradient }}
            >
              {active ? (
                <Check size={18} strokeWidth={3} className="text-black/80 mix-blend-luminosity" />
              ) : option.id === "auto" ? (
                <Sparkles size={16} className="text-white drop-shadow" />
              ) : null}
            </span>
            <span className={cn("text-[12px]", active ? "font-semibold text-text" : "text-muted")}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
