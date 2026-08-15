import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Logo } from "../components/Logo";
import { WindowControls } from "../components/WindowControls";
import { LanguageSelect } from "../components/LanguageSelect";
import { api } from "../lib/api";
import { useI18n } from "../lib/locale-context";
import type { SavedServer } from "../lib/types";

export function Login({
  onConnected,
}: {
  onConnected: (server: SavedServer) => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState("http://localhost:8096");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(800px_circle_at_50%_20%,rgba(229,9,20,0.15),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_40%,#0B0B0E_100%)]" />
      <div className="relative z-10 flex h-[60px] items-center justify-end gap-2 pr-0">
        <LanguageSelect />
        <WindowControls />
      </div>
      <div className="relative z-10 flex flex-1 items-center justify-center px-6">
        <form
          className="w-[420px] rounded-2xl bg-surface p-8 shadow-[0_24px_64px_rgb(0_0_0_/_0.45),0_0_0_1px_rgb(255_255_255_/_0.06)]"
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
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://192.168.1.10:8096"
            className="mb-2 h-12 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
          {error ? <p className="mb-3 text-sm text-accent">{error}</p> : <div className="mb-3 h-5" />}
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="btn-press flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold hover:bg-accent-hover disabled:opacity-60"
          >
            {loading ? <LoaderCircle size={16} className="animate-spin" /> : null}
            {t("connect")}
          </button>
        </form>
      </div>
    </div>
  );
}
