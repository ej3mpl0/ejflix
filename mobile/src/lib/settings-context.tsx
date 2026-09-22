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
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from "./types";

type SettingsContextValue = {
  settings: Settings;
  /** True once the first `settingsGet` resolved (or failed). */
  ready: boolean;
  /** Optimistic deep-merge → store; rolls back and reports on failure. */
  update: (patch: SettingsPatch) => Promise<void>;
  reload: () => Promise<void>;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function mergePatch(base: Settings, patch: SettingsPatch): Settings {
  return {
    appearance: { ...base.appearance, ...(patch.appearance ?? {}) },
    playback: { ...base.playback, ...(patch.playback ?? {}) },
    library: { ...base.library, ...(patch.library ?? {}) },
    addons: { ...base.addons, ...(patch.addons ?? {}) },
    discord: { ...base.discord, ...(patch.discord ?? {}) },
    iptv: { ...base.iptv, ...(patch.iptv ?? {}) },
    onboarding: { ...base.onboarding, ...(patch.onboarding ?? {}) },
  };
}

/**
 * Loads the active profile's settings and keeps every consumer in sync through
 * `settings://changed`. `userId` only keys the provider (remount per profile); the
 * service resolves the user and answers with the defaults (or the last profile's
 * appearance) before login, so the theme also applies on the auth screens.
 */
export function SettingsProvider({
  userId,
  onError,
  children,
}: {
  userId: string | null;
  onError?: (message: string) => void;
  children: ReactNode;
}) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const update = useCallback(async (patch: SettingsPatch) => {
    const previous = settingsRef.current;
    const optimistic = mergePatch(previous, patch);
    setSettings(optimistic);
    try {
      const saved = await api.settingsSet(patch);
      setSettings(saved);
    } catch (err) {
      setSettings(previous);
      onErrorRef.current?.(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      setSettings(await api.settingsGet());
    } catch {
      /* keep what we have */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .settingsGet()
      .then((loaded) => {
        if (alive) setSettings(loaded);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setReady(true);
      });
    const unlisten = api.onSettingsChanged((next) => {
      if (alive) setSettings(next);
    });
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, [userId]);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, ready, update, reload }),
    [settings, ready, update, reload],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings requires SettingsProvider");
  return ctx;
}
