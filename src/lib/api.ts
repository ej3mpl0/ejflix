import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { HomeData, Movie, PlayerState, PublicInfo, PublicUser, SavedServer, Session } from "./types";

export const api = {
  probeServer: (url: string) => invoke<PublicInfo>("probe_server", { url }),
  login: (url: string, username: string, password: string) =>
    invoke<Session>("login", { url, username, password }),
  sessionRestore: () => invoke<Session | null>("session_restore"),
  savedServer: () => invoke<SavedServer | null>("saved_server"),
  listPublicUsers: (url: string) => invoke<PublicUser[]>("list_public_users", { url }),
  logout: () => invoke<void>("logout"),
  logoutServer: () => invoke<void>("logout_server"),
  getHome: () => invoke<HomeData>("get_home"),
  getItem: (id: string) => invoke<Movie>("get_item", { id }),
  searchItems: (query: string, genre?: string | null, year?: number | null) =>
    invoke<Movie[]>("search_items", { query, genre: genre ?? null, year: year ?? null }),
  getFavorites: () => invoke<Movie[]>("get_favorites"),
  setFavorite: (itemId: string, favorite: boolean) =>
    invoke<boolean>("set_favorite", { itemId, favorite }),
  getLibrary: (args?: { genre?: string | null; year?: number | null; sort?: string | null }) =>
    invoke<Movie[]>("get_library", {
      genre: args?.genre ?? null,
      year: args?.year ?? null,
      sort: args?.sort ?? null,
    }),
  getSeasons: (seriesId: string) => invoke<Movie[]>("get_seasons", { seriesId }),
  getEpisodes: (seriesId: string, seasonId?: string | null) =>
    invoke<Movie[]>("get_episodes", { seriesId, seasonId: seasonId ?? null }),
  resolvePlayable: (id: string) => invoke<Movie>("resolve_playable", { id }),
  nextEpisode: (id: string) => invoke<Movie | null>("next_episode", { id }),
  setPlayed: (itemId: string, played: boolean) =>
    invoke<boolean>("set_played", { itemId, played }),
  playerStart: (args: {
    itemId: string;
    title: string;
    startSeconds?: number;
    mediaSourceId?: string | null;
  }) => invoke<PlayerState>("player_start", { args }),
  playerStop: () => invoke<void>("player_stop"),
  playerTogglePause: () => invoke<void>("player_toggle_pause"),
  playerSeek: (seconds: number, relative: boolean) =>
    invoke<void>("player_seek", { seconds, relative }),
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
