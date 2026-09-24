/**
 * Jellyfin item → `Movie` mapping, ported from `jellyfin.rs::map_item` and friends.
 * Pure module: only touches the image URL builder (which is configured by the session).
 */
import type { Chapter, MediaSourceInfo, Movie, Person, TrickplayInfo, TrickplayLevel } from "../../lib/types";
import { imageUrl, type ImageKind } from "./images";

export const ITEM_FIELDS =
  "Overview,Genres,MediaStreams,MediaSources,ProductionYear,RunTimeTicks,OfficialRating,CommunityRating,CriticRating,People,ImageTags,BackdropImageTags,DateCreated,Studios,ProviderIds,RemoteTrailers,ChildCount,Status,Taglines,EndDate";

/** Fields for a single item: adds trickplay tiles and chapters (player timeline). */
export const DETAIL_FIELDS = `${ITEM_FIELDS},Trickplay,Chapters`;

type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function str(source: Json | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" ? value : null;
}

/** Non-empty string. */
function text(source: Json | null, key: string): string | null {
  const value = str(source, key);
  return value ? value : null;
}

function int(source: Json | null, key: string): number | null {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function num(source: Json | null, key: string): number | null {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(source: Json | null, key: string): boolean | null {
  const value = source?.[key];
  return typeof value === "boolean" ? value : null;
}

function arr(source: Json | null, key: string): unknown[] {
  const value = source?.[key];
  return Array.isArray(value) ? value : [];
}

/** `jellyfin.rs::image_url`: every kind but Primary needs a tag. */
function image(id: string, kind: ImageKind, maxWidth: number, tag: string | null | undefined): string | null {
  if (kind !== "Primary" && !tag) return null;
  const url = imageUrl(id, kind, maxWidth, tag ?? undefined);
  return url || null;
}

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

export type StreamQuality = {
  badges: string[];
  videoLabel: string | null;
  audioLabel: string | null;
  subtitleLabels: string[];
};

/** Quality badges and labels from `MediaStreams` (`jellyfin.rs::quality_from_streams`). */
export function qualityFromStreams(streams: unknown[]): StreamQuality {
  const badges: string[] = [];
  let videoLabel: string | null = null;
  let audioLabel: string | null = null;
  const subtitleLabels: string[] = [];

  for (const raw of streams) {
    const stream = obj(raw);
    if (!stream) continue;
    const kind = str(stream, "Type") ?? "";
    if (kind === "Video") {
      const width = int(stream, "Width") ?? 0;
      const height = int(stream, "Height") ?? 0;
      const codec = (str(stream, "Codec") ?? "").toUpperCase();
      const profile = str(stream, "Profile") ?? "";
      const range = str(stream, "VideoRangeType") ?? str(stream, "VideoRange") ?? "";
      if (width >= 3840 || height >= 2160) pushUnique(badges, "4K");
      else if (width >= 1920) pushUnique(badges, "1080P");
      const rangeUpper = range.toUpperCase();
      if (rangeUpper.includes("DOVI") || rangeUpper.includes("DOLBY")) pushUnique(badges, "DOLBY VISION");
      else if (rangeUpper.includes("HDR10+")) pushUnique(badges, "HDR10+");
      else if (rangeUpper.includes("HDR10")) pushUnique(badges, "HDR10");
      else if (rangeUpper.includes("HLG")) pushUnique(badges, "HLG");
      else if (rangeUpper.includes("HDR")) pushUnique(badges, "HDR");
      videoLabel = `${width}×${height} ${codec}${profile ? ` ${profile}` : ""}${range ? ` · ${range}` : ""}`;
    } else if (kind === "Audio") {
      const codec = str(stream, "Codec") ?? "";
      const title = str(stream, "DisplayTitle") ?? "";
      const layout = str(stream, "ChannelLayout") ?? "";
      const channels = int(stream, "Channels") ?? 0;
      const blob = `${codec} ${title} ${layout}`.toLowerCase();
      if (blob.includes("atmos")) pushUnique(badges, "ATMOS");
      if (layout.includes("7.1") || channels >= 8) pushUnique(badges, "7.1");
      else if (layout.includes("5.1") || channels === 6) pushUnique(badges, "5.1");
      if (audioLabel == null) {
        audioLabel = title ? title : `${codec.toUpperCase()} ${layout}`;
      }
    } else if (kind === "Subtitle") {
      subtitleLabels.push(str(stream, "DisplayTitle") ?? str(stream, "Language") ?? "Subtítulo");
    }
  }
  return { badges, videoLabel, audioLabel, subtitleLabels };
}

/** `jellyfin.rs::parse_trickplay`: levels of the playing media source (else the first one). */
export function parseTrickplay(value: unknown, mediaSourceId: string | null): TrickplayInfo | null {
  const map = obj(value);
  if (!map) return null;
  const keys = Object.keys(map);
  if (keys.length === 0) return null;
  const key = mediaSourceId && mediaSourceId in map ? mediaSourceId : keys[0];
  const levels = obj(map[key]);
  if (!levels) return null;
  const u32 = (level: Json, name: string): number => {
    const n = level[name];
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
  };
  const parsed: TrickplayLevel[] = [];
  for (const raw of Object.values(levels)) {
    const level = obj(raw);
    if (!level) continue;
    const info: TrickplayLevel = {
      width: u32(level, "Width"),
      height: u32(level, "Height"),
      tileWidth: u32(level, "TileWidth"),
      tileHeight: u32(level, "TileHeight"),
      thumbnailCount: u32(level, "ThumbnailCount"),
      interval: u32(level, "Interval"),
      bandwidth: u32(level, "Bandwidth"),
    };
    const valid =
      info.width > 0 &&
      info.height > 0 &&
      info.tileWidth > 0 &&
      info.tileHeight > 0 &&
      info.thumbnailCount > 0 &&
      info.interval > 0;
    if (valid) parsed.push(info);
  }
  if (parsed.length === 0) return null;
  parsed.sort((a, b) => a.width - b.width);
  return { mediaSourceId: key, levels: parsed };
}

/** `jellyfin.rs::parse_chapters`. */
export function parseChapters(value: unknown): Chapter[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const chapter = obj(raw);
    return {
      index,
      startSeconds: (num(chapter, "StartPositionTicks") ?? 0) / 10_000_000,
      name: text(chapter, "Name"),
      imageTag: text(chapter, "ImageTag"),
    };
  });
}

