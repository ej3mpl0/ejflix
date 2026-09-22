/** Version parsing and release asset selection (port of `src-tauri/src/update.rs`). */

export const REPO = "ej3mpl0/ejflix";
export const RELEASES_URL = "https://github.com/ej3mpl0/ejflix/releases";
export const CACHE_TTL_MS = 30 * 60 * 1000;

export type VersionParts = [number, number, number];

/** Parses `v0.3.1`, `0.3.1`, `ejFlix 0.3.1` or `0.3.1-beta.2` into numeric parts. */
export function parseVersion(raw: string): VersionParts | null {
  const start = raw.search(/[0-9]/);
  if (start < 0) return null;
  const core = raw.slice(start).split(/[-+\s]/)[0] ?? "";
  const parts = core.split(".").map((p) => {
    const digits = p.match(/^[0-9]*/)?.[0] ?? "";
    return digits === "" ? null : Number(digits);
  });
  const major = parts[0];
  if (major == null) return null;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return [major, minor, patch];
}

export function formatVersion(parts: VersionParts): string {
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

/** `latest` is strictly newer than `current`. Unparseable input never reports an update. */
export function isNewer(latest: string, current: string): boolean {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  if (!l || !c) return false;
  for (let i = 0; i < 3; i++) {
    if (l[i] !== c[i]) return l[i] > c[i];
  }
  return false;
}

export type ReleaseAsset = { name: string; url: string; size: number };

/**
 * The package for this platform among the release assets: `.apk` files on Android
 * (`.ipa` on iOS), never x86 builds, preferring arm64, then universal, then anything else.
 */
export function pickAsset(assets: unknown[], extension: ".apk" | ".ipa" = ".apk"): ReleaseAsset | null {
  const candidates: ReleaseAsset[] = [];
  for (const a of assets) {
    if (typeof a !== "object" || a === null) continue;
    const obj = a as Record<string, unknown>;
    if (typeof obj.name !== "string" || typeof obj.browser_download_url !== "string") continue;
    const lower = obj.name.toLowerCase();
    if (!lower.endsWith(extension) || lower.includes("x86")) continue;
    const size = typeof obj.size === "number" && Number.isFinite(obj.size) && obj.size > 0 ? Math.trunc(obj.size) : 0;
    candidates.push({ name: obj.name, url: obj.browser_download_url, size });
  }
  const rank = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes("arm64")) return 0;
    if (lower.includes("universal")) return 1;
    return 2;
  };
  candidates.sort((a, b) => rank(a.name) - rank(b.name));
  return candidates[0] ?? null;
}

/** Keeps only the file name characters the desktop allows (the name comes from the network). */
export function safeAssetName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "");
  return safe === "" ? "ejFlix.apk" : safe;
}

export function allowedDownloadUrl(url: string): boolean {
  return url.startsWith("https://github.com/") || url.startsWith("https://objects.githubusercontent.com/");
}
