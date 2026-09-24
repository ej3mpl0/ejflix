/**
 * Facade with the exact names and signatures of the desktop `src/lib/api.ts`.
 * Tauri `invoke` calls became direct service calls; `listen`/`emit` became the
 * typed emitter in `./events`. Screens, hooks and libs import `api` from `../lib/api`.
 */
import { Linking } from "react-native";
import type {
  AddonInfo,
  AddonMeta,
  AddonMetaFull,
  ImportedAddon,
  LibraryEntry,
  AddonStream,
  BrowseArgs,
  ChannelGroup,
  ChannelPage,
  ChannelQuery,
  DiscordStatus,
  EpgNow,
  IptvSource,
  IptvSourceInput,
  IptvStatus,
  Programme,
  XtreamAccount,
  HomeData,
  UpdateCheck,
  UpdatePrefs,
  UpdateProgress,
  Library,
  LocalProfile,
  MediaSegment,
  Movie,
  PlayerState,
  ProfilePatch,
  PublicInfo,
  PublicUser,
  ResumeEntry,
  SavedServer,
  Session,
  Settings,
  SettingsPatch,
  ParentalStatus,
} from "../lib/types";
import { emit, listen, type PlayerError } from "./events";
import * as session from "./session";
import * as profiles from "./profiles";
import * as settings from "./settings";
import * as library from "./jellyfin/library";
import * as segments from "./segments";
import * as addons from "./addons";
import * as iptv from "./iptv";
import { engine } from "./player/engine";
import * as updates from "./updates";
import * as parental from "./parental";

const EXTERNAL_ALLOWLIST = ["https://github.com/", "https://discord.com/developers/", "https://introdb.app/"];

