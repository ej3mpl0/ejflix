import type {
  AddonMeta,
  AddonMetaFull,
  AddonStream,
  AddonVideo,
  ExternalRef,
  Movie,
  ResumeEntry,
} from "./types";

/** Id prefix of online titles inside the app (never a Jellyfin id). */
const PREFIX = "addon:";

export function isExternal(movie: Pick<Movie, "external">): boolean {
  return Boolean(movie.external);
}

function externalId(videoId: string): string {
  return `${PREFIX}${videoId}`;
}

/** Item with every field at its empty value; online titles and channels build on it. */
export function emptyMovie(id: string, kind: string, name: string): Movie {
  return {
    id,
    kind,
    seriesId: null,
    seriesName: null,
    seasonId: null,
    seasonNumber: null,
    episodeNumber: null,
    thumbUrl: null,
    name,
    overview: null,
    year: null,
    runtimeTicks: null,
    officialRating: null,
    communityRating: null,
    criticRating: null,
    genres: [],
    posterUrl: null,
    backdropUrl: null,
    logoUrl: null,
    playbackPositionTicks: 0,
    playedPercentage: 0,
    favorite: false,
    played: false,
    unplayedCount: null,
    badges: [],
    videoLabel: null,
    audioLabel: null,
    subtitleLabels: [],
    directors: [],
    writers: [],
    studios: [],
    cast: [],
    providerIds: {},
    remoteTrailers: [],
    childCount: null,
    status: null,
    tagline: null,
    endYear: null,
    mediaSourceId: null,
    mediaSources: [],
    dateCreated: null,
    trickplay: null,
    chapters: [],
  };
}

/** "1h 30min" / "95 min" from Stremio's free-form runtime text. */
function runtimeTicks(runtime: string | null): number | null {
  if (!runtime) return null;
  const hours = /(\d+)\s*h/i.exec(runtime);
  const minutes = /(\d+)\s*m/i.exec(runtime);
  const plain = /^(\d+)$/.exec(runtime.trim());
  const total = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : plain ? Number(plain[1]) : 0);
  return total > 0 ? total * 60 * 10_000_000 : null;
}

function kindOf(type: string): "movie" | "series" {
  return type === "series" ? "series" : "movie";
}

/** Catalog entry → poster card item. Series open their details; movies pick a stream. */
export function metaToMovie(meta: AddonMeta): Movie {
  const type = kindOf(meta.type);
  const base = emptyMovie(externalId(meta.id), type === "series" ? "Series" : "Movie", meta.name);
  return {
    ...base,
    external: {
      type,
      metaId: meta.id,
      videoId: meta.id,
      imdb: meta.imdb,
      season: null,
      episode: null,
    },
    overview: meta.description,
    year: meta.year,
    runtimeTicks: runtimeTicks(meta.runtime),
    communityRating: meta.imdbRating,
    genres: meta.genres,
    posterUrl: meta.poster,
    backdropUrl: meta.background ?? meta.poster,
    logoUrl: meta.logo,
  };
}

/** Full metadata → details-page item (cast as names, no pictures). */
export function metaFullToMovie(meta: AddonMetaFull): Movie {
  const movie = metaToMovie(meta);
  return {
    ...movie,
    directors: meta.director,
    cast: meta.cast.map((name, i) => ({ id: `${meta.id}:cast:${i}`, name, role: null, kind: "Actor", imageUrl: null })),
    status: null,
  };
}

/** One episode of an online series. */
export function videoToMovie(meta: AddonMetaFull, video: AddonVideo): Movie {
  const base = emptyMovie(externalId(video.id), "Episode", video.title);
  return {
    ...base,
    external: {
      type: "series",
      metaId: meta.id,
      videoId: video.id,
      imdb: meta.imdb,
      season: video.season,
      episode: video.episode,
    },
    seriesName: meta.name,
    seasonNumber: video.season,
    episodeNumber: video.episode,
    thumbUrl: video.thumbnail,
    overview: video.overview,
    year: video.released ? Number(video.released.slice(0, 4)) || null : meta.year,
    posterUrl: meta.poster,
    backdropUrl: meta.background ?? meta.poster,
    logoUrl: meta.logo,
    genres: meta.genres,
  };
}

/** Episodes sorted by season and number; specials (season 0) last. */
export function sortedVideos(videos: AddonVideo[]): AddonVideo[] {
  return [...videos].sort((a, b) => {
    const sa = a.season ?? 0;
    const sb = b.season ?? 0;
    if (sa !== sb) return (sa === 0 ? Infinity : sa) - (sb === 0 ? Infinity : sb);
    return (a.episode ?? 0) - (b.episode ?? 0);
  });
}

