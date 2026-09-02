import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  HomeData,
  Library,
  Movie,
  PlayerState,
  PublicInfo,
  PublicUser,
  SavedServer,
  Session,
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
};
