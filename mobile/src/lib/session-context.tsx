import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import type { LocalProfile, SavedServer, Session } from "./types";

/** Screens shown while there is no session (desktop `App.tsx` gate). */
export type Gate = "welcome" | "login" | "profiles" | "create";

type SessionContextValue = {
  /** True until the restore finished. */
  boot: boolean;
  session: Session | null;
  server: SavedServer | null;
  /** Installed app version (from `updateInfo`). */
  version: string | null;
  /** Version whose "what's new" card wants to be shown (null when none). */
  notesVersion: string | null;
  gate: Gate;
  setGate: (gate: Gate) => void;
  /** Local profiles known at the last refresh. */
  locals: LocalProfile[];
  hasLocal: boolean;
  setSession: (session: Session | null) => void;
  setServer: (server: SavedServer | null) => void;
  /** Reloads the local profiles (after create / edit / delete). */
  refreshLocals: () => Promise<LocalProfile[]>;
  /** Refreshes the saved server (after link / unlink). */
  refreshServer: () => Promise<void>;
  /** Back to "who is watching" keeping the server. */
  switchProfile: () => Promise<void>;
  /** Forgets the server; Jellyfin users disappear, local profiles stay. */
  logoutServer: () => Promise<void>;
  /** Alias of `switchProfile` (desktop naming). */
  logout: () => Promise<void>;
  /** Hides the "what's new" card. */
  dismissNotes: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Boot + gate state machine ported from the desktop `App.tsx`: restores the session,
 * the saved server and the local profiles, then decides which auth screen opens.
 */
export function SessionProvider({ onBooted, children }: { onBooted?: () => void; children: ReactNode }) {
  const [boot, setBoot] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [server, setServer] = useState<SavedServer | null>(null);
  const [locals, setLocals] = useState<LocalProfile[]>([]);
  const [gate, setGate] = useState<Gate>("welcome");
  const [version, setVersion] = useState<string | null>(null);
  const [notesVersion, setNotesVersion] = useState<string | null>(null);
  const onBootedRef = useRef(onBooted);
  onBootedRef.current = onBooted;

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.sessionRestore().catch(() => null),
      api.savedServer().catch(() => null),
      api.localProfilesList().catch(() => [] as LocalProfile[]),
      api.updateInfo().catch(() => null),
    ])
      .then(([restored, saved, list, info]) => {
        if (!alive) return;
        setSession(restored);
        setServer(saved);
        setLocals(list);
        // Something to pick from → profiles; a fresh install → welcome.
        setGate(saved || list.length ? "profiles" : "welcome");
        if (info) setVersion(info.current);
        if (info?.showNotes) setNotesVersion(info.current);
      })
      .finally(() => {
        if (!alive) return;
        setBoot(false);
        onBootedRef.current?.();
      });
    return () => {
      alive = false;
    };
  }, []);

  const refreshLocals = useCallback(async () => {
    const list = await api.localProfilesList().catch(() => [] as LocalProfile[]);
    setLocals(list);
    return list;
  }, []);

  const refreshServer = useCallback(async () => {
    const saved = await api.savedServer().catch(() => null);
    setServer(saved);
  }, []);

  const switchProfile = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setSession(null);
    setGate("profiles");
  }, []);

  const logoutServer = useCallback(async () => {
    await api.logoutServer().catch(() => undefined);
    setSession(null);
    setServer(null);
    const list = await api.localProfilesList().catch(() => [] as LocalProfile[]);
    setLocals(list);
    setGate(list.length ? "profiles" : "welcome");
  }, []);

  const dismissNotes = useCallback(() => {
    setNotesVersion(null);
    void api.dismissUpdate().catch(() => undefined);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      boot,
      session,
      server,
      version,
      notesVersion,
      gate,
      setGate,
      locals,
      hasLocal: locals.length > 0,
      setSession,
      setServer,
      refreshLocals,
      refreshServer,
      switchProfile,
      logoutServer,
      logout: switchProfile,
      dismissNotes,
    }),
    [boot, session, server, version, notesVersion, gate, locals, refreshLocals, refreshServer, switchProfile, logoutServer, dismissNotes],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession requires SessionProvider");
  return ctx;
}