export function nextVideoOf(meta: AddonMetaFull, videoId: string): AddonVideo | null {
  const list = sortedVideos(meta.videos).filter((v) => (v.season ?? 0) !== 0);
  const index = list.findIndex((v) => v.id === videoId);
  return index >= 0 ? list[index + 1] ?? null : null;
}

/** Locally remembered progress → "Continue watching (online)" card. */
export function resumeToMovie(entry: ResumeEntry): Movie {
  const isEpisode = entry.type === "series" && entry.season != null;
  const base = emptyMovie(externalId(entry.key), isEpisode ? "Episode" : "Movie", entry.name);
  const progress = entry.durationSeconds > 0 ? (entry.positionSeconds / entry.durationSeconds) * 100 : 0;
  return {
    ...base,
    external: {
      type: kindOf(entry.type),
      metaId: entry.metaId,
      videoId: entry.key,
      imdb: entry.imdb,
      season: entry.season,
      episode: entry.episode,
    },
    seriesName: entry.seriesName,
    seasonNumber: entry.season,
    episodeNumber: entry.episode,
    posterUrl: entry.poster,
    backdropUrl: entry.background ?? entry.poster,
    logoUrl: entry.logo,
    thumbUrl: entry.background,
    playbackPositionTicks: Math.round(entry.positionSeconds * 10_000_000),
    runtimeTicks: entry.durationSeconds > 0 ? Math.round(entry.durationSeconds * 10_000_000) : null,
    playedPercentage: progress,
  };
}

/** Series page seed for an online episode (from the continue-watching row). */
export function seriesSeedOf(movie: Movie): Movie {
  const ext = movie.external;
  if (!ext) return movie;
  const base = emptyMovie(externalId(ext.metaId), "Series", movie.seriesName ?? movie.name);
  return {
    ...base,
    external: { type: "series", metaId: ext.metaId, videoId: ext.metaId, imdb: ext.imdb, season: null, episode: null },
    posterUrl: movie.posterUrl,
    backdropUrl: movie.backdropUrl,
    logoUrl: movie.logoUrl,
  };
}

/** Identity stored with the local progress of an online title. */
export function resumeEntryOf(movie: Movie): Omit<ResumeEntry, "positionSeconds" | "durationSeconds" | "updatedMs"> | null {
  const ext = movie.external;
  if (!ext) return null;
  return {
    key: ext.videoId,
    type: ext.type,
    metaId: ext.metaId,
    name: movie.name,
    seriesName: movie.seriesName,
    poster: movie.posterUrl,
    background: movie.backdropUrl,
    logo: movie.logoUrl,
    season: ext.season,
    episode: ext.episode,
    imdb: ext.imdb,
  };
}

/** Online sources for a Jellyfin item that carries an IMDb id (movies and episodes). */
export function externalRefForJellyfin(movie: Movie, seriesImdb?: string | null): ExternalRef | null {
  if (movie.kind === "Episode") {
    const imdb = seriesImdb ?? null;
    if (!imdb || movie.seasonNumber == null || movie.episodeNumber == null) return null;
    return {
      type: "series",
      metaId: imdb,
      videoId: `${imdb}:${movie.seasonNumber}:${movie.episodeNumber}`,
      imdb,
      season: movie.seasonNumber,
      episode: movie.episodeNumber,
    };
  }
  const imdb = movie.providerIds.Imdb;
  if (!imdb || movie.kind !== "Movie") return null;
  return { type: "movie", metaId: imdb, videoId: imdb, imdb, season: null, episode: null };
}

/** Picks the stream to play automatically when chaining episodes. */
export function pickStream(streams: AddonStream[], prefer: ExternalRef["prefer"]): AddonStream | null {
  const playable = streams.filter((s) => s.playable && s.url);
  if (!playable.length) return null;
  if (prefer) {
    const same =
      playable.find((s) => s.addonUrl === prefer.addonUrl && s.bingeGroup && s.bingeGroup === prefer.bingeGroup) ??
      playable.find((s) => s.addonUrl === prefer.addonUrl);
    if (same) return same;
  }
  return playable[0];
}

export function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

// ---- reading AIOStreams-style stream labels ----

/**
 * How a source reaches the player: `stream` plays straight from a torrent/debrid
 * link, `download` arrives as usenet and has to be fetched and cached first.
 */
export type StreamKind = "stream" | "download";

