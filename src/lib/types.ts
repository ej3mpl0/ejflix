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
  /** Minimum community rating (0-10). */
  minRating?: number | null;
  /** Only titles this person takes part in (Jellyfin person id). */
  personId?: string | null;
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
  /** True when mpv can open it directly (an http(s) url). A bare torrent (infoHash, no url) plays through the built-in engine. */
  playable: boolean;
  /** Which file of the torrent, when the addon says. */
  fileIdx: number | null;
  /** Trackers the addon named for the torrent. */
  sources: string[];
};

/** A torrent turned into a local URL by the built-in engine. */
export type TorrentResolved = { url: string; fileName: string; size: number };

export type TorrentCacheInfo = { bytes: number; torrents: number; dir: string };

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
  trickplay: TrickplayInfo | null;
  chapters: Chapter[];
  /** ISO-8601 air / release date (Jellyfin `PremiereDate`). */
  premiereDate?: string | null;
  /** Play all / shuffle: what comes after this item instead of the next episode. */
  queue?: PlayQueue | null;
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
  /** Subtitle / audio delay in seconds (remembered per title). */
  subDelay: number;
  audioDelay: number;
  /** Night mode (dynamic range compression) is on. */
  night: boolean;
  /** The window is the small always-on-top mini player. */
  mini: boolean;
};

/** One OpenSubtitles.com search result. */
export type OnlineSubtitle = {
  fileId: number;
  release: string;
  /** OpenSubtitles language code ("es", "en", "pt-BR"...). */
  language: string;
  downloads: number;
  hearingImpaired: boolean;
  machineTranslated: boolean;
  trusted: boolean;
  fps: number | null;
};

/** What the online subtitle search looks for. */
export type SubtitleQuery = {
  imdb?: string | null;
  parentImdb?: string | null;
  season?: number | null;
  episode?: number | null;
  title?: string | null;
  /** ISO 639-2 or 639-1 codes; empty = every language. */
  languages: string[];
};

export type Toast = {
  id: number;
  message: string;
  /** One button in the toast ("Undo"); running it closes the toast. */
  action?: { label: string; run: () => void };
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
  /** The addon's own settings page (debrid keys and the like), when it has one. */
  configureUrl: string | null;
  /** False when the profile switched it off (kept in the list, not consulted). */
  enabled: boolean;
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

/** One name of the cast of an online title. */
export type AddonPerson = {
  name: string;
  role: string | null;
  photo: string | null;
};

/** A title this one is tied to: the rest of its collection or saga. */
export type AddonRelated = {
  id: string;
  type: string;
  name: string;
  /** The heading the addon filed them under ("Halloween - Colección"). */
  group: string;
};

export type AddonMetaFull = AddonMeta & {
  cast: AddonPerson[];
  director: string[];
  videos: AddonVideo[];
  related: AddonRelated[];
  /** YouTube watch URLs. */
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
  appearance: {
    theme: ThemeId;
    amoled: boolean;
    posterSize: PosterSize;
    /** Muted trailers behind the Home hero and the details backdrop. */
    autoplayTrailers: boolean;
    /** The accent follows the artwork on screen (the theme is the fallback). */
    autoAccent: boolean;
  };
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
    /** Subtitle size factor, 0.5 to 2.5. */
    subScale: number;
    /** Subtitle text colour, "#RRGGBB". */
    subColor: string;
    subBackground: SubBackground;
    /** Seconds a seek jumps: 5, 10, 15 or 30. */
    seekStep: number;
    /** Percentage past which stopping marks the title watched (80, 85, 90, 95); the credits count too. */
    watchedThreshold: number;
    /** Night mode on when playback starts. */
    nightMode: boolean;
    /** Vertical subtitle position (mpv sub-pos): 100 = bottom, 50 to 100. */
    subPos: number;
    /** Subtitle outline thickness, 0 to 6. */
    subOutline: number;
    /** Apply the look to styled (ASS/SSA) subtitles too. */
    subAssOverride: boolean;
    /** OpenSubtitles.com API key ("" = online search off). */
    opensubtitlesApiKey: string;
    /** Optional OpenSubtitles.com username; the password is stored apart. */
    opensubtitlesUser: string;
  };
  library: { pinned: string[] };
  /** `disabled` holds the URLs of addons kept in the list but switched off. */
  addons: { urls: string[]; cinemeta: boolean; disabled: string[] };
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
  /** Built-in torrent playback for addon sources that come as a bare info hash. */
  torrents: {
    enabled: boolean;
    /** Upload to other peers while watching (applies when the engine next starts). */
    share: boolean;
    /** Disk the downloaded files may take before the oldest are dropped. */
    cacheGb: number;
    /** Upload cap in KB/s while sharing; 0 = none. */
    uploadKbps: number;
    /** Download cap in KB/s; 0 = none. */
    downloadKbps: number;
  };
  /** First-run setup of the profile (torrents, addon import). */
  onboarding: { setupDone: boolean };
};

