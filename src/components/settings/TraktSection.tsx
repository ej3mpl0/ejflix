import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Download, ExternalLink, KeyRound, LoaderCircle, LogOut, Link2 } from "lucide-react";
import { api } from "../../lib/api";
import { cn } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";
import type { TraktDeviceCode, TraktStatus } from "../../lib/types";
import { fieldClass as field, labelClass } from "../../lib/ui";
import { ConfirmButton } from "../ConfirmButton";
import { SettingsRow, SettingsSection } from "./SettingsSection";
import { Toggle } from "./Toggle";

const APPS_URL = "https://trakt.tv/oauth/applications";
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

const tonal =
  "btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-white/12 px-5 text-[14px] font-semibold hover:bg-white/18 disabled:opacity-60";
const primary =
  "btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-accent px-5 text-[14px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60";

function errorText(err: unknown, t: ReturnType<typeof useI18n>["t"]): string {
  const text = err instanceof Error ? err.message : String(err);
  if (text === "trakt_bad_app") return t("traktBadApp");
  if (text === "trakt_expired" || text === "trakt_not_connected") return t("traktExpired");
  return text;
}

/**
 * Settings › Trakt: the user's own API application, the device sign-in (a code typed
 * at trakt.tv/activate while this polls), the import and the sync-back switch.
 */
