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

export type Movie = {
  id: string;
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
};

export type GenreRow = {
  id: string;
  name: string;
  items: Movie[];
};

export type HomeData = {
  featured: Movie | null;
  resume: Movie[];
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
};

export type Toast = {
  id: number;
  message: string;
};
