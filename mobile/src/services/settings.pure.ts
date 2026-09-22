/**
 * Settings validation, ported from `settings.rs` (`sanitized`, `lang_or_empty`,
 * `deep_merge`) and `addons.rs::normalize_manifest_url`. Pure module (vitest-friendly).
 */
import {
  DEFAULT_SETTINGS,
  THEME_IDS,
  type Countdown,
  type DiscordHeader,
  type PosterSize,
  type Settings,
  type SkipMode,
  type SubBackground,
  type ThemeId,
} from "../lib/types";

export const COUNTDOWNS: readonly Countdown[] = [0, 5, 10, 15];
export const MAX_PATCH_BYTES = 32 * 1024;
const MAX_PINNED = 24;
const MAX_ADDON_URLS = 30;

type Json = Record<string, unknown>;

export function isPlainObject(value: unknown): value is Json {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Same rule as `jellyfin.rs::valid_item_id` (8 to 64 alphanumerics or dashes). */
function validItemId(id: string): boolean {
  const trimmed = id.trim();
  return /^[A-Za-z0-9-]{8,64}$/.test(trimmed);
}

/** Two or three lowercase ASCII letters, or "off" when allowed; anything else is "". */
export function langOrEmpty(code: unknown, allowOff: boolean): string {
  if (typeof code !== "string") return "";
  const value = code.trim().toLowerCase();
  if (allowOff && value === "off") return value;
  return /^[a-z]{2,3}$/.test(value) ? value : "";
}

/**
 * Stremio manifest URL: `stremio://` becomes `https://`, only http(s), no trailing
 * slash, `/manifest.json` appended when missing. Throws the Rust messages.
 */
export function normalizeManifestUrl(raw: string): string {
  let url = raw.trim();
  if (!url || url.length > 2048) throw new Error("URL de addon no válida");
  if (url.startsWith("stremio://")) url = `https://${url.slice("stremio://".length)}`;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("La URL del addon debe empezar por http:// o https://");
  }
  url = url.replace(/\/+$/, "");
  if (!url.endsWith("/manifest.json")) url += "/manifest.json";
  return url;
}

function takeChars(value: unknown, max: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return Array.from(value).slice(0, max).join("");
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((item) => (seen.has(item) ? false : (seen.add(item), true)));
}

/**
 * Coerces anything (a stored object, a hand-edited file, `undefined`) into a complete,
 * valid `Settings`. Unknown keys are dropped; bad values fall back to their default.
 */
