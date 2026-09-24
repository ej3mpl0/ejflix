import { useState } from "react";
import { Volume2 } from "lucide-react";
import type { MultiviewCell } from "../lib/types";
import { api } from "../lib/api";
import { channelInitials } from "../lib/iptv";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";

/**
 * Multi-view: one chip per channel of the mosaic, in cell order; the lit one is the
 * channel whose sound plays. Shown with the rest of the controls.
 */
export function MultiviewBar({
  cells,
  visible,
  onHoldUi,
}: {
  cells: MultiviewCell[];
  visible: boolean;
  onHoldUi: (hold: boolean) => void;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState(0);

  const pick = (index: number) => {
    const previous = active;
    setActive(index);
    api.playerMultiviewAudio(index).catch(() => setActive(previous));
  };

  return (
    <div
      className={cn(
        "absolute top-[76px] left-1/2 z-20 flex max-w-[calc(100vw-48px)] -translate-x-1/2 items-center gap-1.5 rounded-pill bg-black/55 p-1.5 backdrop-blur-md transition-opacity duration-200",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      role="radiogroup"
      aria-label={t("multiview")}
      onMouseEnter={() => onHoldUi(true)}
      onMouseLeave={() => onHoldUi(false)}
    >
      {cells.map((cell, index) => (
        <button
          key={cell.channelId}
          type="button"
          role="radio"
          aria-checked={index === active}
          title={t("multiviewAudio", { name: cell.name })}
          onClick={() => pick(index)}
          className={cn(
            "flex h-9 min-w-0 items-center gap-2 rounded-pill pr-3.5 pl-1.5 text-[13px] font-medium transition-colors",
            index === active ? "bg-white text-black" : "text-white/80 hover:bg-white/12 hover:text-white",
          )}
        >
          <span className="grid h-6 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-black/30 p-0.5">
            {cell.logo ? (
              <img src={cell.logo} alt="" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-[9px] font-bold text-white/80">{channelInitials(cell.name)}</span>
            )}
          </span>
          <span className="max-w-[160px] truncate">{cell.name}</span>
          {index === active ? <Volume2 size={14} className="shrink-0" aria-hidden /> : null}
        </button>
      ))}
    </div>
  );
}
