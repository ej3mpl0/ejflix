import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import type { UpdateCheck, UpdatePrefs, UpdateProgress } from "./types";

export type UpdatePhase = "idle" | "checking" | "downloading" | "installing";

type UpdateContextValue = {
  /** Last answer from GitHub (null until a check ran). */
  check: UpdateCheck | null;
  prefs: UpdatePrefs;
  phase: UpdatePhase;
  progress: UpdateProgress | null;
  /** Error of the last check ("" when none). */
  checkError: string;
  /** Error of the last download/install ("" when none). */
  installError: string;
  /** The "new version" dialog wants to be shown. */
  modalOpen: boolean;
  checkNow: () => Promise<UpdateCheck | null>;
  /** Download the installer and hand over to it (the app exits). */
  downloadAndInstall: () => Promise<void>;
  skipVersion: () => Promise<void>;
  later: () => void;
  openModal: () => void;
  setAuto: (auto: boolean) => Promise<void>;
  openRelease: () => void;
};

const UpdateContext = createContext<UpdateContextValue | null>(null);

const DEFAULT_PREFS: UpdatePrefs = { auto: true, skipped: null };
/** Wait a bit after boot so the check never competes with the first screens. */
const LAUNCH_DELAY_MS = 4000;

/**
 * App-level update state: one automatic check after boot (if enabled), manual checks
 * from Settings, download progress and the hand-off to the installer.
 */
export function UpdateProvider({ children }: { children: ReactNode }) {
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [prefs, setPrefs] = useState<UpdatePrefs>(DEFAULT_PREFS);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [checkError, setCheckError] = useState("");
  const [installError, setInstallError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const busy = useRef(false);

  const runCheck = useCallback(async (force: boolean) => {
    if (busy.current) return null;
    busy.current = true;
    setPhase("checking");
    setCheckError("");
    try {
      const next = await api.updateCheck(force);
      setCheck(next);
      return next;
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      busy.current = false;
      setPhase("idle");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    api
      .updatePrefs()
      .then((loaded) => {
        if (!alive) return;
        setPrefs(loaded);
        if (!loaded.auto) return;
        timer = window.setTimeout(() => {
          void runCheck(false).then((result) => {
            if (alive && result?.available && !result.skipped) setModalOpen(true);
          });
        }, LAUNCH_DELAY_MS);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [runCheck]);

  const checkNow = useCallback(async () => {
    const result = await runCheck(true);
    if (result?.available) setModalOpen(true);
    return result;
  }, [runCheck]);

  const downloadAndInstall = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setInstallError("");
    setProgress({ received: 0, total: check?.assetSize ?? 0 });
    setPhase("downloading");
    const unlisten = await api.onUpdateProgress(setProgress);
    try {
      const file = await api.updateDownload();
      setPhase("installing");
      await api.updateInstall(file.path);
      // The app exits right after this; if it does not, let the user retry.
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
      setProgress(null);
    } finally {
      unlisten();
      busy.current = false;
    }
  }, [check?.assetSize]);

  const skipVersion = useCallback(async () => {
    if (!check) return;
    setModalOpen(false);
    try {
      setPrefs(await api.updateSkip(check.latest));
      setCheck({ ...check, skipped: true });
    } catch {
      // Not fatal: the dialog simply comes back next launch.
    }
  }, [check]);

  const setAuto = useCallback(async (auto: boolean) => {
    setPrefs((p) => ({ ...p, auto }));
    try {
      setPrefs(await api.updateSetAuto(auto));
    } catch {
      setPrefs((p) => ({ ...p, auto: !auto }));
    }
  }, []);

  const openRelease = useCallback(() => {
    void api.openExternal(check?.url ?? "https://github.com/ej3mpl0/ejflix/releases").catch(() => undefined);
  }, [check?.url]);

  const value = useMemo<UpdateContextValue>(
    () => ({
      check,
      prefs,
      phase,
      progress,
      checkError,
      installError,
      modalOpen,
      checkNow,
      downloadAndInstall,
      skipVersion,
      later: () => setModalOpen(false),
      openModal: () => setModalOpen(true),
      setAuto,
      openRelease,
    }),
    [check, prefs, phase, progress, checkError, installError, modalOpen, checkNow, downloadAndInstall, skipVersion, setAuto, openRelease],
  );

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useUpdate(): UpdateContextValue {
  const ctx = useContext(UpdateContext);
  if (!ctx) throw new Error("useUpdate requires UpdateProvider");
  return ctx;
}

/** "36,4 MB" style size for buttons. */
export function formatBytes(bytes: number, locale: string): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024).toLocaleString(locale)} KB`;
  return `${bytes} B`;
}
