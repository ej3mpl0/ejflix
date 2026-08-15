import type { Toast as ToastType } from "../lib/types";

export function ToastStack({ toasts }: { toasts: ToastType[] }) {
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-6 bottom-6 z-[80] flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast-enter pointer-events-auto rounded-xl bg-panel/95 px-4 py-3 text-sm text-text shadow-[0_12px_32px_rgb(0_0_0_/_0.45),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md"
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