/** An addon found in another app's account, offered for import. */
export type ImportedAddon = { url: string; name: string; official: boolean };

export type DiscordHeader = "name" | "details" | "state";
export type SubBackground = "outline" | "shadow" | "box";

/** Live numbers of a torrent being opened or played; `known` is false before its metadata. */
export type TorrentStatus = {
  known: boolean;
  peers: number;
  downMbps: number;
  upMbps: number;
  progressBytes: number;
  totalBytes: number;
};

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

// ---- Downloads of online sources ----

export type DownloadStatus = "downloading" | "done" | "error" | "canceled";

/** One saved (or saving) online source, mirrored from Rust. */
export type DownloadItem = {
  id: string;
  /** File name on disk. */
  name: string;
  title: string;
  /** Addon that served the stream. */
  source: string;
  path: string;
  received: number;
  /** 0 when the server does not say how big the file is. */
  total: number;
  status: DownloadStatus | string;
  error: string | null;
  startedMs: number;
  updatedMs: number;
};

export type DownloadRequest = {
  url: string;
  headers: [string, string][];
  /** Name the file gets when the addon does not give one. */
  title: string;
  fileName: string;
  source: string;
  size: number | null;
};

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

/** ejFlix account of the active profile (Rust holds the tokens). */
export type AccountStatus = {
  signedIn: boolean;
  email: string | null;
  mfaEnabled: boolean;
  /** Signed in, but the code of the second factor is still due. */
  mfaRequired: boolean;
  syncCredentials: boolean;
  lastSyncMs: number;
  syncing: boolean;
  lastError: string | null;
  promptDismissed: boolean;
};

export type MfaEnrollment = {
  factorId: string;
  /** `data:image/svg+xml;utf-8,...` */
  qrCode: string;
  secret: string;
  uri: string;
};

export type SyncReport = { pushed: string[]; pulled: string[]; skipped: string | null };

export const DEFAULT_SETTINGS: Settings = {
  appearance: { theme: "crimson", amoled: false, posterSize: "medium", autoplayTrailers: true, autoAccent: false },
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
    watchedThreshold: 90,
    nightMode: false,
    subPos: 100,
    subOutline: 3,
    subAssOverride: false,
    opensubtitlesApiKey: "",
    opensubtitlesUser: "",
  },
  library: { pinned: [] },
  addons: { urls: [], cinemeta: true, disabled: [] },
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
  torrents: { enabled: true, share: true, cacheGb: 5, uploadKbps: 512, downloadKbps: 0 },
  // Until the real settings arrive nothing asks for the setup step.
  onboarding: { setupDone: true },
};

// --- discovery ---

/** One title in a custom list (Jellyfin item or online title). */
export type ListItem = {
  /** "jf:<item id>" for a Jellyfin item, the Stremio video id for an online title. */
  key: string;
  source: "jellyfin" | "online";
  /** Jellyfin: "Movie" | "Series" | "Episode"; online: "movie" | "series". */
  type: string;
  itemId: string | null;
  metaId: string | null;
  name: string;
  seriesName: string | null;
  poster: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
  imdb: string | null;
  addedMs: number;
};

export type CustomList = {
  id: string;
  name: string;
  /** Newest first. */
  items: ListItem[];
  createdMs: number;
  updatedMs: number;
};

/** Jellyfin episodes around today and the series the user follows. */
export type CalendarData = {
  episodes: Movie[];
  followed: string[];
};

/** A Jellyfin recommendation row and the title (or person) it grew from. */
export type RecommendationRow = {
  kind: string;
  baseline: string;
  items: Movie[];
};

/**
 * What plays after the current item when it was started from "Play all" / "Shuffle".
 * `list`: the rest of a list, in order. `shuffle`: another random episode of the series.
 */
export type PlayQueue =
  | { mode: "list"; items: Movie[] }
  | { mode: "shuffle"; seriesId: string | null; metaId: string | null; seen: string[] };
