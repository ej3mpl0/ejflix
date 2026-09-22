import {
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
import { applyTheme } from "./theme";
import { readLegacyPinned, clearLegacyPinned } from "./libraries";

type SettingsContextValue = {
  settings: Settings;
  /** True once the first `settings_get` resolved (or failed). */
  ready: boolean;
  /** Optimistic deep-merge → Rust; rolls back and reports on failure. */
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
    torrents: { ...base.torrents, ...(patch.torrents ?? {}) },
    onboarding: { ...base.onboarding, ...(patch.onboarding ?? {}) },
  };
}

const LEGACY_REMAINING_KEY = "ejflix.timeRemaining";

/**
 * Loads the active profile's settings from Rust and keeps every window in sync through
 * `settings://changed`. `userId` only keys the provider (remount per profile) and enables
 * the one-time migration of the old localStorage preferences; Rust resolves the user.
 */
export function SettingsProvider({
  userId,
  migrate = false,
  onError,
  children,
}: {
  userId: string | null;
  migrate?: boolean;
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
        if (!alive) return;
        setSettings(loaded);
        if (migrate && userId) {
          const patch: SettingsPatch = {};
          const pinned = readLegacyPinned(userId);
          if (pinned && pinned.length && !loaded.library.pinned.length) patch.library = { pinned };
          let remaining: string | null = null;
          try {
            remaining = localStorage.getItem(LEGACY_REMAINING_KEY);
          } catch {
            remaining = null;
          }
          if (remaining != null) patch.playback = { showTimeRemaining: remaining === "1" };
          if (patch.library || patch.playback) {
            void update(patch).then(() => {
              clearLegacyPinned(userId);
              try {
                localStorage.removeItem(LEGACY_REMAINING_KEY);
              } catch {
                /* ignore */
              }
            });
          }
        }
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
  }, [userId, migrate, update]);

  useEffect(() => {
    applyTheme({
      theme: settings.appearance.theme,
      amoled: settings.appearance.amoled,
      posterSize: settings.appearance.posterSize,
    });
  }, [settings.appearance.theme, settings.appearance.amoled, settings.appearance.posterSize]);

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
