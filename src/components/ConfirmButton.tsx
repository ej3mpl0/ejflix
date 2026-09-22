import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../lib/locale-context";
import { Pill } from "./Pill";

/**
 * Two-step destructive action: the trigger swaps in place for "Sure? [Delete] [Cancel]".
 * Escape or a few idle seconds put the trigger back, so nothing is lost by accident.
 */
export function ConfirmButton({
  trigger,
  confirmLabel,
  prompt,
  onConfirm,
  disabled = false,
}: {
  /** The resting button; call `ask` from its onClick. */
  trigger: (ask: () => void) => ReactNode;
  confirmLabel: string;
  /** Shown before the buttons; defaults to "Sure?". */
  prompt?: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!asking) return;
    confirmRef.current?.focus();
    const timer = window.setTimeout(() => setAsking(false), 6000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setAsking(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [asking]);

  if (!asking) return <>{trigger(() => setAsking(true))}</>;

  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-[13px] text-muted" role="group">
      <span>{prompt ?? t("confirmAsk")}</span>
      <Pill
        ref={confirmRef}
        variant="danger"
        size="sm"
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          void onConfirm();
        }}
      >
        {confirmLabel}
      </Pill>
      <Pill variant="tonal" size="sm" onClick={() => setAsking(false)}>
        {t("cancel")}
      </Pill>
    </span>
  );
}
