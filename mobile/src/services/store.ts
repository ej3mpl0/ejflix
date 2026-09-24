import { Storage } from "expo-sqlite/kv-store";
import * as SecureStore from "expo-secure-store";
import { Directory, File, Paths } from "expo-file-system";

/**
 * Plain app store (same keys as the desktop `session.json`), backed by the synchronous
 * SQLite key-value store. Values are JSON. Secrets never go here: see `secrets`.
 */
export const store = {
  get<T>(key: string): T | undefined {
    try {
      const raw = Storage.getItemSync(key);
      if (raw == null) return undefined;
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  },
  set(key: string, value: unknown): void {
    Storage.setItemSync(key, JSON.stringify(value));
  },
  remove(key: string): void {
    Storage.removeItemSync(key);
  },
  keys(): string[] {
    return Storage.getAllKeysSync();
  },
};

/** Android Keystore-backed secrets (tokens, PINs, IPTV passwords). Keys use `[A-Za-z0-9._-]`. */
export const secrets = {
  async get(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      /* already gone */
    }
  },
};

export const KEYS = {
  data: "data",
  localSession: (profileId: string) => `localSession.${profileId}`,
  serverUrl: "serverUrl",
  serverName: "serverName",
  deviceId: "deviceId",
  profiles: "profiles",
  localProfiles: "localProfiles",
  activeLocalProfile: "activeLocalProfile",
  settings: (userId: string) => `settings.${userId}`,
  settingsLastUser: "settingsLastUser",
  addonProgress: (userId: string) => `addonProgress.${userId}`,
  addonLibrary: (userId: string) => `addonLibrary.${userId}`,
  preferredSource: "preferredSource",
  iptv: (userId: string) => `iptv.${userId}`,
  iptvFavorites: (userId: string) => `iptvFavorites.${userId}`,
  iptvRecent: (userId: string) => `iptvRecent.${userId}`,
  iptvReminders: (userId: string) => `iptvReminders.${userId}`,
  locale: "locale",
  lastSeenVersion: "lastSeenVersion",
  updateAuto: "updateAuto",
  updateSkipped: "updateSkipped",
  downloads: (owner: string) => `downloads.${owner}`,
} as const;

export const SECRET = {
  jfToken: (slot: "main" | `local.${string}`) => `jf.token.${slot}`,
  pin: (profileId: string) => `pin.${profileId}`,
  iptvPassword: (sourceId: string) => `iptv.pw.${sourceId}`,
} as const;

function ensureDir(dir: Directory): Directory {
  try {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  } catch {
    /* exists */
  }
  return dir;
}

/** On-disk locations for large blobs. */
export const PATHS = {
  iptvDir: () => ensureDir(new Directory(Paths.document, "iptv")),
  iptvCatalog: (sourceId: string) => new File(PATHS.iptvDir(), `${sourceId}.json`),
  iptvImported: (sourceId: string) => new File(PATHS.iptvDir(), `${sourceId}.m3u`),
  iptvDownload: (sourceId: string, kind: "m3u" | "epg") =>
    new File(PATHS.iptvDir(), `${sourceId}.${kind}.download`),
  updateDir: () => ensureDir(new Directory(Paths.cache, "ejflix-update")),
};

/** Writes a text file atomically (tmp + move). */
export function writeTextAtomic(target: File, text: string): void {
  const tmp = new File(target.parentDirectory, `${target.name}.part`);
  try {
    if (tmp.exists) tmp.delete();
  } catch {
    /* ignore */
  }
  tmp.create({ intermediates: true, overwrite: true });
  tmp.write(text);
  try {
    if (target.exists) target.delete();
  } catch {
    /* ignore */
  }
  tmp.move(target);
}

export function readTextIfExists(file: File): string | null {
  try {
    return file.exists ? file.textSync() : null;
  } catch {
    return null;
  }
}

export function deleteIfExists(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    /* ignore */
  }
}
