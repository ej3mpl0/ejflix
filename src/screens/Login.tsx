import { useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, LoaderCircle, Wifi } from "lucide-react";
import { Logo } from "../components/Logo";
import { WindowControls } from "../components/WindowControls";
import { LanguageSelect } from "../components/LanguageSelect";
import { api } from "../lib/api";
import { useI18n } from "../lib/locale-context";
import type { SavedServer } from "../lib/types";
import { fieldLgClass } from "../lib/ui";
import { cn } from "../lib/format";

export function Login({
  onConnected,
  onBack,
}: {
  onConnected: (server: SavedServer) => void;
  /** Return to the previous screen (welcome or profiles). */
  onBack?: () => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState("http://localhost:8096");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  const test = async () => {
    setError("");
    setTested(null);
    setTesting(true);
    try {
      const info = await api.testServer(url);
      setTested(`${info.serverName} · Jellyfin ${info.version}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const connect = async () => {
    setError("");
    setLoading(true);
    try {
      const info = await api.probeServer(url);
      const saved = await api.savedServer();
      onConnected(
        saved ?? {
          serverUrl: url.trim().replace(/\/+$/, ""),
          serverName: info.serverName,
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grain relative flex h-full flex-col bg-base">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(800px_circle_at_50%_20%,color-mix(in_oklab,var(--color-accent)_15%,transparent),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_40%,var(--color-base)_100%)]" />
      <div className="relative z-10 flex h-[60px] items-center justify-between pl-6">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-10 items-center gap-2 rounded-pill px-3 text-sm text-dim hover:text-text"
          >
            <ArrowLeft size={16} />
            {t("back")}
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <LanguageSelect />
          <WindowControls />
        </div>
      </div>
      <div className="relative z-10 flex flex-1 items-center justify-center overflow-y-auto px-6 py-8">
        <form
          className="w-[420px] max-w-full rounded-2xl bg-surface p-8 shadow-[0_24px_64px_rgb(0_0_0_/_0.45),0_0_0_1px_rgb(255_255_255_/_0.06)]"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <div className="mb-8 text-center">
            <Logo size="login" />
          </div>
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">
            {t("jellyfinServer")}
          </label>
          <input
            autoFocus
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setTested(null);
            }}
            placeholder="http://192.168.1.10:8096"
            className={cn("mb-2", fieldLgClass)}
          />
          {error ? (
            <p className="mb-3 text-sm text-danger">{error}</p>
          ) : tested ? (
            <p className="mb-3 flex items-center gap-1.5 text-sm text-success" role="status">
              <CheckCircle2 size={15} />
              {tested}
            </p>
          ) : (
            <div className="mb-3 h-5" />
          )}
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="btn-press flex h-12 w-full items-center justify-center gap-2 rounded-btn bg-accent text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
          >
            {loading ? <LoaderCircle size={16} className="animate-spin" /> : null}
            {t("connect")}
          </button>
          <button
            type="button"
            disabled={testing || loading || !url.trim()}
            onClick={() => void test()}
            className="btn-press mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-btn bg-white/8 text-sm font-semibold hover:bg-white/12 disabled:opacity-60"
          >
            {testing ? <LoaderCircle size={16} className="animate-spin" /> : <Wifi size={16} />}
            {t("testConnection")}
          </button>
          <button
            type="button"
            aria-expanded={help}
            onClick={() => setHelp((v) => !v)}
            className="mt-4 flex w-full items-center justify-center gap-1 text-[13px] text-dim hover:text-text"
          >
            {t("serverHelpTitle")}
            <ChevronDown size={14} className={cn("transition-transform", help && "rotate-180")} />
          </button>
          {help ? (
            <ul className="mt-3 space-y-2 rounded-btn bg-black/25 p-4 text-[12.5px] leading-[1.5] text-muted">
              <li>{t("serverHelpSamePc")}</li>
              <li>{t("serverHelpLan")}</li>
              <li>{t("serverHelpRemote")}</li>
              <li>{t("serverHelpDashboard")}</li>
            </ul>
          ) : null}
        </form>
      </div>
    </div>
  );
}
