import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Dialog } from "./Dialog";
import { PinInput } from "./PinInput";
import { useI18n } from "../lib/locale-context";
import type { MessageKey } from "../lib/i18n";
import { parentalErrorKey } from "../lib/parental";

type Step = "current" | "new" | "confirm";

const STEP_LABEL: Record<Step, MessageKey> = {
  current: "parentalPinEnter",
  new: "parentalPinNew",
  confirm: "parentalPinConfirm",
};

/**
 * Asks for the parental PIN, a new one (typed twice), or both. `onSubmit` gets the PINs
 * once every step is filled; when it rejects with a PIN error the dialog starts over
 * with the message, anything else is shown as it is.
 */
export function ParentalPinDialog({
  steps,
  title,
  hint,
  onSubmit,
  onClose,
}: {
  steps: Step[];
  title: string;
  hint?: string;
  onSubmit: (pins: { current: string; next: string }) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [pins, setPins] = useState({ current: "", next: "" });
  const [message, setMessage] = useState("");
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const step = steps[index];

  const fail = (text: string, restartAt: number) => {
    setMessage(text);
    setShake(true);
    window.setTimeout(() => setShake(false), 600);
    setIndex(restartAt);
  };

  const submit = async (pin: string) => {
    const nextPins =
      step === "current" ? { ...pins, current: pin } : step === "new" ? { ...pins, next: pin } : pins;
    if (step === "confirm" && pin !== pins.next) {
      fail(t("parentalPinMismatch"), steps.indexOf("new"));
      return;
    }
    setPins(nextPins);
    setMessage("");
    if (index < steps.length - 1) {
      setIndex(index + 1);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(nextPins);
    } catch (err) {
      const key = parentalErrorKey(err);
      fail(key ? t(key) : err instanceof Error ? err.message : String(err), 0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      labelledBy="parental-pin-title"
      onEscape={onClose}
      onBackdrop={onClose}
      className="flex w-[min(400px,92vw)] flex-col items-center rounded-card bg-surface p-8 text-center shadow-[0_24px_64px_rgb(0_0_0_/_0.45),0_0_0_1px_rgb(255_255_255_/_0.06)]"
    >
      <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
        <ShieldCheck size={26} />
      </span>
      <h2 id="parental-pin-title" className="text-[20px] font-semibold [text-wrap:balance]">
        {title}
      </h2>
      {hint ? <p className="mt-1 max-w-[36ch] text-[13px] text-dim">{hint}</p> : null}
      <p className="mt-6 mb-4 text-[14px] font-medium text-muted">{t(STEP_LABEL[step])}</p>
      <PinInput key={`${step}:${index}`} error={shake} disabled={busy} onSubmit={(pin) => void submit(pin)} />
      <p className="mt-4 min-h-5 text-[13px] text-danger" role="alert">
        {message}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="btn-press mt-4 inline-flex h-10 items-center rounded-pill bg-white/10 px-5 text-[13px] font-semibold hover:bg-white/16"
      >
        {t("cancel")}
      </button>
    </Dialog>
  );
}
