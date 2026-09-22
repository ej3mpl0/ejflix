import { X } from "lucide-react";
import type { Toast as ToastType } from "../lib/types";
import { useI18n } from "../lib/locale-context";

export function ToastStack({ toasts, onDismiss }: { toasts: ToastType[]; onDismiss: (id: number) => void }) {
  const { t } = useI18n();
  // The live region stays mounted so screen readers announce each toast as it is added.
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-6 bottom-6 z-[80] flex max-w-[min(420px,calc(100vw-48px))] flex-col items-end gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast-enter pointer-events-auto flex items-start gap-2 rounded-2xl bg-panel/95 py-3 pr-2 pl-4 text-sm text-text shadow-[0_12px_32px_rgb(0_0_0_/_0.45),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md"
        >
          <span className="min-w-0 flex-1 py-0.5 [overflow-wrap:anywhere]">{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action?.run();
                onDismiss(toast.id);
              }}
              className="shrink-0 rounded-md px-2 py-0.5 text-[13px] font-semibold text-accent hover:bg-white/8"
            >
              {toast.action.label}
            </button>
          ) : null}
          <button
            type="button"
            aria-label={t("close")}
            onClick={() => onDismiss(toast.id)}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-dim hover:bg-white/10 hover:text-text"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
