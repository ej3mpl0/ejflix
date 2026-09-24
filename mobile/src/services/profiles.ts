/**
 * Local ("online") profiles, ported from `profiles.rs` and the `local_profile_*`
 * commands of `lib.rs`. The list lives at `KEYS.localProfiles`; PINs in SecureStore.
 */
import type { LocalProfile, ProfilePatch, Session } from "../lib/types";
import { KEYS, SECRET, secrets, store } from "./store";
import { nowMs, uuid } from "./util";
import {
  MAX_PROFILES,
  cleanAvatar,
  cleanName,
  cleanPin,
  profileView,
  type StoredLocalProfile,
} from "./profiles.pure";
import * as session from "./session";
import { checkCreate, checkDelete } from "./parental";

type DeleteHook = (profileId: string) => Promise<void> | void;
const deleteHooks = new Set<DeleteHook>();

/** Extra cleanup when a profile is deleted (IPTV files, databases…). */
export function registerProfileDeleteHook(fn: DeleteHook): () => void {
  deleteHooks.add(fn);
  return () => {
    deleteHooks.delete(fn);
  };
}

function view(profile: StoredLocalProfile): LocalProfile {
  return profileView(profile, session.hasLinkedSession(profile.id));
}

function find(id: string): StoredLocalProfile {
  const profile = session.readLocalProfiles().find((p) => p.id === id);
  if (!profile) throw new Error("Perfil no encontrado");
  return profile;
}

export async function localProfilesList(): Promise<LocalProfile[]> {
  return session.readLocalProfiles().map(view);
}

/** True when `pin` is the profile's PIN (or it has none). */
async function pinMatches(profile: StoredLocalProfile, pin: string | null | undefined): Promise<boolean> {
  if (!profile.hasPin) return true;
  const stored = await secrets.get(SECRET.pin(profile.id));
  return pin != null && stored != null && stored === pin;
}

/** Checks a profile's PIN without opening it (editing it from the profile picker). */
export async function localProfileCheckPin(id: string, pin: string): Promise<void> {
  if (!(await pinMatches(find(id), pin))) throw new Error("PIN incorrecto");
}

/** `parentalPin` is asked for while a profile has a parental restriction. */
export async function localProfileCreate(
  name: string,
  avatar: string,
  pin: string | null,
  parentalPin?: string | null,
): Promise<LocalProfile> {
  await checkCreate(parentalPin);
  const profiles = session.readLocalProfiles();
  if (profiles.length >= MAX_PROFILES) throw new Error(`Máximo ${MAX_PROFILES} perfiles`);
  const cleanedPin = cleanPin(pin);
  const profile: StoredLocalProfile = {
    id: uuid(),
    name: cleanName(name),
    avatar: cleanAvatar(avatar),
    hasPin: cleanedPin != null,
    createdMs: nowMs(),
  };
  if (cleanedPin) await secrets.set(SECRET.pin(profile.id), cleanedPin);
  profiles.push(profile);
  session.writeLocalProfiles(profiles);
  return view(profile);
}

export async function localProfileUpdate(id: string, patch: ProfilePatch): Promise<LocalProfile> {
  const profiles = session.readLocalProfiles();
  const profile = profiles.find((p) => p.id === id);
  if (!profile) throw new Error("Perfil no encontrado");
  // Changing or removing the PIN of a profile that is not open takes that PIN.
  const pinChange = patch.clearPin || patch.pin != null;
  if (pinChange && session.activeLocalProfileId() !== id && !(await pinMatches(profile, patch.currentPin))) {
    throw new Error("PIN incorrecto");
  }
  if (patch.name != null) profile.name = cleanName(patch.name);
  if (patch.avatar != null) profile.avatar = cleanAvatar(patch.avatar);
  if (patch.clearPin) {
    await secrets.remove(SECRET.pin(id));
    profile.hasPin = false;
  } else if (patch.pin != null) {
    const cleaned = cleanPin(patch.pin);
    if (cleaned) {
      await secrets.set(SECRET.pin(id), cleaned);
      profile.hasPin = true;
    } else {
      await secrets.remove(SECRET.pin(id));
      profile.hasPin = false;
    }
  }
  session.writeLocalProfiles(profiles);
  if (session.activeLocalProfileId() === id) session.setActiveLocalProfile({ ...profile });
  return view(profile);
}

/** Removes the profile with its settings, addon progress, IPTV data and linked session. */
export async function localProfileDelete(
  id: string,
  pin?: string | null,
  parentalPin?: string | null,
): Promise<void> {
  const profile = session.readLocalProfiles().find((p) => p.id === id);
  if (profile && session.activeLocalProfileId() !== id && !(await pinMatches(profile, pin))) {
    throw new Error("PIN incorrecto");
  }
  await checkDelete(id, parentalPin);
  if (session.activeLocalProfileId() === id) {
    await session.clearSessionCaches();
    session.setActiveLocalProfile(null);
    session.setJellyfinSession(null);
  }
  session.writeLocalProfiles(session.readLocalProfiles().filter((p) => p.id !== id));
  await session.clearLinkedSession(id);
  await secrets.remove(SECRET.pin(id));
  store.remove(KEYS.settings(id));
  store.remove(KEYS.addonProgress(id));
  store.remove(KEYS.iptv(id));
  store.remove(KEYS.iptvFavorites(id));
  store.remove(KEYS.iptvRecent(id));
  for (const hook of Array.from(deleteHooks)) {
    try {
      await hook(id);
    } catch (error) {
      console.warn("[profiles] delete hook failed", error);
    }
  }
  if (store.get<string>(KEYS.activeLocalProfile) === id) store.remove(KEYS.activeLocalProfile);
}

/** Opens a local profile (after checking its PIN) and restores its linked Jellyfin account. */
export async function localProfileEnter(id: string, pin: string | null): Promise<Session> {
  const profile = find(id);
  if (profile.hasPin) {
    const stored = await secrets.get(SECRET.pin(id));
    if (pin == null || stored == null || stored !== pin) throw new Error("PIN incorrecto");
  }
  await session.clearSessionCaches();
  session.setJellyfinSession(null);
  session.setActiveLocalProfile(profile);
  await session.restoreLinkedSession(profile.id);
  const account = session.accountView();
  if (!account) throw new Error("No hay sesión activa");
  return account;
}
