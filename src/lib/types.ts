export type Session = {
  serverUrl: string;
  userId: string;
  userName: string;
  deviceId: string;
  avatarUrl?: string | null;
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

export type Movie = {
  id: string;
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
  badges: string[];
  videoLabel: string | null;
  audioLabel: string | null;
  subtitleLabels: string[];
  directors: string[];
  cast: string[];
  mediaSourceId: string | null;
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
  featured: Movie | null;
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
};

export type Toast = {
  id: number;
  message: string;
};
