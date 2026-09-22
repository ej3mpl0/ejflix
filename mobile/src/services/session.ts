/**
 * Accounts: the Jellyfin session, the active local profile and the saved server.
 * Ported from the session commands of `lib.rs` (probe_server, login, session_restore,
 * logout, link_server…). Storage layout:
 *  - session record `{v:3, serverUrl, userId, userName, deviceId, avatarUrl}` at
 *    `KEYS.data` (Jellyfin mode) or `KEYS.localSession(profileId)` (linked profile);
 *  - the token in SecureStore at `SECRET.jfToken("main")` / `SECRET.jfToken("local.<id>")`.
 * Both halves must exist for a session to restore.
 */
import { Platform } from "react-native";
import * as Device from "expo-device";
import type { PublicInfo, PublicUser, SavedServer, Session } from "../lib/types";
import { fetchWithTimeout, shortError } from "./http";
import { KEYS, SECRET, secrets, store } from "./store";
import { uuid } from "./util";
import { configureImages } from "./jellyfin/images";
import {
  authHeaders,
  jellyfin,
  normalizeUrl,
  publicUserImageUrl,
  setDeviceName,
  type JellyfinSession,
} from "./jellyfin/client";
import { parseStoredProfiles, type StoredLocalProfile } from "./profiles.pure";

const OS_NAME = Platform.OS === "ios" ? "iOS" : "Android";
setDeviceName(Device.modelName ? `${OS_NAME} (${Device.modelName})` : OS_NAME);

type StoredSession = {
  v: 3;
  serverUrl: string;
  userId: string;
  userName: string;
  deviceId: string;
  avatarUrl: string | null;
};

type TokenSlot = "main" | `local.${string}`;

// ---- in-memory state ----

let localProfile: StoredLocalProfile | null = null;

type Cleanup = () => void | Promise<void>;
const cleanups = new Set<Cleanup>();
type ChangeHook = (session: JellyfinSession | null) => void;
const changeHooks = new Set<ChangeHook>();

/**
 * Registers a cache/playback cleanup run on logout, server logout, profile switch and
 * unlink (what the Rust code did with `player.stop()`, `segments.clear()`, `iptv.clear()`).
 */
export function registerSessionCleanup(fn: Cleanup): () => void {
  cleanups.add(fn);
  return () => {
    cleanups.delete(fn);
  };
}

export async function clearSessionCaches(): Promise<void> {
  for (const fn of Array.from(cleanups)) {
    try {
      await fn();
    } catch (error) {
      console.warn("[session] cleanup failed", error);
    }
  }
}

/** Called after every change of the Jellyfin session (images are reconfigured first). */
export function onSessionChange(fn: ChangeHook): () => void {
  changeHooks.add(fn);
  return () => {
    changeHooks.delete(fn);
  };
}

export function setJellyfinSession(session: JellyfinSession | null): void {
  jellyfin.session = session;
  configureImages({ serverUrl: session?.serverUrl ?? null, token: session?.token ?? null });
  for (const hook of Array.from(changeHooks)) {
    try {
      hook(session);
    } catch (error) {
      console.warn("[session] change hook threw", error);
    }
  }
}

/** Server + token + user + device of the Jellyfin account in use, if any. */
export function currentSession(): JellyfinSession | null {
  return jellyfin.session;
}

export function activeLocalProfileId(): string | null {
  return localProfile?.id ?? null;
}

export function activeLocalProfile(): StoredLocalProfile | null {
  return localProfile;
}

export function hasServer(): boolean {
  return jellyfin.session != null;
}

// ---- store helpers ----

function slotFor(key: string): TokenSlot {
  return key === KEYS.data ? "main" : `local.${key.slice(KEYS.localSession("").length)}`;
}

async function saveSessionAt(key: string, session: JellyfinSession): Promise<void> {
  const record: StoredSession = {
    v: 3,
    serverUrl: session.serverUrl,
    userId: session.userId,
    userName: session.userName,
    deviceId: session.deviceId,
    avatarUrl: session.avatarUrl,
  };
  await secrets.set(SECRET.jfToken(slotFor(key)), session.token);
  store.set(key, record);
}

async function loadSessionAt(key: string): Promise<JellyfinSession | null> {
  const record = store.get<Partial<StoredSession>>(key);
  if (!record || typeof record !== "object") return null;
  const token = await secrets.get(SECRET.jfToken(slotFor(key)));
  if (
    !token ||
    typeof record.serverUrl !== "string" ||
    typeof record.userId !== "string" ||
    typeof record.deviceId !== "string" ||
    !record.serverUrl ||
    !record.userId
  ) {
    return null;
  }
  return {
    serverUrl: record.serverUrl,
    token,
    userId: record.userId,
    userName: typeof record.userName === "string" ? record.userName : "",
    deviceId: record.deviceId || uuid(),
    avatarUrl: typeof record.avatarUrl === "string" ? record.avatarUrl : null,
  };
}

