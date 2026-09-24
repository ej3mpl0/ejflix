import React, { useState } from "react";
import { Text, View } from "react-native";
import { ShieldCheck } from "lucide-react-native";
import type { MessageKey } from "../../lib/i18n";
import { useI18n } from "../../lib/locale-context";
import { parentalErrorKey } from "../../lib/parental";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { ModalCard } from "../ui/ModalCard";
import { Pill } from "../ui/Pill";
import { PinInput } from "./PinInput";

type Step = "current" | "new" | "confirm";

const STEP_LABEL: Record<Step, MessageKey> = {
  current: "parentalPinEnter",
  new: "parentalPinNew",
  confirm: "parentalPinConfirm",
};

/**
 * Asks for the parental PIN, a new one (typed twice), or both (desktop
 * `ParentalPinDialog`). A PIN error from `onSubmit` starts over with the message.
 */
export function ParentalPinModal({
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
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const [index, setIndex] = useState(0);
  const [pins, setPins] = useState({ current: "", next: "" });
  const [message, setMessage] = useState("");
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const step = steps[index];

  const fail = (msg: string, restartAt: number) => {
    setMessage(msg);
    setShake(true);
    setTimeout(() => setShake(false), 600);
    setIndex(restartAt);
  };

  const submit = async (pin: string) => {
    const nextPins = step === "current" ? { ...pins, current: pin } : step === "new" ? { ...pins, next: pin } : pins;
    if (step === "confirm" && pin !== pins.next) {
      fail(tr("parentalPinMismatch"), steps.indexOf("new"));
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
      fail(key ? tr(key) : err instanceof Error ? err.message : String(err), 0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalCard visible width={420} onClose={busy ? undefined : onClose}>
      <View style={s.body}>
        <View style={s.icon}>
          <ShieldCheck size={26} color={t.colors.accent} strokeWidth={2} />
        </View>
        <Text style={s.title}>{title}</Text>
        {hint ? <Text style={s.hint}>{hint}</Text> : null}
        <Text style={s.step}>{tr(STEP_LABEL[step])}</Text>
        <PinInput key={`${step}:${index}`} error={shake} disabled={busy} onSubmit={(pin) => void submit(pin)} />
        <Text style={s.error} accessibilityLiveRegion="polite">
          {message}
        </Text>
        <Pill label={tr("cancel")} onPress={onClose} disabled={busy} style={{ alignSelf: "center" }} />
      </View>
    </ModalCard>
  );
}

const useStyles = makeStyles((t) => ({
  body: { padding: 28, alignItems: "center" },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: t.colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: { ...text(20, "semibold"), color: t.colors.text, textAlign: "center" },
  hint: { ...text(13), color: t.colors.dim, textAlign: "center", marginTop: 4 },
  step: { ...text(14, "medium"), color: t.colors.muted, marginTop: 24, marginBottom: 16 },
  error: { ...text(13), color: t.colors.danger, minHeight: 20, marginTop: 16, marginBottom: 12, textAlign: "center" },
}));
