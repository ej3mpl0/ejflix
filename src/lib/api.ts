import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AddonInfo,
  AddonMeta,
  AddonMetaFull,
  AddonStream,
  BrowseArgs,
  DiscordStatus,
  HomeData,
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
} from "./types";

export const api = {
  probeServer: (url: string) => invoke<PublicInfo>("probe_server", { url }),
  login: (url: string, username: string, password: string) =>
    invoke<Session>("login", { url, username, password }),
  sessionRestore: () => invoke<Session | null>("session_restore"),
  savedServer: () => invoke<SavedServer | null>("saved_server"),
  listPublicUsers: (url: string) => invoke<PublicUser[]>("list_public_users", { url }),
  logout: () => invoke<void>("logout"),
  logoutServer: () => invoke<void>("logout_server"),
  // Local (online) profiles
  localProfilesList: () => invoke<LocalProfile[]>("local_profiles_list"),
  localProfileCreate: (name: string, avatar: string, pin?: string | null) =>
    invoke<LocalProfile>("local_profile_create", { name, avatar, pin: pin ?? null }),
  localProfileUpdate: (id: string, patch: ProfilePatch) =>
    invoke<LocalProfile>("local_profile_update", { id, patch }),
  localProfileDelete: (id: string) => invoke<void>("local_profile_delete", { id }),
  /** Opens a local profile; `pin` is required when the profile has one. */
  localProfileEnter: (id: string, pin?: string | null) =>
    invoke<Session>("local_profile_enter", { id, pin: pin ?? null }),
  /** Links a Jellyfin account to the active local profile. */
  linkServer: (url: string, username: string, password: string) =>
    invoke<Session>("link_server", { url, username, password }),
  unlinkServer: () => invoke<Session>("unlink_server"),
  /** Discover: library browse with filters. */
  browseItems: (args: BrowseArgs) => invoke<Movie[]>("browse_items", { args }),
  discordStatus: () => invoke<DiscordStatus>("discord_status"),
  getGenres: () => invoke<string[]>("get_genres"),
  getLibraries: () => invoke<Library[]>("get_libraries"),
  getHome: (library?: Library | null) => invoke<HomeData>("get_home", { library: library ?? null }),
  getItem: (id: string) => invoke<Movie>("get_item", { id }),
  getSeasons: (seriesId: string) => invoke<Movie[]>("get_seasons", { seriesId }),
  getEpisodes: (seriesId: string, seasonId: string) =>
    invoke<Movie[]>("get_episodes", { seriesId, seasonId }),
  getNextEpisode: (seriesId: string, episodeId: string) =>
    invoke<Movie | null>("get_next_episode", { seriesId, episodeId }),
  getSeriesNextUp: (seriesId: string) => invoke<Movie | null>("get_series_next_up", { seriesId }),
  searchItems: (query: string) => invoke<Movie[]>("search_items", { query }),
  getSimilar: (id: string) => invoke<Movie[]>("get_similar", { id }),
  getFavorites: () => invoke<Movie[]>("get_favorites"),
  /** Resolves to the flag confirmed by the server. */
  setFavorite: (itemId: string, favorite: boolean) =>
    invoke<boolean>("set_favorite", { itemId, favorite }),
  setPlayed: (itemId: string, played: boolean) => invoke<boolean>("set_played", { itemId, played }),
  /** Intro / recap / credits ranges; empty when unknown, never throws on the Rust side. */
  getMediaSegments: (itemId: string) => invoke<MediaSegment[]>("get_media_segments", { itemId }),
  getMediaSegmentsExternal: (imdb: string, season: number, episode: number) =>
    invoke<MediaSegment[]>("get_media_segments_external", { imdb, season, episode }),
  // Stremio addons
  addonsList: () => invoke<AddonInfo[]>("addons_list"),
  addonAdd: (url: string) => invoke<AddonInfo>("addon_add", { url }),
  addonRemove: (url: string) => invoke<void>("addon_remove", { url }),
  addonCatalog: (args: {
    addonUrl: string;
    type: string;
    id: string;
    search?: string;
    genre?: string;
    skip?: number;
  }) => invoke<AddonMeta[]>("addon_catalog", { args }),
  addonMeta: (type: string, id: string) => invoke<AddonMetaFull>("addon_meta", { kind: type, id }),
  addonStreams: (type: string, id: string) =>
    invoke<AddonStream[]>("addon_streams", { kind: type, id }),
  addonProgressList: () => invoke<ResumeEntry[]>("addon_progress_list"),
  addonProgressRemove: (key: string) => invoke<void>("addon_progress_remove", { key }),
  /** Plays an online stream; `entry` identifies the title for the local progress. */
  playerStartUrl: (args: {
    url: string;
    title: string;
    headers: [string, string][];
    startSeconds?: number;
    entry: Omit<ResumeEntry, "positionSeconds" | "durationSeconds" | "updatedMs">;
  }) => invoke<PlayerState>("player_start_url", { args }),
  playerStart: (args: {
    itemId: string;
    title: string;
    startSeconds?: number;
    mediaSourceId?: string | null;
  }) => invoke<PlayerState>("player_start", { args }),
  /** `switching`: another item starts right away (keeps fullscreen and the overlay). */
  playerStop: (switching = false) => invoke<void>("player_stop", { switching }),
  playerTogglePause: () => invoke<void>("player_toggle_pause"),
  playerSeek: (seconds: number, relative: boolean, fast = false) =>
    invoke<void>("player_seek", { seconds, relative, fast }),
  playerSetSpeed: (speed: number) => invoke<number>("player_set_speed", { speed }),
  playerSetAspect: (mode: string) => invoke<void>("player_set_aspect", { mode }),
  playerSetVolume: (volume: number) => invoke<number>("player_set_volume", { volume }),
  playerSetMute: (mute: boolean) => invoke<void>("player_set_mute", { mute }),
  playerSetTrack: (kind: string, id: number) =>
    invoke<void>("player_set_track", { kind, id }),
  playerState: () => invoke<PlayerState>("player_state"),
  onPlayerState: (handler: (state: PlayerState) => void): Promise<UnlistenFn> =>
    listen<PlayerState>("player://state", (event) => handler(event.payload)),
  onPlayerHotkey: (handler: (key: string) => void): Promise<UnlistenFn> =>
    listen<string>("player://hotkey", (event) => handler(event.payload)),
  playerSetFullscreen: (fullscreen: boolean) =>
    invoke<void>("player_set_fullscreen", { fullscreen }),
  openPlayer: (movie: Movie) => emit("player://open", movie),
  onPlayerOpen: (handler: (movie: Movie) => void): Promise<UnlistenFn> =>
    listen<Movie>("player://open", (event) => handler(event.payload)),
  /** Overlay → main: play this item next (next episode). */
  playNext: (movie: Movie) => emit("player://next", movie),
  onPlayerNext: (handler: (movie: Movie) => void): Promise<UnlistenFn> =>
    listen<Movie>("player://next", (event) => handler(event.payload)),
  exitPlayer: () => emit("player://exit"),
  onPlayerExit: (handler: () => void): Promise<UnlistenFn> =>
    listen("player://exit", () => handler()),
  onPlayerClose: (handler: () => void): Promise<UnlistenFn> =>
    listen("player://close", () => handler()),
  updateInfo: () => invoke<{ current: string; showNotes: boolean }>("update_info"),
  dismissUpdate: () => invoke<void>("dismiss_update"),
  localeGet: () => invoke<string>("locale_get"),
  localeSet: (locale: string) => invoke<void>("locale_set", { locale }),
  /** Settings of the active profile (Rust resolves the user; defaults before login). */
  settingsGet: () => invoke<Settings>("settings_get"),
  /** Deep-merges a partial patch; every window receives `settings://changed`. */
  settingsSet: (patch: SettingsPatch) => invoke<Settings>("settings_set", { patch }),
  onSettingsChanged: (handler: (settings: Settings) => void): Promise<UnlistenFn> =>
    listen<Settings>("settings://changed", (event) => handler(event.payload)),
};
