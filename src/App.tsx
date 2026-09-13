import { useEffect, useState } from "react";
import { Welcome } from "./screens/Welcome";
import { Login } from "./screens/Login";
import { Profiles } from "./screens/Profiles";
import { Home } from "./screens/Home";
import { Player } from "./screens/Player";
import { ToastStack } from "./components/Toast";
import { Logo } from "./components/Logo";
import { UpdateModal } from "./components/UpdateModal";
import { ProfileForm } from "./components/ProfileForm";
import { WindowControls } from "./components/WindowControls";
import { LanguageSelect } from "./components/LanguageSelect";
import { SettingsProvider } from "./lib/settings-context";
import { UserDataProvider } from "./lib/userdata-context";
import { api } from "./lib/api";
import { useI18n } from "./lib/locale-context";
import type { Movie, SavedServer, Session, Toast } from "./lib/types";

/** Screens shown while there is no session. */
type Gate = "welcome" | "login" | "profiles" | "create";

export default function App() {
  const { t } = useI18n();
  const [boot, setBoot] = useState(true);
  const [server, setServer] = useState<SavedServer | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [gate, setGate] = useState<Gate>("welcome");
  const [hasLocal, setHasLocal] = useState(false);
  const [playing, setPlaying] = useState<Movie | null>(null);
  const [homeRefresh, setHomeRefresh] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [version, setVersion] = useState<string | null>(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  const toast = (message: string) => {
    const id = Date.now();
    setToasts((list) => [...list, { id, message }]);
    window.setTimeout(() => {
      setToasts((list) => list.filter((item) => item.id !== id));
    }, 3200);
  };

  const stopPlaying = () => {
    setPlaying(null);
    // Continue-watching progress changed: refresh Home in the background.
    setHomeRefresh((n) => n + 1);
  };

  useEffect(() => {
    document.body.classList.add("opaque");
    // The overlay decides what Escape means (close menu, leave fullscreen, exit)
    // and emits player://exit when the player should close.
    const exit = api.onPlayerExit(stopPlaying);
    // Next episode chosen from the overlay: swap the item, the player keeps its window state.
    const next = api.onPlayerNext(setPlaying);
    Promise.all([
      api.sessionRestore().catch(() => null),
      api.savedServer().catch(() => null),
      api.localProfilesList().catch(() => []),
      api.updateInfo().catch(() => null),
    ])
      .then(([restored, saved, locals, info]) => {
        setSession(restored);
        setServer(saved);
        setHasLocal(locals.length > 0);
        // Something to pick from → profiles; a fresh install → welcome.
        setGate(saved || locals.length ? "profiles" : "welcome");
        if (info) setVersion(info.current);
        if (info?.showNotes) setUpdateVersion(info.current);
      })
      .finally(() => setBoot(false));
    return () => {
      void exit.then((fn) => fn());
      void next.then((fn) => fn());
    };
  }, []);

  const closeUpdate = () => {
    setUpdateVersion(null);
    void api.dismissUpdate();
  };

  const switchProfile = async () => {
    await api.logout();
    setPlaying(null);
    setSession(null);
    setGate("profiles");
  };

  const logoutServer = async () => {
    await api.logoutServer();
    setPlaying(null);
    setSession(null);
    setServer(null);
    const locals = await api.localProfilesList().catch(() => []);
    setHasLocal(locals.length > 0);
    setGate(locals.length ? "profiles" : "welcome");
  };

  if (boot) {
    return (
      <div className="grid h-full place-items-center bg-base">
        <Logo size="login" />
      </div>
    );
  }

  if (session) {
    return (
      <>
        <SettingsProvider key={session.userId} userId={session.userId} migrate onError={toast}>
          <UserDataProvider onError={toast}>
            {/* Home stays mounted while playing so the view and scroll survive the trip. */}
            <Home
              session={session}
              server={server}
              version={version}
              hidden={playing != null}
              refreshToken={homeRefresh}
              onPlay={setPlaying}
              onToast={toast}
              onSessionChange={(next) => {
                setSession(next);
                void api.savedServer().then(setServer).catch(() => undefined);
                setHomeRefresh((n) => n + 1);
              }}
              onSwitchProfile={() => void switchProfile()}
              onLogout={() => void logoutServer()}
            />
            {playing ? <Player movie={playing} mode="engine" onExit={stopPlaying} onError={toast} /> : null}
          </UserDataProvider>
        </SettingsProvider>
        {updateVersion ? <UpdateModal version={updateVersion} onClose={closeUpdate} /> : null}
        <ToastStack toasts={toasts} />
      </>
    );
  }

  const backFromLogin = server || hasLocal ? "profiles" : "welcome";

  return (
    <SettingsProvider userId={null}>
      {gate === "welcome" ? (
        <Welcome onServer={() => setGate("login")} onOnline={() => setGate("create")} />
      ) : gate === "login" ? (
        <Login
          onConnected={(next) => {
            setServer(next);
            setGate("profiles");
          }}
          onBack={() => setGate(backFromLogin)}
        />
      ) : gate === "create" ? (
        <div className="grain relative flex h-full flex-col bg-base">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_50%_0%,color-mix(in_oklab,var(--color-accent)_12%,transparent),transparent_55%)]" />
          <div className="relative z-10 flex h-[60px] items-center justify-between px-6">
            <Logo />
            <div className="flex items-center gap-2">
              <LanguageSelect />
              <WindowControls />
            </div>
          </div>
          <div className="relative z-10 flex flex-1 items-start justify-center overflow-y-auto px-6 py-8">
            <div className="modal-enter w-[460px] max-w-full rounded-card bg-surface p-8 shadow-[0_24px_64px_rgb(0_0_0_/_0.45),0_0_0_1px_rgb(255_255_255_/_0.06)]">
              <h1 className="mb-1 text-[24px] font-semibold tracking-tight">{t("newProfile")}</h1>
              <p className="mb-6 text-[13px] text-dim">{t("optionOnlineHint")}</p>
              <ProfileForm
                onCancel={() => setGate(backFromLogin)}
                onSaved={(profile, pin) => {
                  setHasLocal(true);
                  api
                    .localProfileEnter(profile.id, pin)
                    .then(setSession)
                    .catch((err) => {
                      toast(err instanceof Error ? err.message : String(err));
                      setGate("profiles");
                    });
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        <Profiles
          server={server}
          onReady={setSession}
          onChangeServer={() => void logoutServer()}
          onConnectServer={() => setGate("login")}
        />
      )}
      {updateVersion ? <UpdateModal version={updateVersion} onClose={closeUpdate} /> : null}
      <ToastStack toasts={toasts} />
    </SettingsProvider>
  );
}
