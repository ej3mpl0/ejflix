/**
 * Who is using the app: a Jellyfin user, or a local ("online") profile that may have a
 * Jellyfin account linked. `serverUrl` is null when there is no server at all.
 */
export type Session = {
  mode: "jellyfin" | "local";
  userId: string;
  userName: string;
  /** Jellyfin picture URL, or the local profile avatar (`preset:n` / data URL). */
  avatarUrl: string | null;
  deviceId: string;
  serverUrl: string | null;
  serverName: string | null;
  /** Jellyfin user behind a linked local profile. */
  jellyfinUserName: string | null;
};

export function hasServer(session: Session | null | undefined): boolean {
  return Boolean(session?.serverUrl);
}

/** Profile that lives only inside the app (online mode). */
export type LocalProfile = {
  id: string;
  name: string;
  avatar: string;
  hasPin: boolean;
  linked: boolean;
};

export type ProfilePatch = {
  name?: string;
  avatar?: string;
  pin?: string;
  clearPin?: boolean;
};

export type BrowseSort = "popular" | "newest" | "year" | "name";

/** Discover filters against the Jellyfin library. */
export type BrowseArgs = {
  type: "movie" | "series";
  genre?: string | null;
  year?: number | null;
  sort?: BrowseSort;
  start?: number;
  limit?: number;
};

export type PublicInfo = {
  serverName: string;
  version: string;
  id: string;
};

export type SavedServer = {
  serverUrl: string;
  serverName: string;
};

export type PublicUser = {
  id: string;
  name: string;
  hasPassword: boolean;
  avatarUrl: string | null;
};

export type TrickplayLevel = {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  thumbnailCount: number;
  interval: number;
  bandwidth: number;
};

export type TrickplayInfo = {
  mediaSourceId: string;
  levels: TrickplayLevel[];
};

export type Chapter = {
  index: number;
  startSeconds: number;
  name: string | null;
  imageTag: string | null;
};

/** A Jellyfin user view (library). */
export type Library = {
  id: string;
  name: string;
  /** "movies", "tvshows", "mixed" or null for a plain folder. */
  collectionType: string | null;
};

export type ItemKind = "Movie" | "Series" | "Season" | "Episode";

/** Cast / crew entry. */
export type Person = {
  id: string;
  name: string;
  role: string | null;
  kind: string;
  imageUrl: string | null;
};

/** One playable version of an item. */
export type MediaSourceInfo = {
  id: string;
  name: string;
};

/** Stremio addon stream (an online source for a title). */
export type AddonStream = {
  addonName: string;
  addonUrl: string;
  name: string;
  title: string;
  url: string | null;
  externalUrl: string | null;
  infoHash: string | null;
  headers: [string, string][];
  bingeGroup: string | null;
  filename: string | null;
  videoSize: number | null;
  /** True when mpv can open it directly (an http(s) url). */
  playable: boolean;
};

/** Identity of an online (addon) title carried inside a Movie. */
export type ExternalRef = {
  type: "movie" | "series";
  /** Stremio meta id, e.g. "tt0944947". */
  metaId: string;
  /** Stremio video id: the meta id for movies, "tt…:season:episode" for episodes. */
  videoId: string;
  imdb: string | null;
  season: number | null;
  episode: number | null;
  /** Stream chosen for playback (set right before playing). */
  stream?: AddonStream | null;
  /** Addon/binge group of the stream being played, used to auto-pick the next episode. */
  prefer?: { addonUrl: string; bingeGroup: string | null } | null;
  /** Next episode of the show, for the next-episode card. */
  next?: Movie | null;
};

/** Identity of an IPTV channel carried inside a Movie. */
export type LiveRef = {
  channelId: string;
  sourceId: string;
  sourceName: string;
  group: string;
  number: number | null;
  logo: string | null;
  /** "live" | "movie" (VOD entry of the playlist). */
  kind: string;
};

