const KEY = "ejflix.search.history";
const MAX = 10;

export function loadSearchHistory(userId: string): string[] {
  try {
    const raw = localStorage.getItem(`${KEY}.${userId}`);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((q): q is string => typeof q === "string") : [];
  } catch {
    return [];
  }
}

function save(userId: string, list: string[]) {
  try {
    localStorage.setItem(`${KEY}.${userId}`, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

/** Puts `query` first (deduplicated, case-insensitive) and returns the new list. */
export function pushSearchHistory(userId: string, query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return loadSearchHistory(userId);
  const rest = loadSearchHistory(userId).filter((q) => q.toLowerCase() !== trimmed.toLowerCase());
  const next = [trimmed, ...rest].slice(0, MAX);
  save(userId, next);
  return next;
}

export function removeSearchHistory(userId: string, query: string): string[] {
  const next = loadSearchHistory(userId).filter((q) => q !== query);
  save(userId, next);
  return next;
}

export function clearSearchHistory(userId: string): string[] {
  save(userId, []);
  return [];
}
