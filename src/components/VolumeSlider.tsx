import { Volume2, VolumeX } from "lucide-react";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";

export function VolumeSlider({
  volume,
  mute,
  onVolume,
  onMute,
}: {
  volume: number;
  mute: boolean;
  onVolume: (value: number) => void;
  onMute: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="group/vol flex items-center">
      <button
        type="button"
        className="icon-hit grid h-10 w-10 place-items-center text-white"
        onClick={onMute}
        aria-label={mute ? t("unmute") : t("mute")}
      >
        <span className="relative grid h-5 w-5 place-items-center">
          <VolumeX
            size={20}
            className={`icon-swap absolute ${mute || volume === 0 ? "icon-swap-on" : "icon-swap-off"}`}
          />
          <Volume2
            size={20}
            className={`icon-swap absolute ${mute || volume === 0 ? "icon-swap-off" : "icon-swap-on"}`}
          />
        </span>
      </button>
      {/* Opens on hover and on keyboard focus, so Tab can reach the slider. */}
      <div className="w-0 overflow-hidden transition-[width] duration-200 ease-out group-hover/vol:w-24 group-focus-within/vol:w-24">
        <input
          type="range"
          min={0}
          max={100}
          value={mute ? 0 : volume}
          aria-label={t("volume")}
          aria-valuetext={`${Math.round(mute ? 0 : volume)}%`}
          onChange={(e) => {
            onVolume(Number(e.target.value));
            // Dragging the slider while muted means "I want sound".
            if (mute) onMute();
          }}
          className={cn("vol-range mx-1 w-20 cursor-pointer appearance-none accent-accent")}
        />
      </div>
    </div>
  );
}
