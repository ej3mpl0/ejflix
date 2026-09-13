const KEY = "ejflix.libraries";

/**
 * Pinned library ids saved by ejFlix ≤ 0.1.13 in localStorage. Read once by the settings
 * migration; the source of truth is now `settings.library.pinned` (Rust store).
 */
export function readLegacyPinned(userId: string): string[] | null {
  try {
    const raw = localStorage.getItem(`${KEY}.${userId}`);
    if (!raw) return null;
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
}

export function clearLegacyPinned(userId: string) {
  try {
    localStorage.removeItem(`${KEY}.${userId}`);
  } catch {
    /* storage unavailable */
  }
}
