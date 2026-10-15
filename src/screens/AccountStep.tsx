import { useState } from "react";
import { ArrowLeft, LogOut } from "lucide-react";
import { AccountPanel } from "../components/account/AccountPanel";
import { Pill } from "../components/Pill";
import { OnboardingFrame, StepHeading } from "../components/onboarding/OnboardingFrame";
import { DevicesVisual } from "../components/onboarding/Visuals";
import { api } from "../lib/api";
import { useI18n } from "../lib/locale-context";
import { authErrorText } from "../lib/account-errors";

/**
 * Shown before Home: once per profile, to create an ejFlix account, sign in to one or
 * skip it (Settings › Account keeps the door open); and whenever the account needs
 * the code of a second factor that was enrolled elsewhere.
 */
export function AccountStep({
  mode = "intro",
  onDone,
  onToast,
}: {
  mode?: "intro" | "mfa";
  /** "done" when signed in (or out); "later" when the person put it off. */
  onDone: (reason: "done" | "later") => void;
  onToast: (message: string, action?: { label: string; run: () => void }) => void;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<"intro" | "signup" | "signin">("intro");
  const [busy, setBusy] = useState(false);

  const skip = () => {
    void api.accountDismissPrompt().catch(() => undefined);
    onDone("later");
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await api.accountSignOut();
      onDone("done");
    } catch (err) {
      onToast(authErrorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingFrame
      overlay
      step={mode === "mfa" ? undefined : 3}
      visual={<DevicesVisual />}
      footer={
        mode === "intro" && view === "intro" ? (
          <Pill variant="ghost" size="lg" onClick={skip}>
            {t("accountNotNow")}
          </Pill>
        ) : undefined
      }
    >
      <div className="max-w-[460px]">
        {mode === "mfa" ? (
          <>
            <StepHeading title={t("accountMfaTitle")} text={t("accountMfaPending")} />
            <AccountPanel initialMode="mfa" onSignedIn={() => onDone("done")} onToast={onToast} />
            <div className="mt-4 flex flex-wrap gap-2.5">
              <Pill variant="tonal" icon={<LogOut size={16} />} disabled={busy} onClick={() => void signOut()}>
                {t("accountSignOutAccount")}
              </Pill>
              <Pill variant="ghost" onClick={() => onDone("later")}>
                {t("accountNotNow")}
              </Pill>
            </div>
          </>
        ) : view === "intro" ? (
          <>
            <StepHeading title={t("accountIntroTitle")} text={t("accountIntroText")} />
            <div className="flex flex-wrap gap-2.5">
              <Pill variant="primary" size="lg" onClick={() => setView("signup")}>
                {t("accountCreate")}
              </Pill>
              <Pill variant="tonal" size="lg" onClick={() => setView("signin")}>
                {t("accountHaveOne")}
              </Pill>
            </div>
            <p className="mt-5 text-[13.5px] text-dim">{t("accountLater")}</p>
          </>
        ) : (
          <>
            <Pill variant="tonal" size="sm" className="mb-6" icon={<ArrowLeft size={15} />} onClick={() => setView("intro")}>
              {t("back")}
            </Pill>
            <StepHeading title={view === "signup" ? t("accountCreate") : t("accountSignIn")} text={t("accountEjflix")} />
            <AccountPanel initialMode={view} onSignedIn={() => onDone("done")} onToast={onToast} />
          </>
        )}
      </div>
    </OnboardingFrame>
  );
}
