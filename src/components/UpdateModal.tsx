import { Logo } from "./Logo";
import { ReleaseNotes } from "./ReleaseNotes";
import { useI18n } from "../lib/locale-context";

export function UpdateModal({ version, onClose }: { version: string; onClose: () => void }) {
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 md:p-6">
      <div className="modal-enter flex max-h-[calc(100vh-2rem)] w-[min(440px,92vw)] flex-col rounded-card bg-surface p-6 shadow-[0_24px_64px_rgb(0_0_0_/_0.45),0_0_0_1px_rgb(255_255_255_/_0.06)] md:p-8">
        <div className="mb-4 text-center md:mb-6">
          <Logo size="login" />
        </div>
        <p className="mb-1 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">
          {t("update")}
        </p>
        <h2 className="mb-5 text-center text-[20px] font-semibold">{t("updatedTo", { version })}</h2>
        {/* The notes are the only part that grows, so they scroll and the button stays put. */}
        <div className="mb-8 min-h-0 flex-1 overflow-y-auto">
          <ReleaseNotes className="space-y-2.5 text-[15px] leading-[1.6] text-muted" />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn-press flex h-12 w-full shrink-0 items-center justify-center rounded-btn bg-accent text-sm font-semibold text-on-accent hover:bg-accent-hover"
        >
          {t("gotIt")}
        </button>
      </div>
    </div>
  );
}