export function sanitize(value: unknown): Settings {
  const root = isPlainObject(value) ? value : {};
  const d = DEFAULT_SETTINGS;
  const appearance = isPlainObject(root.appearance) ? root.appearance : {};
  const playback = isPlainObject(root.playback) ? root.playback : {};
  const library = isPlainObject(root.library) ? root.library : {};
  const addons = isPlainObject(root.addons) ? root.addons : {};
  const discord = isPlainObject(root.discord) ? root.discord : {};
  const iptv = isPlainObject(root.iptv) ? root.iptv : {};
  // A stored object from before the setup step has no `onboarding` key: that profile
  // already exists, so it never gets the step. Nothing stored at all means a new profile.
  const onboarding = isPlainObject(root.onboarding) ? root.onboarding : null;
  const setupDone = onboarding ? boolOr(onboarding.setupDone, false) : Object.keys(root).length > 0;
  const scaleRaw = playback.subScale;
  const subScale =
    typeof scaleRaw === "number" && Number.isFinite(scaleRaw) ? Math.min(2.5, Math.max(0.5, scaleRaw)) : 1;
  const subColor =
    typeof playback.subColor === "string" && /^#[0-9a-fA-F]{6}$/.test(playback.subColor) ? playback.subColor : "#FFFFFF";
  const seekStep =
    typeof playback.seekStep === "number" && [5, 10, 15, 30].includes(playback.seekStep) ? playback.seekStep : 10;

  const countdownRaw = playback.nextEpisodeCountdown;
  const countdown: Countdown =
    typeof countdownRaw === "number" && (COUNTDOWNS as readonly number[]).includes(countdownRaw)
      ? (countdownRaw as Countdown)
      : 5;
  const speedRaw = playback.lastSpeed;
  const lastSpeed =
    typeof speedRaw === "number" && Number.isFinite(speedRaw) ? Math.min(4, Math.max(0.25, speedRaw)) : 1;

  const urls: string[] = [];
  for (const raw of stringList(addons.urls)) {
    try {
      urls.push(normalizeManifestUrl(raw));
    } catch {
      /* dropped, like `filter_map(.. .ok())` */
    }
  }

  const clientId = takeChars(discord.clientId, Number.MAX_SAFE_INTEGER, "")
    .trim()
    .replace(/[^0-9]/g, "")
    .slice(0, 32);

  return {
    appearance: {
      theme: oneOf<ThemeId>(appearance.theme, THEME_IDS, "crimson"),
      amoled: boolOr(appearance.amoled, d.appearance.amoled),
      posterSize: oneOf<PosterSize>(appearance.posterSize, ["small", "large"], "medium"),
    },
    playback: {
      skipIntro: oneOf<SkipMode>(playback.skipIntro, ["auto", "off"], "ask"),
      skipRecap: oneOf<SkipMode>(playback.skipRecap, ["auto", "off"], "ask"),
      skipOutro: oneOf<SkipMode>(playback.skipOutro, ["auto", "off"], "ask"),
      nextEpisodeCountdown: countdown,
      audioLanguage: langOrEmpty(playback.audioLanguage, false),
      subtitleLanguage: langOrEmpty(playback.subtitleLanguage, true),
      rememberSpeed: boolOr(playback.rememberSpeed, d.playback.rememberSpeed),
      lastSpeed,
      showTimeRemaining: boolOr(playback.showTimeRemaining, d.playback.showTimeRemaining),
      subScale,
      subColor,
      subBackground: oneOf<SubBackground>(playback.subBackground, ["shadow", "box"], "outline"),
      seekStep,
    },
    library: {
      pinned: dedupe(stringList(library.pinned).filter(validItemId)).slice(0, MAX_PINNED),
    },
    addons: {
      urls: dedupe(urls).slice(0, MAX_ADDON_URLS),
      cinemeta: boolOr(addons.cinemeta, d.addons.cinemeta),
    },
    discord: {
      enabled: boolOr(discord.enabled, d.discord.enabled),
      clientId,
      details: takeChars(discord.details, 128, d.discord.details),
      state: takeChars(discord.state, 128, d.discord.state),
      showPoster: boolOr(discord.showPoster, d.discord.showPoster),
      showTime: boolOr(discord.showTime, d.discord.showTime),
      showPaused: boolOr(discord.showPaused, d.discord.showPaused),
      header: oneOf<DiscordHeader>(discord.header, ["name", "details", "state"], "details"),
    },
    iptv: {
      autoRefresh: boolOr(iptv.autoRefresh, d.iptv.autoRefresh),
      epg: boolOr(iptv.epg, d.iptv.epg),
      wheelZap: boolOr(iptv.wheelZap, d.iptv.wheelZap),
    },
    onboarding: { setupDone },
  };
}

/**
 * `settings.rs::deep_merge`: objects merge key by key, anything else is replaced.
 * Mutates and returns `target` when both sides are objects; otherwise returns `patch`.
 */
export function deepMerge(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(target) || !isPlainObject(patch)) return patch;
  for (const [key, value] of Object.entries(patch)) {
    const existing = target[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      deepMerge(existing, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

/** UTF-8 byte length (the Rust code measures `patch.to_string().len()`). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Throws the Rust validation errors for a settings patch. */
export function validatePatch(patch: unknown): asserts patch is Json {
  if (!isPlainObject(patch)) throw new Error("Ajustes no válidos");
  if (utf8Length(JSON.stringify(patch)) > MAX_PATCH_BYTES) throw new Error("Ajustes demasiado grandes");
}

/** Pure form of `merge_and_save`: the stored value merged with the patch, sanitized. */
export function mergeSettings(current: unknown, patch: unknown): Settings {
  validatePatch(patch);
  const base: unknown = isPlainObject(current) ? JSON.parse(JSON.stringify(current)) : {};
  return sanitize(deepMerge(base, patch));
}
