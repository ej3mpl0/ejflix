/**
 * IPTV facade (the `iptv_*` Tauri commands). Sources belong to the active profile
 * (`settingsUser()`); everything else lives in `./state`.
 */
import type {
  Channel,
  ChannelGroup,
  ChannelPage,
  ChannelQuery,
  EpgNow,
  IptvSource,
  IptvSourceInput,
  IptvStatus,
  Programme,
  Reminder,
  XtreamAccount,
} from "../../lib/types";
import { Platform } from "react-native";
import { emit, PlaybackError } from "../events";
import { KEYS, store } from "../store";
import { addReminder, catchupUrl, dropReminder, dueReminders, pruneReminders } from "./catchup";
import { nowMs } from "../util";
import { getSettingsFor, settingsUser } from "../settings";
import { registerSessionCleanup } from "../session";
import { registerProfileDeleteHook } from "../profiles";
import { xtreamCheck } from "./catalog";
import * as sources from "./sources";
import * as state from "./state";
import { parseXtreamUrl } from "./xtream";
import { BLOCKED, hidesAdult, isAdultChannel } from "../parental";

function requireUser(): string {
  const uid = settingsUser();
  if (!uid) throw new Error("No hay sesión activa");
  return uid;
}

async function iptvPrefs(uid: string): Promise<{ autoRefresh: boolean; epg: boolean }> {
  const settings = await getSettingsFor(uid);
  return settings.iptv;
}

function nowSeconds(): number {
  return Math.floor(nowMs() / 1000);
}

/** Puts cached playlists in memory and refreshes missing or stale ones in the background. */
export async function ensureIptv(): Promise<void> {
  const uid = settingsUser();
  if (!uid) return;
  const prefs = await iptvPrefs(uid);
  state.ensure(sources.listSources(uid), prefs.autoRefresh, prefs.epg);
}

/** Sources of the active profile with their loaded state. */
export async function iptvStatus(): Promise<IptvStatus> {
  const uid = requireUser();
  const list = sources.listSources(uid);
  const prefs = await iptvPrefs(uid);
  state.ensure(list, prefs.autoRefresh, prefs.epg);
  return { sources: state.views(list), loading: state.isLoading() };
}

/** Creates or edits a source and downloads it right away. */
export async function iptvSourceSave(input: IptvSourceInput): Promise<IptvSource> {
  const uid = requireUser();
  const source = await sources.saveSource(uid, input);
  const prefs = await iptvPrefs(uid);
  state.forget(source.id);
  if (source.enabled) state.spawnRefresh(source, prefs.epg);
  else emit("iptv://changed");
  const view = state.views([source])[0];
  if (!view) throw new Error("No se pudo guardar la lista");
  return view;
}

/** Imports the content of a playlist file chosen in the UI. */
export async function iptvSourceImport(args: {
  id: string | null;
  name: string;
  fileName: string;
  text: string;
}): Promise<IptvSource> {
  const uid = requireUser();
  const source = await sources.importPlaylist(uid, args.id, args.name, args.fileName, args.text);
  const prefs = await iptvPrefs(uid);
  state.forget(source.id);
  state.spawnRefresh(source, prefs.epg);
  const view = state.views([source])[0];
  if (!view) throw new Error("No se pudo importar la lista");
  return view;
}

export async function iptvSourceRemove(id: string): Promise<void> {
  const uid = requireUser();
  await sources.removeSource(uid, id);
  state.forget(id);
  emit("iptv://changed");
}

/** Downloads a source again (or every enabled one without `sourceId`). */
export async function iptvRefresh(sourceId: string | null): Promise<void> {
  const uid = requireUser();
  const prefs = await iptvPrefs(uid);
  for (const source of sources.listSources(uid)) {
    if (!source.enabled || (sourceId !== null && sourceId !== source.id)) continue;
    state.spawnRefresh(source, prefs.epg);
  }
}

/** Signs in to an Xtream Codes server without saving anything. */
export async function iptvXtreamCheck(args: {
  url: string;
  username: string;
  password: string;
  userAgent: string | null;
}): Promise<XtreamAccount> {
  const parsed = parseXtreamUrl(args.url);
  const username = args.username.trim() === "" ? (parsed.username ?? "") : args.username.trim();
  const password = args.password === "" ? (parsed.password ?? "") : args.password;
  if (username === "" || password === "") throw new Error("Xtream Codes necesita usuario y contraseña");
  return xtreamCheck({ url: parsed.base, username, userAgent: args.userAgent ?? "" }, password);
}

export async function iptvGroups(sourceId: string | null): Promise<ChannelGroup[]> {
  const uid = requireUser();
  return state.groups(sources.listSources(uid), sourceId);
}

export async function iptvChannels(query: ChannelQuery): Promise<ChannelPage> {
  const uid = requireUser();
  return state.channels(sources.listSources(uid), query, sources.favorites(uid), sources.recent(uid));
}

/** Current and next programme of each channel (only channels with a guide are returned). */
export async function iptvEpgNow(ids: string[]): Promise<Record<string, EpgNow>> {
  return state.epgNow(ids, nowSeconds());
}

export async function iptvEpgChannel(id: string): Promise<Programme[]> {
  return state.epgChannel(id, nowSeconds());
}

