import { store } from "../services/store";

const KEY = "searchHistory";
const MAX = 10;

export function loadSearchHistory(userId: string): string[] {
  const list = store.get<unknown>(`${KEY}.${userId}`);
  return Array.isArray(list) ? list.filter((q): q is string => typeof q === "string") : [];
}

function save(userId: string, list: string[]) {
  store.set(`${KEY}.${userId}`, list);
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
