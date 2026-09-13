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

export type Movie = {
  id: string;
  /** Present for online titles served by Stremio addons (no Jellyfin item behind). */
  external?: ExternalRef | null;
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

export type Toast = {
  id: number;
  message: string;
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
};

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
};