export async function iptvFavorite(id: string, on: boolean): Promise<string[]> {
  const uid = requireUser();
  if (sources.sourceOf(id) === null) throw new Error("Canal no válido");
  return sources.setFavorite(uid, id, on);
}

/**
 * Resolves what the player needs for a channel: the stream URL (with the Xtream
 * credentials) and its headers. Also records the channel as recently watched.
 */
export async function resolveChannelPlayback(channelId: string): Promise<{
  channel: Channel;
  sourceName: string;
  url: string;
  headers: Record<string, string>;
}> {
  const uid = requireUser();
  const found = state.find(channelId);
  if (!found) throw new PlaybackError("playErrChannelNotFound", "Canal no encontrado");
  if (hidesAdult() && isAdultChannel(found.channel)) throw new PlaybackError("parentalBlockedTitle", BLOCKED);
  const source = sources.listSources(uid).find((s) => s.id === found.channel.sourceId);
  if (!source) throw new PlaybackError("playErrChannelListGone", "La lista de este canal ya no existe");
  const password = await sources.passwordOf(source);
  const { url, headers } = sources.streamFor(source, password, found.channel);
  sources.pushRecent(uid, channelId);
  return {
    channel: state.viewOf(found.channel, found.catalog, sources.favorites(uid)),
    sourceName: source.name,
    url,
    headers,
  };
}

/**
 * Stream URL of a past programme of a channel with catch-up (Xtream timeshift or the M3U
 * `catchup-source`), with the channel's headers.
 */
export async function resolveCatchupPlayback(
  channelId: string,
  start: number,
  stop: number,
): Promise<{ channel: Channel; url: string; headers: Record<string, string> }> {
  const uid = requireUser();
  const found = state.find(channelId);
  if (!found) throw new PlaybackError("playErrChannelNotFound", "Canal no encontrado");
  if (hidesAdult() && isAdultChannel(found.channel)) throw new PlaybackError("parentalBlockedTitle", BLOCKED);
  const source = sources.listSources(uid).find((s) => s.id === found.channel.sourceId);
  if (!source) throw new PlaybackError("playErrChannelListGone", "La lista de este canal ya no existe");
  const password = await sources.passwordOf(source);
  const { headers } = sources.streamFor(source, password, found.channel);
  // Only HLS plays on iOS (AVPlayer): the archive is asked for as .m3u8 there too.
  const xtream =
    source.kind === "xtream"
      ? { base: source.url, username: source.username, password, output: Platform.OS === "ios" ? "m3u8" : "ts" }
      : null;
  const url = catchupUrl(xtream, found.channel, start, stop, nowSeconds(), found.catalog.serverOffset);
  return { channel: state.viewOf(found.channel, found.catalog, sources.favorites(uid)), url, headers };
}

// ---- programme reminders (kept per profile in the store; announced in the app) ----

/** Same rule as for channels: the group or the name of the channel. */
function isAdultReminder(reminder: Reminder): boolean {
  return isAdultChannel({ group: reminder.group, name: reminder.channelName });
}

function loadReminders(uid: string): Reminder[] {
  const raw = store.get<unknown[]>(KEYS.iptvReminders(uid));
  return Array.isArray(raw)
    ? raw.filter((r): r is Reminder => typeof r === "object" && r !== null && typeof (r as Reminder).channelId === "string")
    : [];
}

function saveReminders(uid: string, list: Reminder[]): Reminder[] {
  store.set(KEYS.iptvReminders(uid), list);
  emit("iptv://reminders");
  return list;
}

/** Pending reminders, soonest first (programmes that started a while ago are dropped). */
export async function iptvReminders(): Promise<Reminder[]> {
  const uid = requireUser();
  const list = loadReminders(uid);
  const kept = pruneReminders(list, nowSeconds());
  const shown = kept.length !== list.length ? saveReminders(uid, kept) : kept;
  return hidesAdult() ? shown.filter((r) => !isAdultReminder(r)) : shown;
}

export async function iptvReminderSet(reminder: Reminder): Promise<Reminder[]> {
  const uid = requireUser();
  if (sources.sourceOf(reminder.channelId) === null) throw new Error("Canal no válido");
  if (hidesAdult() && isAdultReminder(reminder)) throw new PlaybackError("parentalBlockedTitle", BLOCKED);
  return saveReminders(uid, addReminder(loadReminders(uid), reminder, nowSeconds()));
}

export async function iptvReminderRemove(channelId: string, start: number): Promise<Reminder[]> {
  const uid = requireUser();
  return saveReminders(uid, dropReminder(loadReminders(uid), channelId, start, nowSeconds()));
}

/** Reminders that go off now (a minute before the start), each returned once. */
export async function iptvDueReminders(): Promise<Reminder[]> {
  const uid = settingsUser();
  if (!uid) return [];
  const { list, due } = dueReminders(loadReminders(uid), nowSeconds());
  if (due.length) saveReminders(uid, list);
  // A restricted profile is never offered an adult channel.
  return hidesAdult() ? due.filter((r) => !isAdultReminder(r)) : due;
}

/** Drops every playlist from memory (logout / profile switch). */
export function clearIptv(): void {
  state.clear();
}

registerSessionCleanup(clearIptv);

registerProfileDeleteHook(async (profileId: string) => {
  const ids = await sources.deleteProfileSources(profileId);
  for (const id of ids) state.forget(id);
});
