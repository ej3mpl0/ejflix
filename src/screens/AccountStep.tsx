import { useState } from "react";
import { ArrowLeft, CloudUpload, LogOut, ShieldCheck } from "lucide-react";
import { Logo } from "../components/Logo";
import { WindowControls } from "../components/WindowControls";
import { LanguageSelect } from "../components/LanguageSelect";
import { AccountPanel } from "../components/account/AccountPanel";
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
  onToast: (message: string) => void;
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
    <div className="grain relative flex h-full flex-col bg-base">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_50%_0%,color-mix(in_oklab,var(--color-accent)_12%,transparent),transparent_55%)]" />
      {/* The logo is plain branding here: skipping the account is an explicit choice below. */}
      <div className="relative z-10 flex h-[60px] items-center justify-between px-6" data-tauri-drag-region>
        <div data-tauri-drag-region>
          <Logo />
        </div>
        <div className="flex items-center gap-2">
          <LanguageSelect />
          <WindowControls />
        </div>
      </div>
      <div className="relative z-10 flex flex-1 items-center justify-center overflow-y-auto px-6 py-8">
        <div className="modal-enter w-[460px] max-w-full rounded-card bg-surface p-8 shadow-[0_24px_64px_rgb(0_0_0_/_0.45),0_0_0_1px_rgb(255_255_255_/_0.06)]">
          {mode === "mfa" ? (
            <div className="flex flex-col">
              <span className="mb-5 grid h-14 w-14 place-items-center self-center rounded-2xl bg-accent-soft text-accent">
                <ShieldCheck size={26} />
              </span>
              <h1 className="mb-1 text-center text-[24px] font-semibold tracking-tight [text-wrap:balance]">{t("accountMfaTitle")}</h1>
              <p className="mb-6 text-center text-[13px] leading-[1.5] text-dim">{t("accountMfaPending")}</p>
              <AccountPanel initialMode="mfa" onSignedIn={() => onDone("done")} onToast={onToast} />
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void signOut()}
                  className="btn-press inline-flex h-11 items-center justify-center gap-2 rounded-btn bg-white/10 px-5 text-[14px] font-semibold hover:bg-white/16 disabled:opacity-60"
                >
                  <LogOut size={16} />
                  {t("accountSignOutAccount")}
                </button>
                <button
                  type="button"
                  onClick={() => onDone("later")}
                  className="btn-press inline-flex h-11 items-center justify-center rounded-btn px-5 text-[14px] font-medium text-muted hover:bg-white/8 hover:text-text"
                >
                  {t("accountNotNow")}
                </button>
              </div>
            </div>
          ) : view === "intro" ? (
            <div className="flex flex-col items-center text-center">
              <span className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
                <CloudUpload size={26} />
              </span>
              <h1 className="mb-1 text-[24px] font-semibold tracking-tight [text-wrap:balance]">{t("accountIntroTitle")}</h1>
              <p className="mb-6 text-[13px] leading-[1.5] text-dim">{t("accountIntroText")}</p>
              <div className="flex w-full flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setView("signup")}
                  className="btn-press inline-flex h-12 items-center justify-center gap-2 rounded-btn bg-accent px-6 text-[14px] font-semibold text-on-accent hover:bg-accent-hover"
                >
                  {t("accountCreate")}
                </button>
                <button
                  type="button"
                  onClick={() => setView("signin")}
                  className="btn-press inline-flex h-12 items-center justify-center rounded-btn bg-white/10 px-5 text-[14px] font-semibold hover:bg-white/16"
                >
                  {t("accountHaveOne")}
                </button>
                <button
                  type="button"
                  onClick={skip}
                  className="btn-press inline-flex h-11 items-center justify-center rounded-btn px-5 text-[14px] font-medium text-muted hover:bg-white/8 hover:text-text"
                >
                  {t("accountNotNow")}
                </button>
              </div>
              <p className="mt-4 text-[12px] text-dim">{t("accountLater")}</p>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setView("intro")}
                className="btn-press mb-4 inline-flex h-9 items-center gap-2 rounded-pill bg-white/10 px-4 text-[13px] font-medium hover:bg-white/16"
              >
                <ArrowLeft size={15} />
                {t("back")}
              </button>
              <h1 className="mb-1 text-[24px] font-semibold tracking-tight">
                {view === "signup" ? t("accountCreate") : t("accountSignIn")}
              </h1>
              <p className="mb-6 text-[13px] text-dim">{t("accountEjflix")}</p>
              <AccountPanel initialMode={view} onSignedIn={() => onDone("done")} onToast={onToast} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
