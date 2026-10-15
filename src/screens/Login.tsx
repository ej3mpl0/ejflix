import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, LoaderCircle, UserPlus } from "lucide-react";
import { api } from "../lib/api";
import { useI18n } from "../lib/locale-context";
import { errorText } from "../lib/errors";
import type { PublicInfo, PublicUser, SavedServer, Session } from "../lib/types";
import { fieldLgClass } from "../lib/ui";
import { cn } from "../lib/format";
import { Avatar } from "../components/Avatar";
import { Pill } from "../components/Pill";
import { OnboardingFrame, StepHeading } from "../components/onboarding/OnboardingFrame";
import { ServerVisual } from "../components/onboarding/Visuals";

/** How long typing has to pause before the address is tried. */
const CHECK_DELAY_MS = 600;

/**
 * Connect a Jellyfin server. The address is tried while it is typed (no "test" button);
 * once the server answers, its users show up as circles and signing in happens right here.
 * A server that hides its users asks for the name instead.
 */
export function Login({
  onConnected,
  onSignedIn,
  onBack,
}: {
  /** The server is saved; the caller picks who signs in (the profiles screen). */
  onConnected: (server: SavedServer) => void;
  /** Signed in from here: straight into the app. */
  onSignedIn?: (session: Session) => void;
  /** Return to the previous screen (welcome or profiles). */
  onBack?: () => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState("http://localhost:8096");
  const [found, setFound] = useState<PublicInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [manual, setManual] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const urlRef = useRef(url);
  urlRef.current = url;

  // Try the address once typing pauses; a newer address wins over an older answer.
  useEffect(() => {
    const tried = url.trim();
    setFound(null);
    setUsers([]);
    setUser(null);
    setError("");
    if (!/^https?:\/\/[^/\s]+/i.test(tried)) return;
    setChecking(true);
    const handle = window.setTimeout(() => {
      api
        .testServer(tried)
        .then(async (info) => {
          if (urlRef.current.trim() !== tried) return;
          setFound(info);
          const list = await api.listPublicUsers(tried).catch(() => [] as PublicUser[]);
          if (urlRef.current.trim() !== tried) return;
          setUsers(list);
          setManual(list.length === 0);
        })
        .catch((err) => {
          if (urlRef.current.trim() === tried) setError(errorText(t, err));
        })
        .finally(() => {
          if (urlRef.current.trim() === tried) setChecking(false);
        });
    }, CHECK_DELAY_MS);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const name = manual ? username.trim() : user?.name ?? "";
  const needsPassword = manual || (user?.hasPassword ?? true);

  const signIn = async () => {
    if (!found) return;
    setBusy(true);
    setError("");
    try {
      // Saving the server first is what the profiles screen expects too.
      await api.probeServer(url);
      if (name && onSignedIn) {
        onSignedIn(await api.login(url.trim().replace(/\/+$/, ""), name, needsPassword ? password : ""));
        return;
      }
      const saved = await api.savedServer();
      onConnected(saved ?? { serverUrl: url.trim().replace(/\/+$/, ""), serverName: found.serverName });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingFrame
      step={2}
      visual={<ServerVisual found={found ? { name: found.serverName, version: found.version } : null} users={users.length} />}
      footer={
        <>
          {onBack ? (
            <Pill variant="tonal" size="lg" className="mr-auto" icon={<ArrowLeft size={17} />} onClick={onBack}>
              {t("back")}
            </Pill>
          ) : null}
          <Pill
            variant="primary"
            size="lg"
            type="submit"
            form="server-form"
            disabled={!found || busy || (onSignedIn != null && !name)}
            icon={busy ? <LoaderCircle size={17} className="animate-spin" /> : undefined}
          >
            {onSignedIn ? t("signInAction") : t("connect")}
          </Pill>
        </>
      }
    >
      <form
        id="server-form"
        className="max-w-[460px]"
        onSubmit={(e) => {
          e.preventDefault();
          void signIn();
        }}
      >
        <StepHeading title={t("connectServerTitle")} />
        <label className="mb-2 block text-[13.5px] font-semibold text-muted" htmlFor="server-url">
          {t("serverAddress")}
        </label>
        <input
          id="server-url"
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://192.168.1.10:8096"
          spellCheck={false}
          className={fieldLgClass}
        />
        <p className="mt-2.5 flex min-h-5 items-center gap-2 text-[13.5px]" role="status">
          {error ? (
            <span className="text-danger">{error}</span>
          ) : found ? (
            <>
              <span className="grid h-5 w-5 place-items-center rounded-full bg-text text-base">
                <Check size={13} strokeWidth={3} />
              </span>
              {t("serverFound", { name: found.serverName, version: found.version })}
            </>
          ) : checking ? (
            <span className="flex items-center gap-2 text-muted">
              <LoaderCircle size={14} className="animate-spin" />
              {t("serverChecking")}
            </span>
          ) : null}
        </p>

        {found && onSignedIn ? (
          <div className="mt-6">
            <p className="mb-3 text-[13.5px] font-semibold text-muted">{t("whoAreYou")}</p>
            {users.length ? (
              <div className="mb-5 flex flex-wrap gap-5" role="radiogroup" aria-label={t("whoAreYou")}>
                {users.map((u) => {
                  const on = !manual && user?.id === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        setManual(false);
                        setUser(u);
                        setPassword("");
                      }}
                      className="group flex w-16 flex-col items-center gap-2"
                    >
                      <span
                        className={cn(
                          "rounded-full ring-offset-[3px] ring-offset-base transition-[box-shadow,filter] duration-150",
                          on ? "ring-2 ring-text" : "brightness-75 group-hover:brightness-100",
                        )}
                      >
                        <Avatar src={u.avatarUrl} name={u.name} size={64} />
                      </span>
                      <span className={cn("max-w-full truncate text-[14px] font-semibold", on ? "text-text" : "text-muted")}>
                        {u.name}
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  role="radio"
                  aria-checked={manual}
                  onClick={() => {
                    setManual(true);
                    setUser(null);
                  }}
                  className="group flex w-16 flex-col items-center gap-2"
                >
                  <span
                    className={cn(
                      "grid h-16 w-16 place-items-center rounded-full border-2 border-dashed text-muted transition-colors",
                      manual ? "border-text text-text" : "border-line group-hover:border-white/40",
                    )}
                  >
                    <UserPlus size={22} />
                  </span>
                  <span className={cn("text-[14px] font-semibold", manual ? "text-text" : "text-muted")}>{t("otherUser")}</span>
                </button>
              </div>
            ) : null}
            {manual ? (
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("usernamePlaceholder")}
                aria-label={t("username")}
                autoComplete="username"
                className={cn(fieldLgClass, "mb-3")}
              />
            ) : null}
            {name && needsPassword ? (
              <>
                <label className="mb-2 block text-[13.5px] font-semibold text-muted" htmlFor="server-password">
                  {manual ? t("password") : t("passwordOf", { name })}
                </label>
                <input
                  id="server-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("passwordPlaceholder")}
                  autoComplete="current-password"
                  autoFocus={!manual}
                  className={fieldLgClass}
                />
              </>
            ) : null}
          </div>
        ) : null}
      </form>
    </OnboardingFrame>
  );
}
