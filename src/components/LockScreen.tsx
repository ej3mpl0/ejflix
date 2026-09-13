import { LockOpen } from "lucide-react";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";

/**
 * Covers the video while the controls are locked. Clicking anywhere shows the unlock
 * circle for a moment; clicking the circle unlocks.
 */
export function LockScreen({
  hint,
  onUnlock,
  onHint,
}: {
  hint: boolean;
  onUnlock: () => void;
  onHint: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="absolute inset-0 z-40 cursor-default"
      onClick={(e) => {
        if (e.target === e.currentTarget) onHint();
      }}
      onMouseMove={onHint}
    >
      <div
        className={cn(
          "absolute inset-0 grid place-items-center transition-opacity duration-200",
          hint ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <button
          type="button"
          onClick={onUnlock}
          aria-label={t("unlock")}
          className="btn-press group flex flex-col items-center gap-3 text-white"
        >
          <span className="grid h-[78px] w-[78px] place-items-center rounded-full border border-white/20 bg-black/60 backdrop-blur-md transition-colors duration-150 group-hover:bg-black/75">
            <LockOpen size={30} strokeWidth={1.75} />
          </span>
          <span className="rounded-full bg-black/60 px-3 py-1 text-[13px] font-medium backdrop-blur-md">
            {t("tapToUnlock")}
          </span>
        </button>
      </div>
    </div>
  );
}