async function clearSessionAt(key: string): Promise<void> {
  store.remove(key);
  await secrets.remove(SECRET.jfToken(slotFor(key)));
}

/** True when a Jellyfin account record is stored for the profile (the `linked` flag). */
export function hasLinkedSession(profileId: string): boolean {
  return store.get(KEYS.localSession(profileId)) != null;
}

export async function clearLinkedSession(profileId: string): Promise<void> {
  await clearSessionAt(KEYS.localSession(profileId));
}

function saveServer(url: string, name: string): void {
  store.set(KEYS.serverUrl, url);
  if (name) store.set(KEYS.serverName, name);
}

function loadServer(): SavedServer | null {
  const url = store.get<string>(KEYS.serverUrl);
  if (typeof url !== "string" || !url) return null;
  const name = store.get<string>(KEYS.serverName);
  return { serverUrl: url, serverName: typeof name === "string" && name ? name : "Jellyfin" };
}

function clearServer(): void {
  store.remove(KEYS.serverUrl);
  store.remove(KEYS.serverName);
}

function loadPublicProfiles(): PublicUser[] {
  const list = store.get<PublicUser[]>(KEYS.profiles);
  return Array.isArray(list) ? list.filter((u) => u && typeof u.id === "string") : [];
}

function upsertProfile(profile: PublicUser): void {
  const list = loadPublicProfiles();
  const index = list.findIndex((item) => item.id === profile.id);
  if (index >= 0) list[index] = profile;
  else list.push(profile);
  store.set(KEYS.profiles, list);
}

function mergeProfiles(saved: PublicUser[], publicUsers: PublicUser[]): PublicUser[] {
  const merged = [...saved];
  for (const user of publicUsers) {
    const existing = merged.find((item) => item.id === user.id);
    if (existing) {
      if (user.avatarUrl != null) existing.avatarUrl = user.avatarUrl;
      existing.name = user.name;
      existing.hasPassword = user.hasPassword;
    } else {
      merged.push(user);
    }
  }
  return merged;
}

function loadDeviceId(): string | null {
  const id = store.get<string>(KEYS.deviceId);
  return typeof id === "string" && id ? id : null;
}

async function existingDeviceId(): Promise<string> {
  const stored = loadDeviceId();
  if (stored) return stored;
  const main = store.get<Partial<StoredSession>>(KEYS.data);
  if (main && typeof main.deviceId === "string" && main.deviceId) return main.deviceId;
  return uuid();
}

function saveDeviceId(id: string): void {
  store.set(KEYS.deviceId, id);
}

/** Local profiles as stored (`localProfiles`); used by `profiles.ts` too. */
export function readLocalProfiles(): StoredLocalProfile[] {
  return parseStoredProfiles(store.get(KEYS.localProfiles));
}

export function writeLocalProfiles(list: StoredLocalProfile[]): void {
  store.set(KEYS.localProfiles, list);
}

function storedActiveProfileId(): string | null {
  const id = store.get<string>(KEYS.activeLocalProfile);
  return typeof id === "string" && id ? id : null;
}

/** Makes `profile` the active local profile (restored on the next launch), or none. */
export function setActiveLocalProfile(profile: StoredLocalProfile | null): void {
  localProfile = profile;
  if (profile) store.set(KEYS.activeLocalProfile, profile.id);
  else store.remove(KEYS.activeLocalProfile);
}

// ---- views ----

/** `lib.rs::account_view`. */
export function accountView(): Session | null {
  const jf = jellyfin.session;
  const serverName = loadServer()?.serverName ?? null;
  if (localProfile) {
    return {
      mode: "local",
      userId: localProfile.id,
      userName: localProfile.name,
      avatarUrl: localProfile.avatar,
      deviceId: jf?.deviceId ?? "",
      serverUrl: jf?.serverUrl ?? null,
      serverName: jf ? serverName : null,
      jellyfinUserName: jf?.userName ?? null,
    };
  }
  if (!jf) return null;
  return {
    mode: "jellyfin",
    userId: jf.userId,
    userName: jf.userName,
    avatarUrl: jf.avatarUrl,
    deviceId: jf.deviceId,
    serverUrl: jf.serverUrl,
    serverName,
    jellyfinUserName: null,
  };
}

function requireView(): Session {
  const view = accountView();
  if (!view) throw new Error("No hay sesión activa");
  return view;
}

// ---- server calls without a session ----

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function textOf(source: Json | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" ? value : null;
}

