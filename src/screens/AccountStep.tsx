import { useState } from "react";
import { ArrowLeft, CloudUpload } from "lucide-react";
import { Logo } from "../components/Logo";
import { WindowControls } from "../components/WindowControls";
import { LanguageSelect } from "../components/LanguageSelect";
import { AccountPanel } from "../components/account/AccountPanel";
import { api } from "../lib/api";
import { useI18n } from "../lib/locale-context";

/**
 * Shown once per profile before Home: create an ejFlix account, sign in to one, or
 * skip it (Settings › Account keeps the door open).
 */
export function AccountStep({ onDone, onToast }: { onDone: () => void; onToast: (message: string) => void }) {
  const { t } = useI18n();
  const [view, setView] = useState<"intro" | "signup" | "signin">("intro");

  const skip = () => {
    void api.accountDismissPrompt().catch(() => undefined);
    onDone();
  };

  return (
    <div className="grain relative flex h-full flex-col bg-base">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_50%_0%,color-mix(in_oklab,var(--color-accent)_12%,transparent),transparent_55%)]" />
      <div className="relative z-10 flex h-[60px] items-center justify-between px-6">
        <button type="button" onClick={skip} aria-label={t("home")} className="btn-press inline-flex items-center">
          <Logo />
        </button>
        <div className="flex items-center gap-2">
          <LanguageSelect />
          <WindowControls />
        </div>
      </div>
      <div className="relative z-10 flex flex-1 items-center justify-center overflow-y-auto px-6 py-8">
        <div className="modal-enter w-[460px] max-w-full rounded-card bg-surface p-8 shadow-[0_24px_64px_rgb(0_0_0_/_0.45),0_0_0_1px_rgb(255_255_255_/_0.06)]">
          {view === "intro" ? (
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
              <AccountPanel initialMode={view} onSignedIn={onDone} onToast={onToast} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
