import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle, Lock, Pencil, Plus, Server, UserRoundPlus, X } from "lucide-react";
import { Logo } from "../components/Logo";
import { WindowControls } from "../components/WindowControls";
import { LanguageSelect } from "../components/LanguageSelect";
import { Avatar } from "../components/Avatar";
import { ProfileForm } from "../components/ProfileForm";
import { PinInput } from "../components/PinInput";
import { api } from "../lib/api";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import type { LocalProfile, PublicUser, SavedServer, Session } from "../lib/types";
import { fieldLgClass } from "../lib/ui";

const MAX_LOCAL = 8;

function avatarHue(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
}

/**
 * Who is watching: local (online) profiles first, then the users of the saved Jellyfin
 * server. Local profiles can be created, edited, PIN-protected and deleted from here.
 */
export function Profiles({
  server,
  onReady,
  onChangeServer,
  onConnectServer,
}: {
  server: SavedServer | null;
  onReady: (session: Session) => void;
  /** Forget the server (Jellyfin users disappear, local profiles stay). */
  onChangeServer: () => void;
  /** Go to the server URL screen. */
  onConnectServer: () => void;
}) {
  const { t } = useI18n();
  const [locals, setLocals] = useState<LocalProfile[]>([]);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PublicUser | null>(null);
  const [manual, setManual] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [signing, setSigning] = useState(false);
  const [editing, setEditing] = useState(false);
  /** Local profile being created (`"new"`) or edited. */
  const [editor, setEditor] = useState<LocalProfile | "new" | null>(null);
  /** Local profile waiting for its PIN. */
  const [locked, setLocked] = useState<LocalProfile | null>(null);
  const [pinError, setPinError] = useState(false);

  const loadLocals = useCallback(async () => {
    try {
      setLocals(await api.localProfilesList());
    } catch {
      setLocals([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const jobs: Promise<unknown>[] = [loadLocals()];
    if (server) {
      jobs.push(
        api
          .listPublicUsers(server.serverUrl)
          .then((list) => {
            if (!cancelled) setUsers(list);
          })
          .catch((err) => {
            if (!cancelled) setError(err instanceof Error ? err.message : String(err));
          }),
      );
    }
    void Promise.allSettled(jobs).then(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [server, loadLocals]);

  const signIn = async (name: string, pw: string) => {
    if (!server) return;
    setError("");
    setSigning(true);
    try {
      onReady(await api.login(server.serverUrl, name.trim(), pw));
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

  const enterLocal = async (profile: LocalProfile, pin?: string) => {
    if (editing) {
      setEditor(profile);
      return;
    }
    if (profile.hasPin && pin == null) {
      setPinError(false);
      setLocked(profile);
      return;
    }
    setSigning(true);
    try {
      onReady(await api.localProfileEnter(profile.id, pin ?? null));
    } catch (err) {
      if (pin != null) {
        setPinError(true);
        window.setTimeout(() => setPinError(false), 600);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSigning(false);
    }
  };

  const showForm = server && (manual || selected != null);
  const canAddLocal = locals.length < MAX_LOCAL;

  const topBar = (
    <div className="relative z-10 flex h-[60px] items-center justify-between px-6" data-tauri-drag-region>
      <div data-tauri-drag-region>
        <Logo />
      </div>
      <div className="flex items-center gap-2">
        <LanguageSelect />
        <WindowControls />
      </div>
    </div>
  );

  // ---- PIN screen ----
  if (locked) {
    return (
      <div className="grain relative flex h-full flex-col bg-base">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_50%_0%,color-mix(in_oklab,var(--color-accent)_12%,transparent),transparent_55%)]" />
        {topBar}
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-16">
          <Avatar src={locked.avatar} name={locked.name} size={96} />
          <h1 className="mt-5 mb-8 text-center text-[28px] font-semibold tracking-tight">
            {t("enterPin", { name: locked.name })}
          </h1>
          <PinInput error={pinError} disabled={signing} onSubmit={(pin) => void enterLocal(locked, pin)} />
          <p className="mt-4 h-5 text-[13px] text-danger">{pinError ? t("wrongPin") : ""}</p>
          <button
            type="button"
            onClick={() => setLocked(null)}
            className="mt-6 inline-flex min-h-10 items-center gap-2 px-3 text-sm text-dim hover:text-muted"
          >
            <ArrowLeft size={15} />
            {t("back")}
          </button>
        </div>
      </div>
    );
  }

  // ---- create / edit local profile ----
  if (editor) {
    const initial = editor === "new" ? null : editor;
    return (
      <div className="grain relative flex h-full flex-col bg-base">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_50%_0%,color-mix(in_oklab,var(--color-accent)_12%,transparent),transparent_55%)]" />
        {topBar}
        <div className="relative z-10 flex flex-1 items-start justify-center overflow-y-auto px-6 py-8">
          <div className="modal-enter w-[460px] max-w-full rounded-card bg-surface p-8 shadow-[0_24px_64px_rgb(0_0_0_/_0.45),0_0_0_1px_rgb(255_255_255_/_0.06)]">
            <h1 className="mb-6 text-[24px] font-semibold tracking-tight">
              {initial ? t("editProfile") : t("newProfile")}
            </h1>
            <ProfileForm
              initial={initial}
              onCancel={() => setEditor(null)}
              onSaved={(profile, pin) => {
                setEditor(null);
                void loadLocals();
                if (!initial) void enterLocal(profile, pin ?? undefined);
              }}
              onDeleted={() => {
                setEditor(null);
                void loadLocals();
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grain relative flex h-full flex-col bg-base">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_50%_0%,color-mix(in_oklab,var(--color-accent)_12%,transparent),transparent_55%)]" />
      {topBar}
      <div className="relative z-10 flex flex-1 flex-col items-center overflow-y-auto px-6 pt-6 pb-16">
        <h1 className="mb-10 text-center text-[36px] font-semibold tracking-tight [text-wrap:balance]">
          {selected ? t("helloName", { name: selected.name }) : t("whoIsWatching")}
        </h1>
        {loading ? (
          <LoaderCircle size={28} className="animate-spin text-muted" />
        ) : (
          <>
            {/* Local profiles */}
            <div className="flex flex-wrap justify-center gap-8">
              {locals.map((profile, index) => (
                <button
                  key={profile.id}
                  type="button"
                  className="group flex w-[140px] flex-col items-center gap-3"
                  style={{ animation: `fade-rise 420ms var(--ease-out-soft) ${index * 80}ms both` }}
                  onClick={() => void enterLocal(profile)}
                  disabled={signing}
                >
                  <span className="relative transition-transform duration-200 group-hover:scale-105">
                    <span
                      className={cn(
                        "block rounded-full border-2 transition-colors",
                        editing ? "border-white/60" : "border-transparent group-hover:border-white",
                      )}
                    >
                      <Avatar src={profile.avatar} name={profile.name} size={116} />
                    </span>
                    {editing ? (
                      <span className="absolute inset-0 grid place-items-center rounded-full bg-black/55 text-white">
                        <Pencil size={26} />
                      </span>
                    ) : profile.hasPin ? (
                      <span className="absolute right-1 bottom-1 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white">
                        <Lock size={12} />
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[15px] text-muted group-hover:text-white">{profile.name}</span>
                </button>
              ))}
              {canAddLocal ? (
                <button
                  type="button"
                  className="group flex w-[140px] flex-col items-center gap-3"
                  style={{ animation: `fade-rise 420ms var(--ease-out-soft) ${locals.length * 80}ms both` }}
                  onClick={() => setEditor("new")}
                  disabled={signing}
                >
                  <span className="grid h-[120px] w-[120px] place-items-center rounded-full border-2 border-dashed border-white/20 text-muted transition-colors group-hover:border-white/50 group-hover:text-white">
                    <Plus size={36} />
                  </span>
                  <span className="text-[15px] text-muted group-hover:text-white">{t("newProfile")}</span>
                </button>
              ) : null}
            </div>

            {/* Jellyfin users */}
            {server ? (
              <>
                <p className="mt-12 mb-6 flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-dim uppercase">
                  <Server size={13} />
                  {t("jellyfinUsers", { server: server.serverName })}
                </p>
                <div className="flex flex-wrap justify-center gap-8">
                  {users.map((user, index) => {
                    const hue = avatarHue(user.name);
                    const active = selected?.id === user.id;
                    return (
                      <button
                        key={user.id}
                        type="button"
                        className="group flex w-[140px] flex-col items-center gap-3"
                        style={{ animation: `fade-rise 420ms var(--ease-out-soft) ${index * 80}ms both` }}
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
              </>
            ) : null}
          </>
        )}

        {showForm && !loading ? (
          <form
            className="modal-enter mt-10 w-[320px]"
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
                  className={cn("mb-4", fieldLgClass)}
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
              className={cn("mb-3", fieldLgClass)}
            />
            {error ? <p className="mb-3 text-sm text-danger">{error}</p> : <div className="mb-3 h-5" />}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={signing || !(selected?.name || username.trim())}
                className="btn-press flex h-12 flex-1 items-center justify-center gap-2 rounded-btn bg-accent text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
              >
                {signing ? <LoaderCircle size={16} className="animate-spin" /> : null}
                {t("signIn")}
              </button>
              <button
                type="button"
                aria-label={t("cancel")}
                onClick={() => {
                  setSelected(null);
                  setManual(false);
                  setError("");
                }}
                className="icon-hit grid h-12 w-12 place-items-center rounded-btn bg-white/8 text-muted hover:text-text"
              >
                <X size={18} />
              </button>
            </div>
          </form>
        ) : error && !loading ? (
          <p className="mt-8 text-sm text-danger">{error}</p>
        ) : null}

        {!loading ? (
          <div className="mt-12 flex flex-wrap items-center justify-center gap-2">
            {locals.length ? (
              <button
                type="button"
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 rounded-pill px-4 text-sm transition-colors",
                  editing ? "bg-white/12 text-text" : "text-dim hover:text-muted",
                )}
                onClick={() => setEditing((v) => !v)}
              >
                <Pencil size={14} />
                {editing ? t("done") : t("editProfiles")}
              </button>
            ) : null}
            {server ? (
              <button
                type="button"
                className="inline-flex min-h-10 items-center px-4 text-sm text-dim hover:text-muted"
                onClick={onChangeServer}
              >
                {t("changeServer")}
              </button>
            ) : (
              <button
                type="button"
                className="inline-flex min-h-10 items-center gap-2 px-4 text-sm text-dim hover:text-muted"
                onClick={onConnectServer}
              >
                <Server size={14} />
                {t("connectServer")}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
