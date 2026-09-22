import { useState, type FormEvent } from "react";
import { LoaderCircle, MailCheck, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/locale-context";
import { authErrorText } from "../../lib/account-errors";
import { fieldClass as field } from "../../lib/ui";

export type PanelMode = "signin" | "signup" | "forgot" | "linkSent" | "confirm" | "mfa";

const primary =
  "btn-press inline-flex h-11 w-full items-center justify-center gap-2 rounded-btn bg-accent px-5 text-[14px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60";
const tonal =
  "btn-press inline-flex h-11 w-full items-center justify-center gap-2 rounded-btn bg-white/12 px-5 text-[14px] font-semibold hover:bg-white/18 disabled:opacity-60";
const link = "text-[13px] font-medium text-accent hover:underline";

/**
 * Sign in, create an account, recover the password and answer the second factor.
 * Everything runs through Rust; this only collects what the person types.
 */
export function AccountPanel({
  initialMode = "signin",
  onSignedIn,
  onToast,
}: {
  initialMode?: "signin" | "signup" | "mfa";
  onSignedIn: () => void;
  onToast: (message: string) => void;
}) {
  const { t, locale } = useI18n();
  const [mode, setMode] = useState<PanelMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(authErrorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const signIn = () =>
    run(async () => {
      const result = await api.accountSignIn(email, password);
      if (result.mfaRequired) {
        setCode("");
        setMode("mfa");
      } else {
        onSignedIn();
      }
    });

  const signUp = () =>
    run(async () => {
      if (password !== password2) throw new Error("auth:password_mismatch");
      const result = await api.accountSignUp(email, password, locale);
      if (result.confirmEmail) setMode("confirm");
      else onSignedIn();
    });

  const forgot = () =>
    run(async () => {
      await api.accountResetPassword(email, locale);
      setMode("linkSent");
    });

  const verify = () =>
    run(async () => {
      await api.accountMfaVerify(code);
      onSignedIn();
    });

  const resend = () =>
    run(async () => {
      await api.accountResendConfirmation(email);
      onToast(t("accountResent"));
    });

  const submit = (action: () => Promise<void>) => (e: FormEvent) => {
    e.preventDefault();
    void action();
  };

  const go = (next: PanelMode) => {
    setError("");
    setMode(next);
  };

  const spinner = busy ? <LoaderCircle size={16} className="animate-spin" /> : null;
  const errorLine = error ? <p className="text-[13px] text-danger">{error}</p> : null;

  const emailInput = (
    <input
      type="email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      placeholder={t("accountEmailPlaceholder")}
      aria-label={t("accountEmail")}
      autoComplete="email"
      autoFocus
      className={field}
    />
  );

  if (mode === "mfa") {
    return (
      <form className="space-y-3" onSubmit={submit(verify)}>
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <ShieldCheck size={18} />
          </span>
          <div>
            <p className="text-[15px] font-semibold">{t("accountMfaTitle")}</p>
            <p className="text-[12px] text-dim">{t("accountMfaHint")}</p>
          </div>
        </div>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          aria-label={t("accountMfaCode")}
          autoFocus
          className={`${field} tabular text-center text-[18px] tracking-[0.3em]`}
        />
        {errorLine}
        <button type="submit" disabled={busy || code.length !== 6} className={primary}>
          {spinner}
          {t("accountVerify")}
        </button>
      </form>
    );
  }

  if (mode === "confirm") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <MailCheck size={18} />
          </span>
          <p className="text-[15px] font-semibold">{t("accountConfirmTitle")}</p>
        </div>
        <p className="text-[13px] leading-[1.5] text-muted">{t("accountConfirmText", { email })}</p>
        {errorLine}
        <button type="button" disabled={busy} onClick={() => void signIn()} className={primary}>
          {spinner}
          {t("accountSignIn")}
        </button>
        <button type="button" disabled={busy} onClick={() => void resend()} className={tonal}>
          {t("accountResend")}
        </button>
      </div>
    );
  }

  if (mode === "linkSent") {
    return (
      <div className="space-y-3">
        <p className="text-[15px] font-semibold">{t("accountForgotTitle")}</p>
        <p className="text-[13px] leading-[1.5] text-muted">{t("accountLinkSent", { email })}</p>
        <button type="button" onClick={() => go("signin")} className={tonal}>
          {t("accountBackToSignIn")}
        </button>
      </div>
    );
  }

  if (mode === "forgot") {
    return (
      <form className="space-y-3" onSubmit={submit(forgot)}>
        <p className="text-[15px] font-semibold">{t("accountForgotTitle")}</p>
        <p className="text-[13px] leading-[1.5] text-muted">{t("accountForgotHint")}</p>
        {emailInput}
        {errorLine}
        <button type="submit" disabled={busy || !email.trim()} className={primary}>
          {spinner}
          {t("accountSendLink")}
        </button>
        <button type="button" onClick={() => go("signin")} className={link}>
          {t("accountBackToSignIn")}
        </button>
      </form>
    );
  }

  if (mode === "signup") {
    return (
      <form className="space-y-3" onSubmit={submit(signUp)}>
        {emailInput}
        <div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("accountPassword")}
            aria-label={t("accountPassword")}
            autoComplete="new-password"
            minLength={8}
            className={field}
          />
          <p className="mt-1 text-[12px] text-dim">{t("accountPasswordHint")}</p>
        </div>
        <input
          type="password"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          placeholder={t("accountPasswordRepeat")}
          aria-label={t("accountPasswordRepeat")}
          autoComplete="new-password"
          minLength={8}
          className={field}
        />
        {errorLine}
        <button type="submit" disabled={busy || !email.trim() || password.length < 8} className={primary}>
          {spinner}
          {t("accountSignUp")}
        </button>
        <p className="text-[13px] text-dim">
          {t("accountAlready")}{" "}
          <button type="button" onClick={() => go("signin")} className={link}>
            {t("accountSignIn")}
          </button>
        </p>
      </form>
    );
  }

  return (
    <form className="space-y-3" onSubmit={submit(signIn)}>
      {emailInput}
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t("accountPassword")}
        aria-label={t("accountPassword")}
        autoComplete="current-password"
        className={field}
      />
      <div className="flex justify-end">
        <button type="button" onClick={() => go("forgot")} className={link}>
          {t("accountForgot")}
        </button>
      </div>
      {errorLine}
      <button type="submit" disabled={busy || !email.trim() || !password} className={primary}>
        {spinner}
        {t("accountSignIn")}
      </button>
      <p className="text-[13px] text-dim">
        {t("accountNoAccount")}{" "}
        <button type="button" onClick={() => go("signup")} className={link}>
          {t("accountCreate")}
        </button>
      </p>
    </form>
  );
}