async function probeRaw(serverUrl: string): Promise<PublicInfo> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${serverUrl}/System/Info/Public`, { headers: { Accept: "application/json" } });
  } catch (error) {
    throw new Error(`No se puede conectar a Jellyfin: ${shortError(error)}`);
  }
  if (!response.ok) throw new Error(`El servidor respondió ${response.status}`);
  let value: Json | null;
  try {
    value = asObject(await response.json());
  } catch (error) {
    throw new Error(`Respuesta inválida: ${shortError(error)}`);
  }
  return {
    serverName: textOf(value, "ServerName") ?? "Jellyfin",
    version: textOf(value, "Version") ?? "?",
    id: textOf(value, "Id") ?? "",
  };
}

function mapPublicUser(user: Json, serverUrl: string): PublicUser | null {
  const id = textOf(user, "Id");
  const name = textOf(user, "Name");
  if (!id || !name) return null;
  const hasPassword =
    typeof user.HasPassword === "boolean"
      ? user.HasPassword
      : typeof user.HasConfiguredPassword === "boolean"
        ? user.HasConfiguredPassword
        : true;
  const tag = textOf(user, "PrimaryImageTag");
  return { id, name, hasPassword, avatarUrl: publicUserImageUrl(serverUrl, id, tag || null) };
}

async function publicUsersRaw(url: string): Promise<PublicUser[]> {
  const serverUrl = normalizeUrl(url);
  let response: Response;
  try {
    response = await fetchWithTimeout(`${serverUrl}/Users/Public`, { headers: { Accept: "application/json" } });
  } catch (error) {
    throw new Error(`No se pueden leer los perfiles: ${shortError(error)}`);
  }
  if (!response.ok) throw new Error(`El servidor respondió ${response.status}`);
  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    throw new Error(`Respuesta inválida: ${shortError(error)}`);
  }
  const root = asObject(value);
  const users = Array.isArray(value)
    ? value
    : Array.isArray(root?.Items)
      ? root.Items
      : Array.isArray(root?.Users)
        ? root.Users
        : null;
  if (!users) return [];
  const out: PublicUser[] = [];
  for (const raw of users) {
    const user = asObject(raw);
    const mapped = user ? mapPublicUser(user, serverUrl) : null;
    if (mapped) out.push(mapped);
  }
  return out;
}

/** `POST /Users/AuthenticateByName`; the resulting session is not installed yet. */
async function loginRaw(url: string, username: string, password: string, deviceId: string): Promise<JellyfinSession> {
  const serverUrl = normalizeUrl(url);
  let response: Response;
  try {
    response = await fetchWithTimeout(`${serverUrl}/Users/AuthenticateByName`, {
      method: "POST",
      headers: { ...authHeaders(deviceId, null), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ Username: username, Pw: password }),
    });
  } catch (error) {
    throw new Error(`No se puede conectar: ${shortError(error)}`);
  }
  if (!response.ok) throw new Error("Usuario o contraseña incorrectos");
  let value: Json | null;
  try {
    value = asObject(await response.json());
  } catch (error) {
    throw new Error(`Respuesta inválida: ${shortError(error)}`);
  }
  const token = textOf(value, "AccessToken");
  if (!token) throw new Error("El servidor no devolvió token");
  const user = asObject(value?.User);
  if (!user) throw new Error("El servidor no devolvió usuario");
  const userId = textOf(user, "Id");
  if (!userId) throw new Error("Falta el id de usuario");
  const tag = textOf(user, "PrimaryImageTag");
  return {
    serverUrl,
    token,
    userId,
    userName: textOf(user, "Name") ?? username,
    deviceId,
    avatarUrl: publicUserImageUrl(serverUrl, userId, tag || null),
  };
}

/**
 * `GET /Users/{id}` with the session installed. Resolves to the refreshed session;
 * rejects with `{ expired: true }` when the server refuses the token. Network errors and
 * server hiccups (5xx) keep the stored session usable offline instead of dropping it.
 */
async function validate(session: JellyfinSession): Promise<{ session: JellyfinSession; expired: boolean }> {
  setJellyfinSession(session);
  let response: Response;
  try {
    response = await jellyfin.getResponse(`/Users/${session.userId}`);
  } catch {
    return { session, expired: false };
  }
  if (response.status === 401 || response.status === 403) return { session, expired: true };
  if (!response.ok) return { session, expired: false };
  let value: Json | null = null;
  try {
    value = asObject(await response.json());
  } catch {
    /* keep what we had */
  }
  const refreshed: JellyfinSession = {
    ...session,
    userName: textOf(value, "Name") ?? session.userName,
    avatarUrl: value ? publicUserImageUrl(session.serverUrl, session.userId, textOf(value, "PrimaryImageTag") || null) : session.avatarUrl,
  };
  setJellyfinSession(refreshed);
  return { session: refreshed, expired: false };
}

// ---- public API (same names as the desktop commands) ----

export async function probeServer(url: string): Promise<PublicInfo> {
  const serverUrl = normalizeUrl(url);
  const info = await probeRaw(serverUrl);
  saveServer(serverUrl, info.serverName);
  return info;
}

export async function login(url: string, username: string, password: string): Promise<Session> {
  const deviceId = await existingDeviceId();
  const session = await loginRaw(url, username, password, deviceId);
  localProfile = null;
  store.remove(KEYS.activeLocalProfile);
  await saveSessionAt(KEYS.data, session);
  saveServer(session.serverUrl, "");
  saveDeviceId(session.deviceId);
  upsertProfile({
    id: session.userId,
    name: session.userName,
    hasPassword: password.length > 0,
    avatarUrl: session.avatarUrl,
  });
  setJellyfinSession(session);
  return requireView();
}

/** Puts the Jellyfin account linked to a local profile back in memory, dropping the link when rejected. */
export async function restoreLinkedSession(profileId: string): Promise<void> {
  const key = KEYS.localSession(profileId);
  const stored = await loadSessionAt(key);
  if (!stored) return;
  const { session, expired } = await validate(stored);
  if (expired) {
    setJellyfinSession(null);
    await clearSessionAt(key);
    return;
  }
  await saveSessionAt(key, session);
  saveServer(session.serverUrl, "");
}

export async function sessionRestore(): Promise<Session | null> {
  const activeId = storedActiveProfileId();
  if (activeId) {
    const profile = readLocalProfiles().find((p) => p.id === activeId);
    if (profile) {
      localProfile = profile;
      await restoreLinkedSession(profile.id);
      return accountView();
    }
    store.remove(KEYS.activeLocalProfile);
  }
  const stored = await loadSessionAt(KEYS.data);
  if (!stored) return null;
  const { session, expired } = await validate(stored);
  if (expired) {
    await clearSessionAt(KEYS.data);
    setJellyfinSession(null);
    return null;
  }
  await saveSessionAt(KEYS.data, session);
  saveServer(session.serverUrl, "");
  saveDeviceId(session.deviceId);
  upsertProfile({ id: session.userId, name: session.userName, hasPassword: true, avatarUrl: session.avatarUrl });
  return accountView();
}

export async function savedServer(): Promise<SavedServer | null> {
  return loadServer();
}

/** Saved users of the server merged with the public ones (a failing server yields the saved list). */
export async function listPublicUsers(url: string): Promise<PublicUser[]> {
  const saved = loadPublicProfiles();
  let publicUsers: PublicUser[] = [];
  try {
    publicUsers = await publicUsersRaw(url);
  } catch {
    publicUsers = [];
  }
  return mergeProfiles(saved, publicUsers);
}

/** Back to the profile picker. A local profile keeps its linked account for next time. */
export async function logout(): Promise<void> {
  await clearSessionCaches();
  const wasLocal = localProfile != null;
  localProfile = null;
  setJellyfinSession(null);
  store.remove(KEYS.activeLocalProfile);
  if (wasLocal) return;
  await clearSessionAt(KEYS.data);
}

/** Forgets the Jellyfin server (its users and the session), keeping local profiles. */
export async function logoutServer(): Promise<void> {
  await clearSessionCaches();
  localProfile = null;
  setJellyfinSession(null);
  store.remove(KEYS.activeLocalProfile);
  await clearSessionAt(KEYS.data);
  store.remove(KEYS.profiles);
  clearServer();
}

/** Links a Jellyfin account to the active local profile. */
export async function linkServer(url: string, username: string, password: string): Promise<Session> {
  const profile = localProfile;
  if (!profile) throw new Error("No hay un perfil local activo");
  const deviceId = await existingDeviceId();
  const session = await loginRaw(url, username, password, deviceId);
  await saveSessionAt(KEYS.localSession(profile.id), session);
  saveServer(session.serverUrl, "");
  saveDeviceId(session.deviceId);
  upsertProfile({
    id: session.userId,
    name: session.userName,
    hasPassword: password.length > 0,
    avatarUrl: session.avatarUrl,
  });
  setJellyfinSession(session);
  await clearSessionCaches();
  return requireView();
}

export async function unlinkServer(): Promise<Session> {
  const profile = localProfile;
  if (!profile) throw new Error("No hay un perfil local activo");
  await clearSessionCaches();
  setJellyfinSession(null);
  await clearSessionAt(KEYS.localSession(profile.id));
  return requireView();
}

export async function localeGet(): Promise<string> {
  const locale = store.get<string>(KEYS.locale);
  return locale === "en" || locale === "es" ? locale : "";
}

export async function localeSet(locale: string): Promise<void> {
  if (locale !== "en" && locale !== "es") throw new Error("Idioma no válido");
  store.set(KEYS.locale, locale);
}
