import { useCallback, useEffect, useState } from "react";
import { Copy, LoaderCircle, LogOut, RefreshCw, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import type { AccountStatus, MfaEnrollment } from "../../lib/types";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/locale-context";
import { authErrorText } from "../../lib/account-errors";
import { SettingsRow, SettingsSection } from "../settings/SettingsSection";
import { Toggle } from "../settings/Toggle";
import { AccountPanel } from "./AccountPanel";

const field =
  "h-11 w-full rounded-btn border border-white/12 bg-black/40 px-3 text-sm text-text outline-none placeholder:text-dim focus:border-accent";
const tonal =
  "btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-white/12 px-5 text-[14px] font-semibold hover:bg-white/18 disabled:opacity-60";
const primary =
  "btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-accent px-5 text-[14px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60";
const danger =
  "btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-white/12 px-5 text-[14px] font-semibold text-accent hover:bg-accent-soft disabled:opacity-60";

/** Settings › Account: the ejFlix account of the active profile. */
export function AccountSettings({ onToast }: { onToast: (message: string) => void }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [enroll, setEnroll] = useState<MfaEnrollment | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [code, setCode] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reload = useCallback(async () => {
    try {
      setStatus(await api.accountStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void reload();
    const unlisten = api.onAccountChanged(setStatus);
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [reload]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNote("");
    try {
      await fn();
    } catch (err) {
      const text = authErrorText(err, t);
      setNote(text);
      onToast(text);
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  if (!status.signedIn || status.mfaRequired) {
    return (
      <SettingsSection
        title={t("accountEjflix")}
        description={status.mfaRequired ? (status.email ?? undefined) : t("accountIntroText")}
      >
        <div className="max-w-[420px] py-4">
          <AccountPanel
            key={status.mfaRequired ? "mfa" : "signin"}
            initialMode={status.mfaRequired ? "mfa" : "signin"}
            onSignedIn={() => void reload()}
            onToast={onToast}
          />
        </div>
      </SettingsSection>
    );
  }

  const lastSync = status.lastSyncMs
    ? t("accountLastSync", {
        time: new Date(status.lastSyncMs).toLocaleString(locale === "es" ? "es-ES" : "en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      })
    : t("accountNeverSynced");

  const syncNow = () =>
    run(async () => {
      const report = await api.accountSyncNow();
      if (report.skipped === "mfa_required") {
        setNote(t("accountSyncSkippedMfa"));
        return;
      }
      setNote(
        `${t("accountSynced")} ${t("accountSyncedDetail", {
          pushed: report.pushed.length,
          pulled: report.pulled.length,
        })}`,
      );
    });

  const startEnroll = () =>
    run(async () => {
      setCode("");
      setEnroll(await api.accountMfaEnroll());
    });

  const confirmEnroll = () =>
    run(async () => {
      if (!enroll) return;
      setStatus(await api.accountMfaConfirm(enroll.factorId, code));
      setEnroll(null);
      setCode("");
    });

  const disable = () =>
    run(async () => {
      setStatus(await api.accountMfaDisable(code));
      setDisabling(false);
      setCode("");
    });

  const copySecret = async () => {
    if (!enroll) return;
    try {
      await navigator.clipboard.writeText(enroll.secret);
      onToast(t("accountSecretCopied"));
    } catch {
      /* clipboard blocked: the key stays visible */
    }
  };

  const codeInput = (
    <input
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123456"
      aria-label={t("accountMfaCode")}
      className={`${field} tabular max-w-[200px] text-center text-[18px] tracking-[0.3em]`}
    />
  );

  return (
    <>
      <SettingsSection title={t("accountEjflix")} description={`${t("accountSignedInAs")} ${status.email ?? ""}`}>
        <SettingsRow label={lastSync} hint={note || status.lastError || undefined}>
          <button type="button" disabled={busy || status.syncing} onClick={() => void syncNow()} className={tonal}>
            {busy || status.syncing ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {status.syncing ? t("accountSyncing") : t("accountSyncNow")}
          </button>
        </SettingsRow>
        <SettingsRow label={t("accountCredentials")} hint={t("accountCredentialsHint")}>
          <Toggle
            checked={status.syncCredentials}
            onChange={(value) => void run(async () => setStatus(await api.accountSetCredentials(value)))}
            label={t("accountCredentials")}
          />
        </SettingsRow>
        <SettingsRow label={t("accountSignOutAccount")} hint={t("accountSignOutHint")}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(async () => setStatus(await api.accountSignOut()))}
            className={tonal}
          >
            <LogOut size={16} />
            {t("signOut")}
          </button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title={t("accountTwoFactor")}
        description={status.mfaEnabled ? t("accountTwoFactorOn") : t("accountTwoFactorOff")}
      >
        {enroll ? (
          <div className="space-y-4 py-4">
            <p className="text-[13px] text-muted">{t("accountScanQr")}</p>
            <div className="flex flex-wrap items-start gap-5">
              <img
                src={enroll.qrCode}
                alt=""
                width={176}
                height={176}
                className="h-44 w-44 rounded-2xl bg-white p-2"
              />
              <div className="min-w-0 flex-1 space-y-3">
                <code className="block break-all rounded-btn bg-black/40 px-3 py-2 text-[13px] tracking-wide text-text">
                  {enroll.secret}
                </code>
                <button type="button" onClick={() => void copySecret()} className={tonal}>
                  <Copy size={16} />
                  {t("accountCopySecret")}
                </button>
                <p className="text-[13px] text-muted">{t("accountEnterFirstCode")}</p>
                {codeInput}
                <div className="flex flex-wrap gap-3">
                  <button type="button" disabled={busy || code.length !== 6} onClick={() => void confirmEnroll()} className={primary}>
                    {busy ? <LoaderCircle size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                    {t("accountVerify")}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setEnroll(null)} className={tonal}>
                    {t("accountCancel")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : disabling ? (
          <div className="space-y-3 py-4">
            <p className="text-[13px] text-muted">{t("accountDisable2faHint")}</p>
            {codeInput}
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={busy || code.length !== 6} onClick={() => void disable()} className={danger}>
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : <ShieldOff size={16} />}
                {t("accountDisable2fa")}
              </button>
              <button type="button" disabled={busy} onClick={() => setDisabling(false)} className={tonal}>
                {t("accountCancel")}
              </button>
            </div>
          </div>
        ) : (
          <div className="py-4">
            {status.mfaEnabled ? (
              <button type="button" disabled={busy} onClick={() => { setCode(""); setDisabling(true); }} className={tonal}>
                <ShieldOff size={16} />
                {t("accountDisable2fa")}
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void startEnroll()} className={primary}>
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                {t("accountEnable2fa")}
              </button>
            )}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title={t("accountDelete")} description={t("accountDeleteHint")}>
        <div className="py-4">
          {confirmDelete ? (
            <div className="space-y-3">
              <p className="text-[13px] font-medium text-accent">{t("accountDeleteConfirm")}</p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setStatus(await api.accountDelete());
                      setConfirmDelete(false);
                      onToast(t("accountDeleted"));
                    })
                  }
                  className={danger}
                >
                  {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={16} />}
                  {t("accountDeleteYes")}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)} className={tonal}>
                  {t("accountCancel")}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)} className={danger}>
              <Trash2 size={16} />
              {t("accountDelete")}
            </button>
          )}
        </div>
      </SettingsSection>
    </>
  );
}
