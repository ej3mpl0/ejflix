import { useI18n } from "../lib/locale-context";

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function formatSpeed(speed: number): string {
  return `${Number(speed.toFixed(2))}x`;
}

export function SpeedMenu({ speed, onSelect }: { speed: number; onSelect: (speed: number) => void }) {
  const { t } = useI18n();
  return (
    <div className="modal-enter absolute bottom-[calc(100%+14px)] left-1/2 w-[440px] -translate-x-1/2 rounded-2xl bg-panel/95 px-6 pt-4 pb-6 shadow-[0_16px_40px_rgb(0_0_0_/_0.5),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md">
      <p className="mb-6 text-[16px] font-semibold text-white">{t("playbackSpeed")}</p>
      <div className="relative mx-3">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/25" />
        <div className="relative flex items-center justify-between">
          {SPEEDS.map((value) => {
            const active = Math.abs(value - speed) < 0.01;
            return (
              <button
                key={value}
                type="button"
                className="group/speed relative grid h-8 w-8 place-items-center"
                onClick={() => onSelect(value)}
                aria-label={formatSpeed(value)}
                aria-pressed={active}
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
