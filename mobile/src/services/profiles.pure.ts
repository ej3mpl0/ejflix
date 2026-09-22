/**
 * Validation for local ("online") profiles, ported from `profiles.rs`.
 * Pure module (vitest-friendly).
 */
import type { LocalProfile } from "../lib/types";

export const MAX_PROFILES = 8;
export const MAX_NAME = 40;
export const MAX_AVATAR_BYTES = 400 * 1024;
export const PRESET_COUNT = 12;

/** Record kept in the store (`localProfiles`); the PIN lives in SecureStore. */
export type StoredLocalProfile = {
  id: string;
  name: string;
  /** `preset:<n>` or a `data:image/…;base64,…` picture. */
  avatar: string;
  hasPin: boolean;
  createdMs: number;
};

/** Trimmed, at most 40 characters; throws when empty. */
export function cleanName(name: string): string {
  const cleaned = Array.from(name.trim()).slice(0, MAX_NAME).join("");
  if (!cleaned) throw new Error("Escribe un nombre para el perfil");
  return cleaned;
}

/**
 * `preset:<n>` with n < 12 (anything else preset-ish becomes `preset:0`), or a JPEG /
 * PNG / WebP data URL of at most 400 KiB made of printable ASCII.
 */
export function cleanAvatar(avatar: string): string {
  const value = avatar.trim();
  if (value.startsWith("preset:")) {
    const n = value.slice("preset:".length);
    return /^\d{1,9}$/.test(n) && Number.parseInt(n, 10) < PRESET_COUNT ? value : "preset:0";
  }
  const okPrefix =
    value.startsWith("data:image/jpeg;base64,") ||
    value.startsWith("data:image/png;base64,") ||
    value.startsWith("data:image/webp;base64,");
  if (!okPrefix) throw new Error("Imagen de perfil no válida");
  if (value.length > MAX_AVATAR_BYTES) throw new Error("La foto es demasiado grande");
  if (!/^[\x21-\x7e]*$/.test(value)) throw new Error("Imagen de perfil no válida");
  return value;
}

/** Exactly 4 ASCII digits; empty / null means "no PIN". */
export function cleanPin(pin: string | null | undefined): string | null {
  const value = pin?.trim() ?? "";
  if (!value) return null;
  if (!/^[0-9]{4}$/.test(value)) throw new Error("El PIN debe tener 4 dígitos");
  return value;
}

/** What the frontend sees. */
export function profileView(profile: StoredLocalProfile, linked: boolean): LocalProfile {
  return { id: profile.id, name: profile.name, avatar: profile.avatar, hasPin: profile.hasPin, linked };
}

/** Coerces whatever the store holds into a clean list (drops broken entries). */
export function parseStoredProfiles(value: unknown): StoredLocalProfile[] {
  if (!Array.isArray(value)) return [];
  const out: StoredLocalProfile[] = [];
  for (const raw of value) {
    if (raw == null || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    if (typeof p.id !== "string" || !p.id || typeof p.name !== "string") continue;
    out.push({
      id: p.id,
      name: p.name,
      avatar: typeof p.avatar === "string" && p.avatar ? p.avatar : "preset:0",
      hasPin: p.hasPin === true,
      createdMs: typeof p.createdMs === "number" ? p.createdMs : 0,
    });
  }
  return out;
}
