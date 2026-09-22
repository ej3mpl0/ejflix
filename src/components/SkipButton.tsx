import { SkipForward, X } from "lucide-react";
import { useI18n } from "../lib/locale-context";
import { SKIP_PROMPT_SECONDS } from "../hooks/useSkipPrompt";

/**
 * "Skip intro" prompt: a white pill with the label and an accent ring that empties
 * around the icon while the prompt is on screen, plus a small dismiss button. Mount it
 * with a `key` that changes on every show so the enter animation and the ring restart.
 */
export function SkipButton({
  label,
  onSkip,
  onDismiss,
  shifted = false,
}: {
  label: string;
  onSkip: () => void;
  onDismiss: () => void;
  /** A side panel is open: sit to its left instead of under it. */
  shifted?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-live="polite"
      className={`skip-in absolute bottom-[176px] z-30 flex items-center gap-2 transition-[right] duration-300 ${
        shifted ? "right-[452px]" : "right-8"
      }`}
    >
      <button
        type="button"
        onClick={onSkip}
        className="skip-pill btn-press group inline-flex h-12 items-center gap-3 rounded-pill bg-white/[0.94] pr-6 pl-2 text-[15px] font-semibold text-black shadow-[0_12px_32px_rgb(0_0_0_/_0.55),0_0_0_1px_rgb(255_255_255_/_0.4)] hover:bg-white"
      >
        <span
          className="skip-ring relative grid h-9 w-9 place-items-center rounded-full"
          style={{ animationDuration: `${SKIP_PROMPT_SECONDS}s` }}
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-white text-black">
            <SkipForward size={15} fill="currentColor" className="translate-x-px" />
          </span>
        </span>
        {label}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("close")}
        className="icon-hit grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white/80 ring-1 ring-white/15 backdrop-blur-md hover:bg-black/75 hover:text-white"
      >
        <X size={16} />
      </button>
    </div>
  );
}
