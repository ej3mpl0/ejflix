import * as Crypto from "expo-crypto";
import * as Application from "expo-application";

export const CLIENT_NAME = "ejFlix";
export const CLIENT_VERSION = Application.nativeApplicationVersion ?? "0.4.0";

export function nowMs(): number {
  return Date.now();
}

export function uuid(): string {
  return Crypto.randomUUID();
}

/** Jellyfin item ids: 8 to 64 alphanumerics or dashes. */
export function validItemId(id: string | null | undefined): id is string {
  return typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(id);
}

/** Percent-encoding for query values (matches the Rust helper). */
export function urlencodingLite(value: string): string {
  return encodeURIComponent(value);
}

export function ticksFromSeconds(seconds: number): number {
  return Math.max(0, Math.round(seconds * 10_000_000));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

let seed: number | null = null;
/** Per-launch random offset (hero rotation), stable within the process. */
export function launchSeed(): number {
  if (seed == null) seed = Math.floor(Math.random() * 1_000_000);
  return seed;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs `fn` with at most `limit` concurrent executions, preserving the order of results. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