/** Maps a Jellyfin `BaseItemDto` to a `Movie`; throws "Ítem sin id" without an `Id`. */
export function mapItem(value: unknown): Movie {
  const item = obj(value);
  const id = text(item, "Id");
  if (!item || !id) throw new Error("Ítem sin id");

  const imageTags = obj(item.ImageTags);
  const backdropTags = arr(item, "BackdropImageTags").filter((t): t is string => typeof t === "string");
  const userData = obj(item.UserData);
  const streams = arr(item, "MediaStreams");

  const mediaSources: (MediaSourceInfo & { container: string })[] = [];
  for (const raw of arr(item, "MediaSources")) {
    const source = obj(raw);
    const sourceId = text(source, "Id");
    if (!sourceId) continue;
    const container = text(source, "Container") ?? "mkv";
    const name = text(source, "Name") ?? container.toUpperCase();
    mediaSources.push({ id: sourceId, name, container });
  }
  const mediaSourceId = mediaSources[0]?.id ?? null;

  const people = arr(item, "People").map(obj).filter((p): p is Json => p != null);
  const namesOf = (kind: string): string[] =>
    people
      .filter((p) => str(p, "Type") === kind)
      .map((p) => str(p, "Name"))
      .filter((n): n is string => n != null);
  const cast: Person[] = [];
  for (const person of people) {
    if (str(person, "Type") !== "Actor") continue;
    const personId = str(person, "Id");
    const name = str(person, "Name");
    if (!personId || !name) continue;
    const tag = text(person, "PrimaryImageTag");
    cast.push({
      id: personId,
      name,
      role: text(person, "Role"),
      kind: "Actor",
      // Only when the person has a picture (avoids 404 spam).
      imageUrl: tag ? image(personId, "Primary", 240, tag) : null,
    });
    if (cast.length >= 20) break;
  }
  const studios = arr(item, "Studios")
    .map((s) => str(obj(s), "Name"))
    .filter((n): n is string => n != null);
  const providerIds: Record<string, string> = {};
  const providers = obj(item.ProviderIds);
  if (providers) {
    for (const [key, raw] of Object.entries(providers)) {
      if (typeof raw === "string") providerIds[key] = raw;
    }
  }
  const remoteTrailers = arr(item, "RemoteTrailers")
    .map((t) => str(obj(t), "Url"))
    .filter((u): u is string => u != null);

  const { badges, videoLabel, audioLabel, subtitleLabels } = qualityFromStreams(streams);
  const trickplay = parseTrickplay(item.Trickplay, mediaSourceId);
  const chapters = parseChapters(item.Chapters);

  const kind = str(item, "Type") ?? "Movie";
  const isEpisode = kind === "Episode";
  const seriesId = str(item, "SeriesId");
  const primaryTag = str(imageTags, "Primary");
  // Episodes: the series poster stands in as "poster"; their own Primary is a 16:9 still.
  let posterUrl: string | null;
  if (isEpisode) {
    const seriesTag = str(item, "SeriesPrimaryImageTag");
    posterUrl = seriesId && seriesTag ? image(seriesId, "Primary", 400, seriesTag) : null;
  } else {
    posterUrl = image(id, "Primary", 400, primaryTag);
  }
  const thumbUrl = isEpisode && primaryTag ? image(id, "Primary", 640, primaryTag) : null;
  let backdropUrl = backdropTags.length > 0 ? image(id, "Backdrop", 1920, backdropTags[0]) : null;
  if (!backdropUrl) {
    const parentId = str(item, "ParentBackdropItemId");
    const parentTags = arr(item, "ParentBackdropImageTags");
    const parentTag = typeof parentTags[0] === "string" ? parentTags[0] : null;
    if (parentId && parentTag) backdropUrl = image(parentId, "Backdrop", 1920, parentTag);
  }
  let logoUrl = image(id, "Logo", 600, str(imageTags, "Logo"));
  if (!logoUrl) {
    const parentId = str(item, "ParentLogoItemId");
    const parentTag = str(item, "ParentLogoImageTag");
    if (parentId && parentTag) logoUrl = image(parentId, "Logo", 600, parentTag);
  }

  const taglines = arr(item, "Taglines");
  const tagline = typeof taglines[0] === "string" && taglines[0] !== "" ? taglines[0] : null;
  const endDate = str(item, "EndDate");
  const endYearRaw = endDate ? Number.parseInt(endDate.slice(0, 4), 10) : Number.NaN;
  const endYear = endDate && endDate.length >= 4 && /^\d{4}$/.test(endDate.slice(0, 4)) ? endYearRaw : null;

  return {
    id,
    kind,
    seriesId,
    seriesName: str(item, "SeriesName"),
    seasonId: str(item, "SeasonId"),
    seasonNumber: isEpisode ? int(item, "ParentIndexNumber") : kind === "Season" ? int(item, "IndexNumber") : null,
    episodeNumber: isEpisode ? int(item, "IndexNumber") : null,
    thumbUrl,
    name: str(item, "Name") ?? "Sin título",
    overview: str(item, "Overview"),
    year: int(item, "ProductionYear"),
    runtimeTicks: int(item, "RunTimeTicks"),
    officialRating: str(item, "OfficialRating"),
    communityRating: num(item, "CommunityRating"),
    criticRating: num(item, "CriticRating"),
    genres: arr(item, "Genres").filter((g): g is string => typeof g === "string"),
    posterUrl,
    backdropUrl,
    logoUrl,
    playbackPositionTicks: int(userData, "PlaybackPositionTicks") ?? 0,
    playedPercentage: num(userData, "PlayedPercentage") ?? 0,
    favorite: bool(userData, "IsFavorite") ?? false,
    played: bool(userData, "Played") ?? false,
    unplayedCount: int(userData, "UnplayedItemCount"),
    badges,
    videoLabel,
    audioLabel,
    subtitleLabels,
    directors: namesOf("Director"),
    writers: namesOf("Writer"),
    studios,
    cast,
    providerIds,
    remoteTrailers,
    childCount: int(item, "ChildCount"),
    status: str(item, "Status"),
    tagline,
    endYear,
    mediaSourceId,
    mediaSources: mediaSources.map(({ id: sourceId, name }) => ({ id: sourceId, name })),
    dateCreated: str(item, "DateCreated"),
    premiereDate: str(item, "PremiereDate"),
    trickplay,
    chapters,
  };
}

/** Container of a media source as reported by the server (used for the direct stream URL). */
export function mediaSourceContainer(value: unknown, mediaSourceId: string | null): string {
  const item = obj(value);
  for (const raw of arr(item, "MediaSources")) {
    const source = obj(raw);
    if (!source) continue;
    if (mediaSourceId == null || str(source, "Id") === mediaSourceId) {
      return text(source, "Container") ?? "mkv";
    }
  }
  return "mkv";
}
