import { Logo } from "./Logo";
import { ReleaseNotes } from "./ReleaseNotes";
import { useI18n } from "../lib/locale-context";

export function UpdateModal({ version, onClose }: { version: string; onClose: () => void }) {
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-6">
      <div className="modal-enter w-[min(440px,92vw)] rounded-card bg-surface p-8 shadow-[0_24px_64px_rgb(0_0_0_/_0.45),0_0_0_1px_rgb(255_255_255_/_0.06)]">
        <div className="mb-6 text-center">
          <Logo size="login" />
        </div>
        <p className="mb-1 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">
          {t("update")}
        </p>
        <h2 className="mb-5 text-center text-[20px] font-semibold">{t("updatedTo", { version })}</h2>
        <ReleaseNotes className="mb-8 space-y-2.5 text-[15px] leading-[1.6] text-muted" />
        <button
          type="button"
          onClick={onClose}
          className="btn-press flex h-12 w-full items-center justify-center rounded-btn bg-accent text-sm font-semibold text-on-accent hover:bg-accent-hover"
        >
          {t("gotIt")}
        </button>
      </div>
    </div>
  );
}