export type Movie = {
  id: string;
  /** Present for online titles served by Stremio addons (no Jellyfin item behind). */
  external?: ExternalRef | null;
  /** Present for IPTV channels (kind "LiveTv"). */
  live?: LiveRef | null;
  /** Jellyfin item type; anything unknown is treated like a movie. */
  kind: ItemKind | string;
  seriesId: string | null;
  seriesName: string | null;
  seasonId: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  /** 16:9 still for episodes. */
  thumbUrl: string | null;
  name: string;
  overview: string | null;
  year: number | null;
  runtimeTicks: number | null;
  officialRating: string | null;
  communityRating: number | null;
  criticRating: number | null;
  genres: string[];
  posterUrl: string | null;
  backdropUrl: string | null;
  logoUrl: string | null;
  playbackPositionTicks: number;
  playedPercentage: number;
  /** In "My list" (Jellyfin favorite). */
  favorite: boolean;
  played: boolean;
  /** Series/seasons: episodes left to watch. */
  unplayedCount: number | null;
  badges: string[];
  videoLabel: string | null;
  audioLabel: string | null;
  subtitleLabels: string[];
  directors: string[];
  writers: string[];
  studios: string[];
  cast: Person[];
  /** External ids: Imdb, Tmdb, Tvdb... */
  providerIds: Record<string, string>;
  remoteTrailers: string[];
  /** Seasons: episode count; series: season count. */
  childCount: number | null;
  /** Series: "Continuing" | "Ended". */
  status: string | null;
  tagline: string | null;
  endYear: number | null;
  mediaSourceId: string | null;
  mediaSources: MediaSourceInfo[];
  /** ISO-8601 date the item was added to the library. */
  dateCreated: string | null;
  /** ISO-8601 air / release date (episodes: when it aired). */
  premiereDate?: string | null;
  trickplay: TrickplayInfo | null;
  chapters: Chapter[];
};

export type GenreRow = {
  id: string;
  name: string;
  items: Movie[];
};

export type HomeData = {
  /** Hero carousel items. */
  featured: Movie[];
  resume: Movie[];
  /** Next episodes to watch (TV libraries only). */
  nextUp: Movie[];
  latest: Movie[];
  genres: GenreRow[];
  all: Movie[];
};

export type PlayerTrack = {
  id: number;
  kind: string;
  title: string;
  lang: string | null;
  selected: boolean;
  codec: string | null;
};

export type PlayerState = {
  time: number;
  duration: number;
  paused: boolean;
  volume: number;
  mute: boolean;
  buffering: boolean;
  eof: boolean;
  tracks: PlayerTrack[];
  aid: number;
  sid: number;
  title: string;
  cacheTime: number;
  speed: number;
  /** "auto" | "16:9" | "4:3" | "2.35:1" | "fill" */
  aspect: string;
};

export type ToastAction = { label: string; run: () => void };

export type Toast = {
  id: number;
  message: string;
  /** One button in the toast ("Undo"); running it closes the toast. */
  action?: ToastAction;
};

export type AddonCatalog = {
  addonUrl: string;
  addonName: string;
  type: string;
  id: string;
  name: string;
  searchable: boolean;
  requiresExtra: boolean;
  genres: string[];
};

export type AddonInfo = {
  url: string;
  id: string;
  name: string;
  version: string;
  description: string;
  logo: string | null;
  types: string[];
  resources: string[];
  catalogs: AddonCatalog[];
  builtin: boolean;
};

export type AddonMeta = {
  id: string;
  type: string;
  name: string;
  poster: string | null;
  background: string | null;
  logo: string | null;
  description: string | null;
  releaseInfo: string | null;
  imdbRating: number | null;
  genres: string[];
  runtime: string | null;
  year: number | null;
  imdb: string | null;
};

export type AddonVideo = {
  id: string;
  title: string;
  season: number | null;
  episode: number | null;
  released: string | null;
  thumbnail: string | null;
  overview: string | null;
};

export type AddonMetaFull = AddonMeta & {
  cast: string[];
  director: string[];
  videos: AddonVideo[];
  /** YouTube watch URLs from `trailers` / `trailerStreams`. */
  trailers: string[];
};

