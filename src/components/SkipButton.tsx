import { SkipForward, X } from "lucide-react";
import { useI18n } from "../lib/locale-context";
import { SKIP_PROMPT_SECONDS } from "../hooks/useSkipPrompt";

/**
 * "Skip intro" pill (Nuvio style). Mount it with a `key` that changes on every show so
 * the enter animation and the progress line restart.
 */
export function SkipButton({
  label,
  onSkip,
  onDismiss,
}: {
  label: string;
  onSkip: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="skip-in absolute right-6 bottom-[176px] z-30 flex items-stretch overflow-hidden rounded-2xl bg-[#1e1e1e]/85 text-white shadow-[0_8px_24px_rgb(0_0_0_/_0.5)] ring-1 ring-white/10 backdrop-blur-md">
      <button
        type="button"
        onClick={onSkip}
        className="btn-press relative inline-flex items-center gap-2 py-3 pr-4 pl-[18px] text-[14px] font-semibold hover:bg-white/8"
      >
        <SkipForward size={18} fill="currentColor" />
        {label}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-white/15"
        >
          <span
            className="skip-progress block h-full bg-white/90"
            style={{ animationDuration: `${SKIP_PROMPT_SECONDS}s` }}
          />
        </span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("close")}
        className="icon-hit grid w-9 place-items-center border-l border-white/10 text-white/60 hover:bg-white/8"
      >
        <X size={14} />
      </button>
    </div>
  );
}