export const api = {
  probeServer: (url: string): Promise<PublicInfo> => session.probeServer(url),
  /** Checks a server without saving it (the "Test connection" button). */
  testServer: (url: string): Promise<PublicInfo> => session.testServer(url),
  login: (url: string, username: string, password: string): Promise<Session> =>
    session.login(url, username, password),
  sessionRestore: (): Promise<Session | null> => session.sessionRestore(),
  savedServer: (): Promise<SavedServer | null> => session.savedServer(),
  listPublicUsers: (url: string): Promise<PublicUser[]> => session.listPublicUsers(url),
  logout: (): Promise<void> => session.logout(),
  logoutServer: (): Promise<void> => session.logoutServer(),
  // Local (online) profiles
  localProfilesList: (): Promise<LocalProfile[]> => profiles.localProfilesList(),
  /** `parentalPin` is asked for while a profile has a parental restriction. */
  localProfileCreate: (name: string, avatar: string, pin?: string | null, parentalPin?: string | null): Promise<LocalProfile> =>
    profiles.localProfileCreate(name, avatar, pin ?? null, parentalPin ?? null),
  localProfileUpdate: (id: string, patch: ProfilePatch): Promise<LocalProfile> =>
    profiles.localProfileUpdate(id, patch),
  /** `pin`: the profile's own PIN (unless it is open); `parentalPin` when it is restricted. */
  localProfileDelete: (id: string, pin?: string | null, parentalPin?: string | null): Promise<void> =>
    profiles.localProfileDelete(id, pin ?? null, parentalPin ?? null),
  /** Opens a local profile; `pin` is required when the profile has one. */
  localProfileEnter: (id: string, pin?: string | null): Promise<Session> =>
    profiles.localProfileEnter(id, pin ?? null),
  /** Links a Jellyfin account to the active local profile. */
  linkServer: (url: string, username: string, password: string): Promise<Session> =>
    session.linkServer(url, username, password),
  unlinkServer: (): Promise<Session> => session.unlinkServer(),
  /** Discover: library browse with filters. */
  browseItems: (args: BrowseArgs): Promise<Movie[]> => library.browseItems(args),
  discordStatus: (): Promise<DiscordStatus> => Promise.resolve({ connected: false, error: null } as DiscordStatus),
  getGenres: (): Promise<string[]> => library.getGenres(),
  getLibraries: (): Promise<Library[]> => library.getLibraries(),
  getHome: (libraryArg?: Library | null): Promise<HomeData> => library.getHome(libraryArg ?? null),
  getItem: (id: string): Promise<Movie> => library.getItem(id),
  getSeasons: (seriesId: string): Promise<Movie[]> => library.getSeasons(seriesId),
  getEpisodes: (seriesId: string, seasonId: string): Promise<Movie[]> => library.getEpisodes(seriesId, seasonId),
  getNextEpisode: (seriesId: string, episodeId: string): Promise<Movie | null> =>
    library.getNextEpisode(seriesId, episodeId),
  getSeriesNextUp: (seriesId: string): Promise<Movie | null> => library.getSeriesNextUp(seriesId),
  searchItems: (query: string): Promise<Movie[]> => library.searchItems(query),
  getSimilar: (id: string): Promise<Movie[]> => library.getSimilar(id),
  personItems: (id: string): Promise<Movie[]> => library.personItems(id),
  getFavorites: (): Promise<Movie[]> => library.getFavorites(),
  /** Resolves to the flag confirmed by the server. */
  setFavorite: (itemId: string, favorite: boolean): Promise<boolean> => library.setFavorite(itemId, favorite),
  setPlayed: (itemId: string, played: boolean): Promise<boolean> => library.setPlayed(itemId, played),
  /** Intro / recap / credits ranges; empty when unknown, never throws. */
  getMediaSegments: (itemId: string): Promise<MediaSegment[]> => segments.getMediaSegments(itemId),
  getMediaSegmentsExternal: (imdb: string, season: number, episode: number): Promise<MediaSegment[]> =>
    segments.getMediaSegmentsExternal(imdb, season, episode),
  // Stremio addons
  addonsList: (): Promise<AddonInfo[]> => addons.addonsList(),
  addonAdd: (url: string): Promise<AddonInfo> => addons.addonAdd(url),
  addonRemove: (url: string): Promise<void> => addons.addonRemove(url),
  /** Addons of a Stremio account (the password goes to Stremio only, never stored). */
  stremioAddons: (email: string, password: string): Promise<ImportedAddon[]> => addons.stremioAddons(email, password),
  addonCatalog: (args: {
    addonUrl: string;
    type: string;
    id: string;
    search?: string;
    genre?: string;
    skip?: number;
  }): Promise<AddonMeta[]> => addons.addonCatalog(args),
  addonMeta: (type: string, id: string): Promise<AddonMetaFull> => addons.addonMeta(type, id),
  addonStreams: (type: string, id: string): Promise<AddonStream[]> => addons.addonStreams(type, id),
  addonProgressList: (): Promise<ResumeEntry[]> => addons.addonProgressList(),
  addonProgressRemove: (key: string): Promise<void> => addons.addonProgressRemove(key),
  addonLibraryList: (): Promise<LibraryEntry[]> => addons.addonLibraryList(),
  preferredSource: (metaId: string) => addons.preferredSource(metaId),
  savePreferredSource: (metaId: string, stream: AddonStream) => addons.savePreferredSource(metaId, stream),
  addonLibrarySet: (args: {
    entry: Omit<LibraryEntry, "saved" | "watched" | "updatedMs">;
    saved?: boolean;
    watched?: boolean;
  }): Promise<LibraryEntry[]> => addons.addonLibrarySet(args),
  /** Plays an online stream; `entry` identifies the title for the local progress. */
  playerStartUrl: (args: {
    url: string;
    title: string;
    headers: [string, string][];
    startSeconds?: number;
    entry: Omit<ResumeEntry, "positionSeconds" | "durationSeconds" | "updatedMs">;
  }): Promise<PlayerState> => engine.playerStartUrl(args),
  playerStart: (args: {
    itemId: string;
    title: string;
    startSeconds?: number;
    mediaSourceId?: string | null;
  }): Promise<PlayerState> => engine.playerStart(args),
  /** `switching`: another item starts right away (keeps the player screen). */
  playerStop: (switching = false): Promise<void> => engine.playerStop(switching),
  playerTogglePause: (): Promise<void> => engine.playerTogglePause(),
  playerSeek: (seconds: number, relative: boolean, fast = false): Promise<void> =>
    engine.playerSeek(seconds, relative, fast),
  playerSetSpeed: (speed: number): Promise<number> => engine.playerSetSpeed(speed),
  playerSetAspect: (mode: string): Promise<void> => engine.playerSetAspect(mode),
  playerSetVolume: (volume: number): Promise<number> => engine.playerSetVolume(volume),
  playerSetMute: (mute: boolean): Promise<void> => engine.playerSetMute(mute),
  playerSetTrack: (kind: string, id: number): Promise<void> => engine.playerSetTrack(kind, id),
  playerState: (): Promise<PlayerState> => Promise.resolve(engine.snapshot()),
  onPlayerState: (handler: (state: PlayerState) => void): Promise<() => void> => listen("player://state", handler),
  onPlayerHotkey: (handler: (key: string) => void): Promise<() => void> => listen("player://hotkey", handler),
  onPlayerError: (handler: (error: PlayerError) => void): Promise<() => void> =>
    listen("player://error", handler),
  playerSetFullscreen: (fullscreen: boolean): Promise<void> => engine.playerSetFullscreen(fullscreen),
  openPlayer: (movie: Movie) => emit("player://open", movie),
  onPlayerOpen: (handler: (movie: Movie) => void): Promise<() => void> => listen("player://open", handler),
  /** Player → shell: play this item next (next episode, zapping). */
  playNext: (movie: Movie) => emit("player://next", movie),
  onPlayerNext: (handler: (movie: Movie) => void): Promise<() => void> => listen("player://next", handler),
  exitPlayer: () => emit("player://exit"),
  onPlayerExit: (handler: () => void): Promise<() => void> => listen("player://exit", () => handler()),
  onPlayerClose: (handler: () => void): Promise<() => void> => listen("player://close", () => handler()),
  // IPTV (live TV)
  iptvStatus: (): Promise<IptvStatus> => iptv.iptvStatus(),
  iptvSourceSave: (input: IptvSourceInput): Promise<IptvSource> => iptv.iptvSourceSave(input),
  /** Imports a playlist picked with the document picker (its text is passed in). */
  iptvSourceImport: (args: { id?: string | null; name: string; fileName: string; text: string }): Promise<IptvSource> =>
    iptv.iptvSourceImport({ id: args.id ?? null, name: args.name, fileName: args.fileName, text: args.text }),
  iptvSourceRemove: (id: string): Promise<void> => iptv.iptvSourceRemove(id),
  /** Downloads one source again, or every enabled one without an id. */
  iptvRefresh: (sourceId?: string | null): Promise<void> => iptv.iptvRefresh(sourceId ?? null),
  iptvXtreamCheck: (args: { url: string; username: string; password: string; userAgent?: string }): Promise<XtreamAccount> =>
    iptv.iptvXtreamCheck({ ...args, userAgent: args.userAgent ?? null }),
  iptvGroups: (sourceId?: string | null): Promise<ChannelGroup[]> => iptv.iptvGroups(sourceId ?? null),
  iptvChannels: (query: ChannelQuery): Promise<ChannelPage> => iptv.iptvChannels(query),
  /** Programme on air (and the next one) for the given channel ids. */
  iptvEpgNow: (ids: string[]): Promise<Record<string, EpgNow>> => iptv.iptvEpgNow(ids),
  iptvEpgChannel: (id: string): Promise<Programme[]> => iptv.iptvEpgChannel(id),
  iptvFavorite: (id: string, on: boolean): Promise<string[]> => iptv.iptvFavorite(id, on),
  iptvPlay: (id: string): Promise<PlayerState> => engine.iptvPlay(id),
  onIptvChanged: (handler: () => void): Promise<() => void> => listen("iptv://changed", () => handler()),
  updateInfo: (): Promise<{ current: string; showNotes: boolean }> => updates.updateInfo(),
  updateCheck: (force = false): Promise<UpdateCheck> => updates.updateCheck(force),
  updatePrefs: (): Promise<UpdatePrefs> => updates.updatePrefs(),
  updateSetAuto: (auto: boolean): Promise<UpdatePrefs> => updates.updateSetAuto(auto),
  /** Empty string clears the skipped version. */
  updateSkip: (version: string): Promise<UpdatePrefs> => updates.updateSkip(version),
  updateDownload: (): Promise<{ path: string; size: number }> => updates.updateDownload(),
  updateInstall: (path: string): Promise<void> => updates.updateInstall(path),
  onUpdateProgress: (handler: (progress: UpdateProgress) => void): Promise<() => void> =>
    listen("update://progress", handler),
  openExternal: async (url: string): Promise<void> => {
    if (!EXTERNAL_ALLOWLIST.some((prefix) => url.startsWith(prefix))) throw new Error("URL no permitida");
    await Linking.openURL(url);
  },
  dismissUpdate: (): Promise<void> => updates.dismissUpdate(),
  localeGet: (): Promise<string> => session.localeGet(),
  localeSet: (locale: string): Promise<void> => session.localeSet(locale),
  /** Settings of the active profile (defaults before login). */
  settingsGet: (): Promise<Settings> => settings.settingsGet(),
  /** Deep-merges a partial patch; listeners receive `settings://changed`. */
  settingsSet: (patch: SettingsPatch): Promise<Settings> => settings.settingsSet(patch),
  onSettingsChanged: (handler: (settings: Settings) => void): Promise<() => void> =>
    listen("settings://changed", handler),
  // --- profiles & integrations ---
  /** Checks a profile's PIN without opening it (rejects with "PIN incorrecto"). */
  localProfileCheckPin: (id: string, pin: string): Promise<void> => profiles.localProfileCheckPin(id, pin),
  parentalStatus: (): Promise<ParentalStatus> => parental.parentalStatus(),
  /** `pin` is the parental PIN, or the new one when none exists yet. */
  parentalSet: (pin: string, maxAge: number, hideUnrated: boolean, newPin?: string | null): Promise<ParentalStatus> =>
    parental.parentalSet(pin, maxAge, hideUnrated, newPin ?? null),
  onParentalChanged: (handler: (status: ParentalStatus) => void): Promise<() => void> =>
    listen("parental://changed", handler),
};

export type Api = typeof api;
