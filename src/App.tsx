import { useEffect, useState } from "react";
import { Login } from "./screens/Login";
import { Profiles } from "./screens/Profiles";
import { Home } from "./screens/Home";
import { Player } from "./screens/Player";
import { ToastStack } from "./components/Toast";
import { Logo } from "./components/Logo";
import { UpdateModal } from "./components/UpdateModal";
import { api } from "./lib/api";
import type { Movie, SavedServer, Session, Toast } from "./lib/types";

export default function App() {
  const [boot, setBoot] = useState(true);
  const [server, setServer] = useState<SavedServer | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [playing, setPlaying] = useState<Movie | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  const toast = (message: string) => {
    const id = Date.now();
    setToasts((list) => [...list, { id, message }]);
    window.setTimeout(() => {
      setToasts((list) => list.filter((item) => item.id !== id));
    }, 3200);
  };

  useEffect(() => {
    document.body.classList.add("opaque");
    const exit = api.onPlayerExit(() => setPlaying(null));
    const hotkey = api.onPlayerHotkey((key) => {
      if (key === "escape") setPlaying(null);
    });
    Promise.all([
      api.sessionRestore().catch(() => null),
      api.savedServer().catch(() => null),
      api.updateInfo().catch(() => null),
    ])
      .then(([restored, saved, info]) => {
        setSession(restored);
        setServer(saved);
        if (info?.showNotes) setUpdateVersion(info.current);
      })
      .finally(() => setBoot(false));
    return () => {
      void exit.then((fn) => fn());
      void hotkey.then((fn) => fn());
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
  };

  const logoutServer = async () => {
    await api.logoutServer();
    setPlaying(null);
    setSession(null);
    setServer(null);
  };

  if (boot) {
    return (
      <div className="grid h-full place-items-center bg-base">
        <Logo size="login" />
      </div>
    );
  }

  return (
    <>
      {!session && !server ? (
        <Login
          onConnected={(next) => {
            setServer(next);
          }}
        />
      ) : !session && server ? (
        <Profiles
          server={server}
          onReady={setSession}
          onChangeServer={() => void logoutServer()}
        />
      ) : playing && session ? (
        <Player movie={playing} mode="engine" onExit={() => setPlaying(null)} onError={toast} />
      ) : session ? (
        <Home
          session={session}
          onPlay={setPlaying}
          onToast={toast}
          onSwitchProfile={() => void switchProfile()}
          onLogout={() => void logoutServer()}
        />
      ) : null}
      {updateVersion ? <UpdateModal version={updateVersion} onClose={closeUpdate} /> : null}
      <ToastStack toasts={toasts} />
    </>
  );
}
