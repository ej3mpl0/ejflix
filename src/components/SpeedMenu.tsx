import { useEffect, useRef } from "react";
import { useI18n } from "../lib/locale-context";

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function formatSpeed(speed: number): string {
  return `${Number(speed.toFixed(2))}x`;
}

export function SpeedMenu({ speed, onSelect }: { speed: number; onSelect: (speed: number) => void }) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  // Opening the menu hands it the focus, so the keyboard can pick a speed right away.
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, []);
  return (
    <div
      ref={root}
      className="modal-enter absolute bottom-[calc(100%+14px)] left-1/2 w-[min(440px,90vw)] -translate-x-1/2 rounded-2xl bg-panel/95 px-6 pt-4 pb-6 shadow-[0_16px_40px_rgb(0_0_0_/_0.5),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md"
    >
      <p className="mb-6 text-[16px] font-semibold text-white">{t("playbackSpeed")}</p>
      <div className="relative mx-3">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/25" />
        <div
          role="radiogroup"
          aria-label={t("playbackSpeed")}
          className="relative flex items-center justify-between"
          onKeyDown={(e) => {
            const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
            if (!dir) return;
            // Arrows move along the speeds here instead of seeking the video.
            e.preventDefault();
            e.stopPropagation();
            const index = SPEEDS.findIndex((value) => Math.abs(value - speed) < 0.01);
            const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (index < 0 ? 2 : index) + dir))];
            onSelect(next);
            const group = e.currentTarget;
            requestAnimationFrame(() => group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
          }}
        >
          {SPEEDS.map((value) => {
            const active = Math.abs(value - speed) < 0.01;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                className="group/speed relative grid h-8 w-8 place-items-center rounded-full"
                onClick={() => onSelect(value)}
                aria-label={formatSpeed(value)}
              >
                <span
                  className={`block rounded-full transition-[width,height,background-color] duration-150 ${
                    active ? "h-4 w-4 bg-accent" : "h-2.5 w-2.5 bg-white/60 group-hover/speed:bg-white"
                  }`}
                />
                <span
                  className={`absolute top-9 whitespace-nowrap text-[12px] tabular ${
                    active ? "font-semibold text-white" : "text-white/70"
                  }`}
                >
                  {value === 1 ? `${t("speedNormal")}` : formatSpeed(value)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="h-6" />
    </div>
  );
}
