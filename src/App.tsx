import { useEffect, useRef, useState, type ReactNode } from "react";
import { Welcome } from "./screens/Welcome";
import { Login } from "./screens/Login";
import { Profiles } from "./screens/Profiles";
import { Home } from "./screens/Home";
import { Player } from "./screens/Player";
import { AccountStep } from "./screens/AccountStep";
import { ToastStack } from "./components/Toast";
import { Logo } from "./components/Logo";
import { UpdateModal } from "./components/UpdateModal";
import { UpdateAvailableModal } from "./components/UpdateAvailableModal";
import { ProfileForm } from "./components/ProfileForm";
import { WindowControls } from "./components/WindowControls";
import { LanguageSelect } from "./components/LanguageSelect";
import { SettingsProvider, useSettings } from "./lib/settings-context";
import { UserDataProvider } from "./lib/userdata-context";
import { UpdateProvider, useUpdate } from "./lib/update-context";
import { DownloadsProvider } from "./lib/downloads-context";
import { api } from "./lib/api";
import { useI18n } from "./lib/locale-context";
import { errorText } from "./lib/errors";
import type { AccountStatus, Movie, SavedServer, Session, Toast } from "./lib/types";
import { SetupStep } from "./screens/SetupStep";
import { ReminderAlerts } from "./components/ReminderAlerts";
import { channelToMovie, reminderChannel } from "./lib/iptv";

/** Screens shown while there is no session. */
type Gate = "welcome" | "login" | "profiles" | "create";

/** What stands between a fresh session and Home: the account offer, or its second factor. */
type AccountGate = "checking" | "none" | "intro" | "mfa";

/**
 * First-run setup (torrents, addon import) of a profile that has not been through it.
 * `children` learns whether it is showing, so the screen behind can step out of reach.
 */
function SetupGate({ enabled, children }: { enabled: boolean; children: (showing: boolean) => ReactNode }) {
  const { settings, ready } = useSettings();
  const [closed, setClosed] = useState(false);
  const showing = enabled && ready && !closed && !settings.onboarding.setupDone;
  return (
    <>
      {showing ? <SetupStep onDone={() => setClosed(true)} /> : null}
      {children(showing)}
    </>
  );
}

export default function App() {
  return (
    <UpdateProvider>
      <AppInner />
    </UpdateProvider>
  );
}

function AppInner() {
  const { t } = useI18n();
  const { modalOpen: updateAvailable } = useUpdate();
  const [boot, setBoot] = useState(true);
  const [server, setServer] = useState<SavedServer | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [gate, setGate] = useState<Gate>("welcome");
  const [hasLocal, setHasLocal] = useState(false);
  const [playing, setPlaying] = useState<Movie | null>(null);
  const [homeRefresh, setHomeRefresh] = useState(0);
  // Bumped when the player could not start, so Home can bring the sources sheet back.
  const [playFailed, setPlayFailed] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const [version, setVersion] = useState<string | null>(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  // The ejFlix account is offered once per profile ("not now" is remembered by Rust),
  // and the code of a second factor enrolled elsewhere is asked for when it shows up.
  const [accountGate, setAccountGate] = useState<AccountGate>("checking");
  const mfaLater = useRef(false);

  useEffect(() => {
    if (!session) {
      setAccountGate("none");
      return;
    }
    let alive = true;
    mfaLater.current = false;
    setAccountGate("checking");
    const gateOf = (status: AccountStatus): AccountGate =>
      status.mfaRequired ? "mfa" : !status.signedIn && !status.promptDismissed ? "intro" : "none";
    api
      .accountStatus()
      .then((status) => {
        if (alive) setAccountGate(gateOf(status));
      })
      .catch(() => {
        if (alive) setAccountGate("none");
      });
    const unlisten = api.onAccountChanged((status) => {
      if (!alive) return;
      if (status.mfaRequired) {
        // The sign-in panel handles its own second step; only an idle Home is gated.
        if (!mfaLater.current) setAccountGate((gate) => (gate === "none" || gate === "checking" ? "mfa" : gate));
      } else {
        setAccountGate((gate) => (gate === "mfa" ? "none" : gate));
      }
    });
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, [session?.userId]);

  // The account pulled a server linked on another PC: the session gains it.
  useEffect(() => {
    if (!session) return;
    const unlisten = api.onAccountSynced((report) => {
      if (!report.pulled.includes("servers")) return;
      api
        .sessionCurrent()
        .then((next) => {
          if (!next) return;
          setSession(next);
          void api.savedServer().then(setServer).catch(() => undefined);
          setHomeRefresh((n) => n + 1);
        })
        .catch(() => undefined);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [session?.userId]);

  const dismissToast = (id: number) => setToasts((list) => list.filter((item) => item.id !== id));

  const toast = (message: string, action?: { label: string; run: () => void }) => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((list) => [...list, { id, message, action }]);
    // A toast with an action stays long enough to reach it.
    window.setTimeout(() => dismissToast(id), action ? 7000 : 3200);
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
            <DownloadsProvider onToast={toast}>
              {accountGate === "intro" || accountGate === "mfa" ? (
                <AccountStep
                  mode={accountGate}
                  onDone={(reason) => {
                    if (reason === "later" && accountGate === "mfa") mfaLater.current = true;
                    setAccountGate("none");
                  }}
                  onToast={toast}
                />
              ) : null}
              {/* Home stays mounted while playing so the view and scroll survive the trip. */}
              <SetupGate enabled={accountGate === "none"}>
                {(setupShowing) => (
                  <Home
                    session={session}
                    server={server}
                    version={version}
                    hidden={playing != null || accountGate !== "none" || setupShowing}
                    refreshToken={homeRefresh}
                    playFailed={playFailed}
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
                )}
              </SetupGate>
              {playing ? (
                <Player
                  movie={playing}
                  mode="engine"
                  onExit={stopPlaying}
                  onError={(message) => {
                    toast(message);
                    setPlayFailed((n) => n + 1);
                  }}
                />
              ) : null}
              {/* Programme reminders; the player overlay shows its own while watching. */}
              <ReminderAlerts
                enabled={!playing && accountGate === "none"}
                onWatch={(reminder) => setPlaying(channelToMovie(reminderChannel(reminder), ""))}
              />
            </DownloadsProvider>
          </UserDataProvider>
        </SettingsProvider>
        {updateVersion ? <UpdateModal version={updateVersion} onClose={closeUpdate} /> : null}
        {/* New release on GitHub: never over the "what's new" card nor while watching. */}
        {updateAvailable && !updateVersion && !playing ? <UpdateAvailableModal /> : null}
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
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
          <div className="relative z-10 flex h-[60px] items-center justify-between px-6" data-tauri-drag-region>
            <div data-tauri-drag-region>
              <Logo />
            </div>
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
                      toast(errorText(t, err));
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
      {updateAvailable && !updateVersion ? <UpdateAvailableModal /> : null}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </SettingsProvider>
  );
}