/** An online title the user saved to their list or ticked off as watched. */
export type LibraryEntry = {
  key: string;
  type: string;
  metaId: string;
  name: string;
  seriesName: string | null;
  poster: string | null;
  background: string | null;
  logo: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
  imdb: string | null;
  saved: boolean;
  watched: boolean;
  updatedMs: number;
};

/** Locally remembered position of an online title. */
export type ResumeEntry = {
  key: string;
  type: string;
  metaId: string;
  name: string;
  seriesName: string | null;
  poster: string | null;
  background: string | null;
  logo: string | null;
  season: number | null;
  episode: number | null;
  imdb: string | null;
  positionSeconds: number;
  durationSeconds: number;
  updatedMs: number;
};

export type MediaSegmentKind = "intro" | "recap" | "outro" | "preview" | "commercial";

/** Skippable range of an item (Jellyfin media segments or IntroDB). */
export type MediaSegment = {
  kind: MediaSegmentKind | string;
  startSeconds: number;
  endSeconds: number;
  source: "jellyfin" | "introdb" | string;
};

export const THEME_IDS = [
  "white",
  "gold",
  "jade",
  "rose_gold",
  "arctic",
  "graphite",
  "crimson",
  "ocean",
  "violet",
  "emerald",
  "amber",
  "rose",
] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export type PosterSize = "small" | "medium" | "large";
export type SkipMode = "ask" | "auto" | "off";
export type Countdown = 0 | 5 | 10 | 15;

/** Per-profile settings, mirrored from `src-tauri/src/settings.rs`. */
export type Settings = {
  appearance: { theme: ThemeId; amoled: boolean; posterSize: PosterSize };
  playback: {
    skipIntro: SkipMode;
    skipRecap: SkipMode;
    skipOutro: SkipMode;
    nextEpisodeCountdown: Countdown;
    /** "" = file default, else ISO 639-2 ("spa"). */
    audioLanguage: string;
    /** "" = file default, "off" = none, else ISO 639-2. */
    subtitleLanguage: string;
    rememberSpeed: boolean;
    lastSpeed: number;
    showTimeRemaining: boolean;
    /** Look of the subtitles the app draws itself (files loaded from the device). */
    subScale: number;
    subColor: string;
    subBackground: SubBackground;
    /** Seconds a double tap or a seek button jumps: 5, 10, 15 or 30. */
    seekStep: number;
    /** Height of the app-drawn subtitles. */
    subPosition: SubPosition;
    /** Picture-in-picture when the app goes to the background while playing. */
    autoPip: boolean;
    /** Sound keeps playing with the app in the background (and in PiP). */
    backgroundAudio: boolean;
    /** Vibration on player gestures, the lock and switches. */
    haptics: boolean;
  };
  library: { pinned: string[] };
  addons: { urls: string[]; cinemeta: boolean };
  /** Discord Rich Presence; templates accept {title} {episode} {year} {type} {source}. */
  discord: {
    enabled: boolean;
    /** Discord application id; "" uses the built-in one. */
    clientId: string;
    details: string;
    state: string;
    showPoster: boolean;
    showTime: boolean;
    showPaused: boolean;
    /** Text after "Watching": the application name, the first line or the second line. */
    header: DiscordHeader;
  };
  /** Live TV (IPTV lists). */
  iptv: {
    /** Download the playlists and guides again on launch when older than 12 hours. */
    autoRefresh: boolean;
    /** Fetch the XMLTV programme guide. */
    epg: boolean;
    /** Mouse wheel over the video changes channel instead of volume. */
    wheelZap: boolean;
  };
  /** First-run setup of the profile (look, addon import). */
  onboarding: { setupDone: boolean };
};

export type SubBackground = "outline" | "shadow" | "box";
export type SubPosition = "bottom" | "raised" | "top";

/** An addon found in another app's account, offered for import. */
export type ImportedAddon = { url: string; name: string; official: boolean };