/** Addons whose results are NZBs rather than direct streams. */
const USENET = /newznab|usenet|nzbhydra|nzbdav|prowlarr|altmount|easynews|sabnzbd|\bnzb\b/i;

const RESOLUTION = /^(\d{3,4}p|4k|8k)$/i;

/** `"[TB⚡] Peerflix 2160p"` split into the parts worth drawing. */
export type StreamLabel = {
  addon: string | null;
  resolution: string | null;
  /** The service already holds the file, so it starts at once. */
  cached: boolean;
  /** The service has to fetch it before it plays. */
  pending: boolean;
  /** The addon reported a failure instead of a source. */
  failed: boolean;
};

export function parseStreamLabel(name: string): StreamLabel {
  const marked = /^\s*\[([^\]]*)\]\s*([\s\S]*)$/.exec(name);
  const badge = marked?.[1] ?? "";
  const words = (marked?.[2] ?? name).trim().split(/\s+/).filter(Boolean);
  const resolution = words.find((w) => RESOLUTION.test(w)) ?? null;
  return {
    addon: words.filter((w) => w !== resolution).join(" ") || null,
    resolution,
    cached: badge.includes("⚡"),
    pending: badge.includes("⏳"),
    failed: badge.includes("❌"),
  };
}

/**
 * AIOStreams tags every field of a description with an emoji. Anything not listed
 * here is dropped, including the size (📦), which `behaviorHints` already carries.
 */
const TAGS: Record<string, "quality" | "audio" | "languages" | "release" | "indexer"> = {
  "\u{1F4FA}": "quality", // 📺 dynamic range
  "\u{1F3A5}": "quality", // 🎥 source
  "\u{1F39E}": "quality", // 🎞️ codec
  "\u{1F3F7}": "quality", // 🏷️ tags
  "\u{1F4E1}": "quality", // 📡 network
  "\u{1F3A7}": "audio", // 🎧 audio codec
  "\u{1F50A}": "audio", // 🔊 channels
  "\u{1F30E}": "languages", // 🌎 languages
  "\u{1F4C1}": "release", // 📁 file name
  "\u{1F50D}": "indexer", // 🔍 indexer
};

const FIELD =
  /((?:\u{1F4FA}|\u{1F3A5}|\u{1F39E}|\u{1F3A7}|\u{1F50A}|\u{1F4E6}|\u{1F465}|\u{1F50D}|\u{1F30E}|\u{1F4C1}|\u{1F3F7}|\u{1F4E1})\u{FE0F}?)/u;

/** The parts of a stream description worth showing; the rest is emoji noise. */
export type StreamMeta = {
  release: string | null;
  languages: string[];
  quality: string[];
  audio: string[];
  indexer: string | null;
};

export function parseStreamMeta(description: string): StreamMeta {
  const meta: StreamMeta = { release: null, languages: [], quality: [], audio: [], indexer: null };
  if (!description) return meta;
  const parts = description.split(FIELD);
  for (let i = 1; i < parts.length; i += 2) {
    const tag = TAGS[parts[i].replace(/\u{FE0F}/gu, "")];
    const value = (parts[i + 1] ?? "").replace(/\s+/g, " ").trim();
    if (!tag || !value) continue;
    if (tag === "release") meta.release ??= value;
    else if (tag === "indexer") meta.indexer ??= value;
    else if (tag === "languages") meta.languages = value.split("|").map((l) => l.trim()).filter(Boolean);
    else if (!meta[tag].includes(value)) meta[tag].push(value);
  }
  return meta;
}

/** A stream reduced to what the picker draws. */
export type StreamView = {
  stream: AddonStream;
  kind: StreamKind;
  label: StreamLabel;
  meta: StreamMeta;
  /** Release name: the clearest thing to put on the first line. */
  title: string;
  /** Short descriptors drawn next to the languages. */
  chips: string[];
  /** False when the addon did not tag its description: fall back to its raw text. */
  parsed: boolean;
};

export function streamView(stream: AddonStream): StreamView {
  const label = parseStreamLabel(stream.name);
  const meta = parseStreamMeta(stream.title);
  const audio = meta.audio.join(" ");
  return {
    stream,
    kind: USENET.test(`${label.addon ?? ""} ${meta.indexer ?? ""}`) ? "download" : "stream",
    label,
    meta,
    title: meta.release ?? stream.filename ?? stream.name,
    chips: [label.resolution, ...meta.quality, audio].filter((c): c is string => Boolean(c)),
    parsed: Boolean(meta.release || meta.languages.length || meta.quality.length || audio),
  };
}
