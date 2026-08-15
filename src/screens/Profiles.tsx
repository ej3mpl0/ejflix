import { useEffect, useState } from "react";
import { LoaderCircle, Lock, UserRoundPlus } from "lucide-react";
import { Logo } from "../components/Logo";
import { WindowControls } from "../components/WindowControls";
import { LanguageSelect } from "../components/LanguageSelect";
import { api } from "../lib/api";
import { useI18n } from "../lib/locale-context";
import type { PublicUser, SavedServer, Session } from "../lib/types";

function avatarHue(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
}

export function Profiles({
  server,
  onReady,
  onChangeServer,
}: {
  server: SavedServer;
  onReady: (session: Session) => void;
  onChangeServer: () => void;
}) {
  const { t } = useI18n();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PublicUser | null>(null);
  const [manual, setManual] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listPublicUsers(server.serverUrl)
      .then((list) => {
        if (cancelled) return;
        setUsers(list);
        if (list.length === 0) setManual(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setManual(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [server.serverUrl]);

  const signIn = async (name: string, pw: string) => {
    setError("");
    setSigning(true);
    try {
      const session = await api.login(server.serverUrl, name.trim(), pw);
      onReady(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSigning(false);
    }
  };

  const pick = (user: PublicUser) => {
    setError("");
    setPassword("");
    setUsername(user.name);
    setManual(false);
    if (!user.hasPassword) {
      void signIn(user.name, "");
      return;
    }
    setSelected(user);
  };

  const showForm = manual || selected != null || users.length === 0;

  return (
    <div className="grain relative flex h-full flex-col bg-base">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_50%_0%,rgba(229,9,20,0.12),transparent_55%)]" />
      <div className="relative z-10 flex h-[60px] items-center justify-between px-6">
        <Logo />
        <div className="flex items-center gap-2">
          <LanguageSelect />
          <WindowControls />
        </div>
      </div>
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-16">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">
          {server.serverName}
        </p>
        <h1 className="mb-10 text-center text-[36px] font-semibold tracking-tight [text-wrap:balance]">
          {selected ? t("helloName", { name: selected.name }) : t("whoIsWatching")}
        </h1>
        {loading ? (
          <LoaderCircle size={28} className="animate-spin text-muted" />
        ) : (
          <div className="flex flex-wrap justify-center gap-8">
            {users.map((user, index) => {
              const hue = avatarHue(user.name);
              const active = selected?.id === user.id;
              return (
                <button
                  key={user.id}
                  type="button"
                  className="group flex w-[140px] flex-col items-center gap-3"
                  style={{ animation: `fade-rise 420ms var(--ease-out-soft) ${index * 100}ms both` }}
                  onClick={() => pick(user)}
                  disabled={signing}
                >
                  <span
                    className="relative grid h-[120px] w-[120px] place-items-center overflow-hidden rounded-full border-2 transition-transform duration-200 group-hover:scale-105"
                    style={{
                      borderColor: active ? "#ffffff" : "rgba(255,255,255,0.12)",
                      background: `hsl(${hue} 28% 22%)`,
                    }}
                  >
                    {user.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt=""
                        className="absolute inset-0 z-10 h-full w-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : null}
                    <span className="relative z-0 text-[40px] font-semibold text-white/90">
                      {(user.name[0] || "?").toUpperCase()}
                    </span>
                    {user.hasPassword ? (
                      <span className="absolute right-2 bottom-2 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white">
                        <Lock size={12} />
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[15px] text-muted group-hover:text-white">{user.name}</span>
                </button>
              );
            })}
            <button
              type="button"
              className="group flex w-[140px] flex-col items-center gap-3"
              onClick={() => {
                setSelected(null);
                setUsername("");
                setPassword("");
                setError("");
                setManual(true);
              }}
              disabled={signing}
            >
              <span className="grid h-[120px] w-[120px] place-items-center rounded-full border-2 border-dashed border-white/20 text-muted transition-colors group-hover:border-white/50 group-hover:text-white">
                <UserRoundPlus size={36} />
              </span>
              <span className="text-[15px] text-muted group-hover:text-white">{t("otherUser")}</span>
            </button>
          </div>
        )}
        {showForm && !loading ? (
          <form
            className="mt-10 w-[320px]"
            onSubmit={(e) => {
              e.preventDefault();
              const name = selected?.name || username;
              void signIn(name, password);
            }}
          >
            {manual || !selected ? (
              <>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">
                  {t("username")}
                </label>
                <input
                  autoFocus={!selected}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("usernamePlaceholder")}
                  className="mb-4 h-12 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                />
              </>
            ) : null}
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">
              {t("password")}
            </label>
            <input
              type="password"
              autoFocus={selected != null}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              className="mb-3 h-12 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
            {error ? <p className="mb-3 text-sm text-accent">{error}</p> : <div className="mb-3 h-5" />}
            <button
              type="submit"
              disabled={signing || !(selected?.name || username.trim())}
              className="btn-press flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold hover:bg-accent-hover disabled:opacity-60"
            >
              {signing ? <LoaderCircle size={16} className="animate-spin" /> : null}
              {t("signIn")}
            </button>
          </form>
        ) : error && !loading ? (
          <p className="mt-8 text-sm text-accent">{error}</p>
        ) : null}
        <button
          type="button"
          className="mt-10 inline-flex min-h-10 items-center px-3 text-sm text-dim hover:text-muted"
          onClick={onChangeServer}
        >
          {t("changeServer")}
        </button>
      </div>
    </div>
  );
}