export type DiscordHeader = "name" | "details" | "state";

/** Result of asking GitHub for the latest release. */
export type UpdateCheck = {
  current: string;
  latest: string;
  available: boolean;
  skipped: boolean;
  /** Release notes as written on GitHub (markdown). */
  notes: string;
  url: string;
  assetUrl: string | null;
  assetName: string | null;
  assetSize: number | null;
  publishedAt: string | null;
  checkedAtMs: number;
};

export type UpdatePrefs = {
  auto: boolean;
  skipped: string | null;
};

export type UpdateProgress = { received: number; total: number };

export type DiscordStatus = { connected: boolean; error: string | null };

// ---- IPTV ----

export type IptvSourceKind = "m3uUrl" | "m3uFile" | "xtream";

export type XtreamAccount = {
  status: string;
  expiresMs: number | null;
  maxConnections: number | null;
  activeConnections: number | null;
  trial: boolean;
};

/** Configured IPTV source with its loaded state (never the password). */
export type IptvSource = {
  id: string;
  name: string;
  kind: IptvSourceKind;
  url: string;
  path: string;
  imported: boolean;
  username: string;
  hasPassword: boolean;
  epgUrl: string;
  output: string;
  userAgent: string;
  includeVod: boolean;
  enabled: boolean;
  channelCount: number;
  groupCount: number;
  epgChannels: number;
  updatedMs: number;
  loading: boolean;
  error: string | null;
  epgError: string | null;
  epgSource: string | null;
  account: XtreamAccount | null;
};

export type IptvSourceInput = {
  id?: string | null;
  name: string;
  kind: IptvSourceKind;
  url: string;
  path: string;
  username: string;
  /** New password; empty or null keeps the stored one. */
  password?: string | null;
  epgUrl: string;
  output: string;
  userAgent: string;
  includeVod: boolean;
  enabled: boolean;
};

export type IptvStatus = { sources: IptvSource[]; loading: boolean };

export type Channel = {
  id: string;
  sourceId: string;
  name: string;
  logo: string | null;
  group: string;
  /** "live" | "movie" */
  kind: string;
  number: number | null;
  tvgId: string;
  favorite: boolean;
  /** A programme guide is attached to this channel. */
  epg: boolean;
};

export type Programme = {
  /** Unix seconds. */
  start: number;
  stop: number;
  title: string;
  desc: string | null;
  category: string | null;
};

export type EpgNow = { now: Programme | null; next: Programme | null };

export type ChannelGroup = { name: string; sourceId: string; count: number; kind: string };

export type ChannelQuery = {
  sourceId?: string | null;
  group?: string | null;
  search?: string | null;
  favorites?: boolean;
  recent?: boolean;
  offset?: number;
  limit?: number;
};

export type ChannelPage = { items: Channel[]; total: number };

export type SettingsPatch = { [K in keyof Settings]?: Partial<Settings[K]> };

export const DEFAULT_SETTINGS: Settings = {
  appearance: { theme: "crimson", amoled: false, posterSize: "medium" },
  playback: {
    skipIntro: "ask",
    skipRecap: "ask",
    skipOutro: "ask",
    nextEpisodeCountdown: 5,
    audioLanguage: "",
    subtitleLanguage: "",
    rememberSpeed: false,
    lastSpeed: 1,
    showTimeRemaining: false,
    subScale: 1,
    subColor: "#FFFFFF",
    subBackground: "outline",
    seekStep: 10,
    subPosition: "bottom",
    autoPip: true,
    backgroundAudio: true,
    haptics: true,
  },
  library: { pinned: [] },
  addons: { urls: [], cinemeta: true },
  discord: {
    enabled: false,
    clientId: "",
    details: "{title}",
    state: "{episode}",
    showPoster: true,
    showTime: true,
    showPaused: true,
    header: "details",
  },
  iptv: { autoRefresh: true, epg: true, wheelZap: false },
  onboarding: { setupDone: false },
};
