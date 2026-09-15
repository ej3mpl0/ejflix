import type {
  AddonMeta,
  AddonMetaFull,
  AddonStream,
  AddonVideo,
  ExternalRef,
  LibraryEntry,
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

/**
 * The id every addon agrees on.
 *
 * A catalog that keys titles by its own database hands out ids like `tmdb:610253`
 * while still reporting the IMDb id, and the torrent addons only index that one. So
 * a title is identified and played by its IMDb id whenever it is known: that is what
 * keeps one film from turning into two cards and what makes every source answer for
 * it. Its metadata still comes from `metaId`, the catalog that served the title,
 * because those catalogs carry a fuller cast than the IMDb one.
 */
function canonicalId(meta: AddonMeta): string {
  return meta.imdb && !meta.id.startsWith("tt") ? meta.imdb : meta.id;
}

/** Catalog entry → poster card item. Series open their details; movies pick a stream. */
export function metaToMovie(meta: AddonMeta): Movie {
  const type = kindOf(meta.type);
  const id = canonicalId(meta);
  const base = emptyMovie(externalId(id), type === "series" ? "Series" : "Movie", meta.name);
  return {
    ...base,
    external: {
      type,
      metaId: meta.id,
      videoId: id,
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
    cast: meta.cast.map((person, i) => ({
      id: `${meta.id}:cast:${i}`,
      name: person.name,
      role: person.role,
      kind: "Actor",
      imageUrl: person.photo,
    })),
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

/** Identity stored when an online title is saved to the list or ticked off. */
export function libraryEntryOf(movie: Movie): Omit<LibraryEntry, "saved" | "watched" | "updatedMs"> | null {
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
    year: movie.year,
    season: ext.season,
    episode: ext.episode,
    imdb: ext.imdb,
  };
}

/** A saved online title → poster card item. */
export function libraryToMovie(entry: LibraryEntry): Movie {
  const isEpisode = entry.type === "series" && entry.season != null;
  const base = emptyMovie(externalId(entry.key), isEpisode ? "Episode" : entry.type === "series" ? "Series" : "Movie", entry.name);
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
    year: entry.year,
    posterUrl: entry.poster,
    backdropUrl: entry.background ?? entry.poster,
    logoUrl: entry.logo,
    favorite: entry.saved,
    played: entry.watched,
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
  /((?:\u{1F4FA}|\u{1F3A5}|\u{1F39E}|\u{1F3A7}|\u{1F50A}|\u{1F4E6}|\u{1F465}|\u{1F50D}|\u{1F30E}|\u{1F4C1}|\u{1F3F7}|\u{1F4E1}|\u{1F4DD}|\u{1F3C6})\u{FE0F}?)/u;

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

/** File extensions a release name drags along. */
const EXTENSION = /\.(mkv|mp4|avi|m4v|mov|ts|wmv|flv|webm|iso)$/i;

/** A word that starts the technical tail of a release name. */
const TECH =
  /^(\d{3,4}p|[48]k|uhd|sdr|hdr\d*|hdr10\+?|dv|bluray|blu-ray|bdrip|bdremux|bd|brrip|bdrip|remux|microhd|web-?dl|web-?rip|hdtv|dvdrip|dvd|hdrip|tvrip|cam|screener|x26[45]|h\.?26[45]|hevc|avc|xvid|divx|ac3|eac3|dts|dts-hd|truehd|atmos|aac|opus|flac|mp3|dd|ddp|\d\.\d|dual|multi|castellano|latino|spanish|espanol|español|english|ingles|inglés|subs?|vose|vo|extendida|extended|unrated|remastered|remasterizada|proper|repack|imax|complete|completa|season|temporada|s\d{1,2}(e\d{1,2})?|cap|\d{4}|4k\S*|[a-z]*uhd\S*|[a-z]*remux|[a-z]*rip\d*|\d+(en|in)\d+|www\.\S*|\S+\.(com|net|org|to|tv|top|me|io)|es-en)$/i;

/** The tracker or site that stamped its name on the file. */
const SITE = /\b[\w-]+\.(com|net|org|to|tv|top|me|io|es|cc|info)\b/gi;

/** A resolution glued into a word, as in `BD1080` or `4Krip2160`. */
const GLUED_RESOLUTION = /(?:^|\D)(?:480|540|576|720|1080|2160|4320)(?:\D|$)/;

/** Edition wording, dropped from the title because it comes back as a badge. */
const EDITION_PHRASE = /\b(v\.?\s?extendida|extended|unrated|director'?s\s?cut|remaster(ed|izada)|imax)\b/gi;

/** Editions worth a badge; the rest of the technical tail is already charted. */
const EDITIONS: [RegExp, string][] = [
  [/\b(v\.?\s?extendida|extended)\b/i, "Extended"],
  [/\bunrated\b/i, "Unrated"],
  [/\bdirector'?s\s?cut\b/i, "Director's Cut"],
  [/\b(remastered|remasterizada)\b/i, "Remastered"],
  [/\bimax\b/i, "IMAX"],
  [/\bdual\b/i, "Dual"],
];

/**
 * `"Halloween Kills [MicroHD 1080p][AC3 5.1-Castellano]"` -> `"Halloween Kills"`.
 *
 * Everything from the first technical word on is dropped, because the picker draws
 * those as badges. A name that is technical from the start keeps its raw text: a bad
 * title is still better than an empty row.
 */
export function cleanReleaseName(raw: string): string {
  const noExtension = raw.replace(EXTENSION, "");
  const named = noExtension.includes(" ") ? noExtension : noExtension.replace(/[._]+/g, " ");
  const spaced = named.replace(SITE, " ");
  const words = spaced
    .replace(EDITION_PHRASE, " ")
    .replace(/[[\]()_+]/g, " ")
    .split(/[\s.]+/)
    .filter(Boolean);
  const tail = words.findIndex((w) => TECH.test(w) || GLUED_RESOLUTION.test(w));
  const title = (tail < 0 ? words : words.slice(0, tail)).join(" ").replace(/[-–—:,]+$/, "").trim();
  return title.length > 1 ? title : spaced.trim();
}

/** Edition markers hidden in a release name, as badge labels. */
export function editionsOf(raw: string): string[] {
  return EDITIONS.filter(([pattern]) => pattern.test(raw)).map(([, label]) => label);
}

/** A stream reduced to what the picker draws. */
export type StreamView = {
  stream: AddonStream;
  kind: StreamKind;
  label: StreamLabel;
  meta: StreamMeta;
  /** Just the title of the release: the technical part of it lives in `chips`. */
  title: string;
  /** The release name as the addon wrote it, for the rows nothing could be read from. */
  raw: string;
  /** Short descriptors drawn next to the languages. */
  chips: string[];
  /** False when the addon did not tag its description: fall back to its raw text. */
  parsed: boolean;
};

export function streamView(stream: AddonStream): StreamView {
  const label = parseStreamLabel(stream.name);
  const meta = parseStreamMeta(stream.title);
  const audio = meta.audio.join(" ");
  const raw = meta.release ?? stream.filename ?? stream.name;
  const chips = [label.resolution, ...meta.quality, audio].filter((c): c is string => Boolean(c));
  for (const edition of editionsOf(raw)) {
    if (!chips.some((chip) => chip.toLowerCase().includes(edition.toLowerCase()))) chips.push(edition);
  }
  return {
    stream,
    kind: USENET.test(`${label.addon ?? ""} ${meta.indexer ?? ""}`) ? "download" : "stream",
    label,
    meta,
    title: cleanReleaseName(raw),
    raw,
    chips,
    parsed: Boolean(meta.release || meta.languages.length || meta.quality.length || audio),
  };
}
