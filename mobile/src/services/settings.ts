/**
 * Per-profile settings stored under `settings.<userId>` (ported from `settings.rs` and
 * the `settings_*` commands of `lib.rs`). Validation lives in `settings.pure.ts`.
 */
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from "../lib/types";
import { emit } from "./events";
import { KEYS, store } from "./store";
import { mergeSettings, sanitize } from "./settings.pure";
import { activeLocalProfileId, currentSession } from "./session";

/** User whose settings were saved most recently (keeps the theme on the login screens). */
export function lastUser(): string | null {
  const id = store.get<string>(KEYS.settingsLastUser);
  return typeof id === "string" && id ? id : null;
}

/** Active local profile > Jellyfin user > last user that saved settings. */
export function settingsUser(): string | null {
  return activeLocalProfileId() ?? currentSession()?.userId ?? lastUser();
}

export function getSettingsFor(userId: string): Settings {
  const stored = store.get<unknown>(KEYS.settings(userId));
  return stored === undefined ? sanitize(DEFAULT_SETTINGS) : sanitize(stored);
}

/** Deep-merges `patch` into the stored object, validates and saves. Returns the result. */
export function mergeAndSave(userId: string, patch: unknown): Settings {
  const saved = mergeSettings(store.get<unknown>(KEYS.settings(userId)), patch);
  store.set(KEYS.settings(userId), saved);
  store.set(KEYS.settingsLastUser, userId);
  return saved;
}

export async function settingsGet(): Promise<Settings> {
  const uid = settingsUser();
  return uid ? getSettingsFor(uid) : sanitize(DEFAULT_SETTINGS);
}

export async function settingsSet(patch: SettingsPatch): Promise<Settings> {
  const uid = settingsUser();
  if (!uid) throw new Error("No hay sesión activa");
  const saved = mergeAndSave(uid, patch);
  emit("settings://changed", saved);
  return saved;
}
