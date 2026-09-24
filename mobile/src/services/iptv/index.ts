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
  XtreamAccount,
} from "../../lib/types";
import { emit, PlaybackError } from "../events";
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

/** Drops every playlist from memory (logout / profile switch). */
export function clearIptv(): void {
  state.clear();
}

registerSessionCleanup(clearIptv);

registerProfileDeleteHook(async (profileId: string) => {
  const ids = await sources.deleteProfileSources(profileId);
  for (const id of ids) state.forget(id);
});
