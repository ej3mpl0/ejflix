const KEY = "ejflix.libraries";

/** Ids of the Jellyfin libraries the user pinned to the header, per profile. */
export function loadAddedLibraries(userId: string): string[] {
  try {
    const raw = localStorage.getItem(`${KEY}.${userId}`);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function saveAddedLibraries(userId: string, ids: string[]) {
  try {
    localStorage.setItem(`${KEY}.${userId}`, JSON.stringify(ids));
  } catch {
    /* storage unavailable */
  }
}