export function TraktSection({ onToast }: { onToast: (message: string) => void }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<TraktStatus | null>(null);
  const [editingApp, setEditingApp] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [device, setDevice] = useState<TraktDeviceCode | null>(null);
  const [busy, setBusy] = useState<"app" | "connect" | "import" | null>(null);
  const [error, setError] = useState("");
  const polling = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (polling.current != null) window.clearTimeout(polling.current);
    polling.current = null;
  }, []);

  useEffect(() => {
    api
      .traktStatus()
      .then((next) => {
        setStatus(next);
        setClientId(next.clientId);
      })
      .catch((err) => setError(errorText(err, t)));
    return stopPolling;
  }, [stopPolling, t]);

  if (!status) {
    return (
      <SettingsSection title={t("traktTitle")}>
        <div className="grid place-items-center py-8">
          {error ? <p className="text-[13px] text-danger">{error}</p> : <LoaderCircle size={20} className="animate-spin text-dim" />}
        </div>
      </SettingsSection>
    );
  }

  const configured = status.clientId !== "" && status.hasSecret;

  const saveApp = async () => {
    setBusy("app");
    setError("");
    try {
      const next = await api.traktSetApp(clientId, clientSecret);
      setStatus(next);
      setClientSecret("");
      setEditingApp(false);
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(null);
    }
  };

  const poll = (interval: number) => {
    polling.current = window.setTimeout(async () => {
      try {
        const outcome = await api.traktDevicePoll();
        if (outcome === "pending") return poll(interval);
        if (outcome === "slow_down") return poll(interval + 5);
        setDevice(null);
        if (outcome === "connected") {
          setStatus(await api.traktStatus());
          onToast(t("traktConnected"));
        } else {
          setError(outcome === "denied" ? t("traktDenied") : t("traktCodeExpired"));
        }
      } catch (err) {
        setDevice(null);
        setError(errorText(err, t));
      }
    }, interval * 1000);
  };

  const connect = async () => {
    setBusy("connect");
    setError("");
    stopPolling();
    try {
      const code = await api.traktDeviceStart();
      setDevice(code);
      void api.traktOpen(code.verificationUrl).catch(() => undefined);
      poll(code.interval);
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(null);
    }
  };

  const runImport = async () => {
    setBusy("import");
    setError("");
    try {
      const report = await api.traktImport();
      setStatus(await api.traktStatus());
      onToast(t("traktImported", { watchlist: report.watchlist, watched: report.watched, episodes: report.episodes }));
      if (report.unmatched || report.skipped) {
        setError(t("traktImportLeftOut", { unmatched: report.unmatched, skipped: report.skipped }));
      }
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(null);
    }
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => onToast(t("traktCopied")));
  };

  return (
    <SettingsSection title={t("traktTitle")} description={t("traktHint")}>
      {!configured || editingApp ? (
        <form
          className="space-y-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void saveApp();
          }}
        >
          <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-muted">
            <li>
              {t("traktStepCreate")}{" "}
              <button
                type="button"
                onClick={() => void api.traktOpen(APPS_URL)}
                className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
              >
                trakt.tv/oauth/applications
                <ExternalLink size={12} />
              </button>
            </li>
            <li>
              {t("traktStepRedirect")}{" "}
              <button
                type="button"
                onClick={() => copy(REDIRECT_URI)}
                className="inline-flex items-center gap-1 rounded bg-white/8 px-1.5 font-mono text-[12px] text-text hover:bg-white/12"
                aria-label={t("traktCopyRedirect")}
              >
                {REDIRECT_URI}
                <Copy size={11} />
              </button>
            </li>
            <li>{t("traktStepPaste")}</li>
          </ol>
          <div className="grid gap-3 md:grid-cols-2">
            <label>
              <span className={labelClass}>{t("traktClientId")}</span>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value.trim())}
                spellCheck={false}
                autoComplete="off"
                className={cn(field, "font-mono text-[13px]")}
              />
            </label>
            <label>
              <span className={labelClass}>{t("traktClientSecret")}</span>
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value.trim())}
                placeholder={status.hasSecret ? "••••••••" : ""}
                autoComplete="off"
                className={cn(field, "font-mono text-[13px]")}
              />
            </label>
          </div>
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={busy != null || !clientId || (!clientSecret && !status.hasSecret)}
              className={primary}
            >
              {busy === "app" ? <LoaderCircle size={16} className="animate-spin" /> : <KeyRound size={16} />}
              {t("save")}
            </button>
            {configured ? (
              <button type="button" onClick={() => setEditingApp(false)} className={tonal}>
                {t("cancel")}
              </button>
            ) : null}
          </div>
        </form>
      ) : !status.connected ? (
        <div className="space-y-4 py-4">
          {device ? (
            <div className="rounded-btn bg-white/4 p-5 text-center">
              <p className="text-[13px] text-muted">{t("traktEnterCode")}</p>
              <button
                type="button"
                onClick={() => copy(device.userCode)}
                className="mt-2 inline-flex items-center gap-2 rounded-btn px-3 py-1 font-mono text-[30px] font-semibold tracking-[0.2em] hover:bg-white/6"
                aria-label={t("traktCopyCode")}
              >
                {device.userCode}
                <Copy size={16} className="text-dim" />
              </button>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
                <button type="button" onClick={() => void api.traktOpen(device.verificationUrl)} className={tonal}>
                  <ExternalLink size={16} />
                  {device.verificationUrl.replace(/^https:\/\//, "")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stopPolling();
                    setDevice(null);
                  }}
                  className={tonal}
                >
                  {t("cancel")}
                </button>
              </div>
              <p className="mt-4 inline-flex items-center gap-2 text-[12px] text-dim">
                <LoaderCircle size={13} className="animate-spin" />
                {t("traktWaiting")}
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={busy != null} onClick={() => void connect()} className={primary}>
                {busy === "connect" ? <LoaderCircle size={16} className="animate-spin" /> : <Link2 size={16} />}
                {t("traktConnect")}
              </button>
              <button type="button" onClick={() => setEditingApp(true)} className={tonal}>
                <KeyRound size={16} />
                {t("traktChangeApp")}
              </button>
            </div>
          )}
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
        </div>
      ) : (
        <>
          <div className="py-3">
            <p className="text-[14px] font-medium">{t("traktSignedInAs", { name: status.username || "Trakt" })}</p>
            <p className="mt-0.5 text-[12px] text-dim">
              {status.lastImportMs
                ? t("traktLastImport", { date: new Date(status.lastImportMs).toLocaleString(locale) })
                : t("traktNeverImported")}
            </p>
          </div>
          <SettingsRow label={t("traktImport")} hint={t("traktImportHint")}>
            <button type="button" disabled={busy != null} onClick={() => void runImport()} className={tonal}>
              {busy === "import" ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
              {busy === "import" ? t("traktImporting") : t("traktImportNow")}
            </button>
          </SettingsRow>
          <SettingsRow label={t("traktSyncBack")} hint={t("traktSyncBackHint")}>
            <Toggle
              checked={status.syncBack}
              onChange={(on) => void api.traktSetSyncBack(on).then(setStatus).catch((err) => setError(errorText(err, t)))}
              label={t("traktSyncBack")}
            />
          </SettingsRow>
          {error ? <p className="py-3 text-[13px] text-danger">{error}</p> : null}
          <div className="flex flex-wrap gap-3 py-4">
            <ConfirmButton
              confirmLabel={t("traktDisconnect")}
              onConfirm={async () => {
                setStatus(await api.traktDisconnect());
              }}
              trigger={(ask) => (
                <button type="button" onClick={ask} className={tonal}>
                  <LogOut size={16} />
                  {t("traktDisconnect")}
                </button>
              )}
            />
          </div>
        </>
      )}
    </SettingsSection>
  );
}
