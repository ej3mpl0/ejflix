import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  TorrentCacheInfo,
  TorrentResolved,
  AccountStatus,
  MfaEnrollment,
  SyncReport,
  AddonInfo,
  AddonMeta,
  AddonMetaFull,
  AddonStream,
  BrowseArgs,
  ChannelGroup,
  ChannelPage,
  ChannelQuery,
  DiscordStatus,
  DownloadItem,
  DownloadRequest,
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
  LibraryEntry,
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
  /** The active session as it is now, with no side effects (a sync may have linked a server). */
  sessionCurrent: () => invoke<Session | null>("session_current"),
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
  /** Poster-card metadata of several titles at once (a collection names them only). */
  addonMetas: (type: string, ids: string[]) => invoke<AddonMeta[]>("addon_metas", { args: { kind: type, ids } }),
  addonStreams: (type: string, id: string) =>
    invoke<AddonStream[]>("addon_streams", { kind: type, id }),
  addonProgressList: () => invoke<ResumeEntry[]>("addon_progress_list"),
  addonProgressRemove: (key: string) => invoke<void>("addon_progress_remove", { key }),
  addonLibraryList: () => invoke<LibraryEntry[]>("addon_library_list"),
  /** Saves or clears "in my list" / "watched" for an online title; returns the whole list. */
  addonLibrarySet: (args: {
    entry: Omit<LibraryEntry, "saved" | "watched" | "updatedMs">;
    saved?: boolean;
    watched?: boolean;
  }) => invoke<LibraryEntry[]>("addon_library_set", { args }),
  /** Plays an online stream; `entry` identifies the title for the local progress. */
  playerStartUrl: (args: {
    url: string;
    title: string;
    headers: [string, string][];
    startSeconds?: number;
    entry: Omit<ResumeEntry, "positionSeconds" | "durationSeconds" | "updatedMs">;
  }) => invoke<PlayerState>("player_start_url", { args }),
  /** A bare torrent from an addon becomes a local URL (waits for its file list). */
  torrentResolve: (args: { infoHash: string; fileIdx: number | null; sources: string[] }) =>
    invoke<TorrentResolved>("torrent_resolve", { args }),
  torrentCacheInfo: () => invoke<TorrentCacheInfo>("torrent_cache_info"),
  torrentCacheClear: () => invoke<TorrentCacheInfo>("torrent_cache_clear"),
  /** Pauses every torrent nobody is watching (the switch went off). */
  torrentPauseAll: () => invoke<void>("torrent_pause_all"),
  /** Every configured addon, switched-off ones included (Settings). */
  addonsAll: () => invoke<AddonInfo[]>("addons_all"),
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
  // IPTV (live TV)
  iptvStatus: () => invoke<IptvStatus>("iptv_status"),
  iptvSourceSave: (input: IptvSourceInput) => invoke<IptvSource>("iptv_source_save", { input }),
  /** Imports a playlist picked with a file input (its text travels to Rust). */
  iptvSourceImport: (args: { id?: string | null; name: string; fileName: string; text: string }) =>
    invoke<IptvSource>("iptv_source_import", { id: args.id ?? null, name: args.name, fileName: args.fileName, text: args.text }),
  iptvSourceRemove: (id: string) => invoke<void>("iptv_source_remove", { id }),
  /** Downloads one source again, or every enabled one without an id. */
  iptvRefresh: (sourceId?: string | null) => invoke<void>("iptv_refresh", { sourceId: sourceId ?? null }),
  iptvXtreamCheck: (args: { url: string; username: string; password: string; userAgent?: string }) =>
    invoke<XtreamAccount>("iptv_xtream_check", { ...args, userAgent: args.userAgent ?? null }),
  iptvGroups: (sourceId?: string | null) => invoke<ChannelGroup[]>("iptv_groups", { sourceId: sourceId ?? null }),
  iptvChannels: (query: ChannelQuery) => invoke<ChannelPage>("iptv_channels", { query }),
  /** Programme on air (and the next one) for the given channel ids. */
  iptvEpgNow: (ids: string[]) => invoke<Record<string, EpgNow>>("iptv_epg_now", { ids }),
  iptvEpgChannel: (id: string) => invoke<Programme[]>("iptv_epg_channel", { id }),
  iptvFavorite: (id: string, on: boolean) => invoke<string[]>("iptv_favorite", { id, on }),
  iptvPlay: (id: string) => invoke<PlayerState>("iptv_play", { id }),
  onIptvChanged: (handler: () => void): Promise<UnlistenFn> => listen("iptv://changed", () => handler()),
  // Downloads of online sources (Rust owns the files and the list)
  downloadStream: (args: DownloadRequest) => invoke<DownloadItem>("download_stream", { args }),
  downloadsList: () => invoke<DownloadItem[]>("downloads_list"),
  downloadCancel: (id: string) => invoke<void>("download_cancel", { id }),
  /** Drops the entry; a finished file stays on disk. */
  downloadRemove: (id: string) => invoke<void>("download_remove", { id }),
  downloadsClear: () => invoke<void>("downloads_clear"),
  /** Shows the file in Explorer. */
  downloadReveal: (id: string) => invoke<void>("download_reveal", { id }),
  onDownloadsChanged: (handler: (items: DownloadItem[]) => void): Promise<UnlistenFn> =>
    listen<DownloadItem[]>("downloads://changed", (event) => handler(event.payload)),
  updateInfo: () => invoke<{ current: string; showNotes: boolean }>("update_info"),
  updateCheck: (force = false) => invoke<UpdateCheck>("update_check", { force }),
  updatePrefs: () => invoke<UpdatePrefs>("update_prefs"),
  updateSetAuto: (auto: boolean) => invoke<UpdatePrefs>("update_set_auto", { auto }),
  /** Empty string clears the skipped version. */
  updateSkip: (version: string) => invoke<UpdatePrefs>("update_skip", { version }),
  updateDownload: () => invoke<{ path: string; size: number }>("update_download"),
  updateInstall: (path: string) => invoke<void>("update_install", { path }),
  onUpdateProgress: (handler: (progress: UpdateProgress) => void): Promise<UnlistenFn> =>
    listen<UpdateProgress>("update://progress", (event) => handler(event.payload)),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
  dismissUpdate: () => invoke<void>("dismiss_update"),
  localeGet: () => invoke<string>("locale_get"),
  localeSet: (locale: string) => invoke<void>("locale_set", { locale }),
  /** Settings of the active profile (Rust resolves the user; defaults before login). */
  settingsGet: () => invoke<Settings>("settings_get"),
  /** Deep-merges a partial patch; every window receives `settings://changed`. */
  settingsSet: (patch: SettingsPatch) => invoke<Settings>("settings_set", { patch }),
  onSettingsChanged: (handler: (settings: Settings) => void): Promise<UnlistenFn> =>
    listen<Settings>("settings://changed", (event) => handler(event.payload)),
  // ejFlix account (Supabase, driven from Rust; errors come back as "auth:<code>")
  accountStatus: () => invoke<AccountStatus>("account_status"),
  accountSignUp: (email: string, password: string, language: string) =>
    invoke<{ confirmEmail: boolean }>("account_sign_up", { email, password, language }),
  accountSignIn: (email: string, password: string) =>
    invoke<{ mfaRequired: boolean }>("account_sign_in", { email, password }),
  accountMfaVerify: (code: string) => invoke<AccountStatus>("account_mfa_verify", { code }),
  accountMfaEnroll: () => invoke<MfaEnrollment>("account_mfa_enroll"),
  accountMfaConfirm: (factorId: string, code: string) =>
    invoke<AccountStatus>("account_mfa_confirm", { factorId, code }),
  accountMfaDisable: (code: string) => invoke<AccountStatus>("account_mfa_disable", { code }),
  accountResendConfirmation: (email: string) => invoke<void>("account_resend_confirmation", { email }),
  accountResetPassword: (email: string, language: string) =>
    invoke<void>("account_reset_password", { email, language }),
  accountSignOut: () => invoke<AccountStatus>("account_sign_out"),
  accountDelete: () => invoke<AccountStatus>("account_delete"),
  accountSetCredentials: (enabled: boolean) => invoke<AccountStatus>("account_set_credentials", { enabled }),
  accountDismissPrompt: () => invoke<void>("account_dismiss_prompt"),
  accountSyncNow: () => invoke<SyncReport>("account_sync_now"),
  onAccountChanged: (handler: (status: AccountStatus) => void): Promise<UnlistenFn> =>
    listen<AccountStatus>("account://changed", (event) => handler(event.payload)),
  /** A sync finished; `pulled` names the kinds this PC took from the account. */
  onAccountSynced: (handler: (report: SyncReport) => void): Promise<UnlistenFn> =>
    listen<SyncReport>("account://synced", (event) => handler(event.payload)),
};
