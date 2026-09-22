import type { Chapter, TrickplayInfo, TrickplayLevel } from "./types";
import { serverImageUrl } from "../services/jellyfin/images";

/** Width (CSS px) of the preview box shown above the timeline. */
export const PREVIEW_WIDTH = 200;

/** Smallest level that is still sharp for the preview on this display, else the largest. */
export function pickLevel(info: TrickplayInfo, dpr: number): TrickplayLevel | null {
  if (!info.levels.length) return null;
  const target = PREVIEW_WIDTH * Math.max(1, dpr || 1);
  const sorted = [...info.levels].sort((a, b) => a.width - b.width);
  return sorted.find((level) => level.width >= target) ?? sorted[sorted.length - 1];
}

export type TileRef = {
  tileIndex: number;
  col: number;
  row: number;
  level: TrickplayLevel;
};

export function tileCount(level: TrickplayLevel): number {
  const perTile = level.tileWidth * level.tileHeight;
  if (perTile <= 0) return 0;
  return Math.ceil(level.thumbnailCount / perTile);
}

export function tileFor(level: TrickplayLevel, seconds: number): TileRef | null {
  if (level.interval <= 0 || level.thumbnailCount <= 0) return null;
  const perTile = level.tileWidth * level.tileHeight;
  if (perTile <= 0) return null;
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const thumb = Math.min(level.thumbnailCount - 1, Math.floor((safe * 1000) / level.interval));
  const tileIndex = Math.floor(thumb / perTile);
  const inTile = thumb % perTile;
  return {
    tileIndex,
    col: inTile % level.tileWidth,
    row: Math.floor(inTile / level.tileWidth),
    level,
  };
}

export function tileUrl(
  itemId: string,
  mediaSourceId: string,
  level: TrickplayLevel,
  tileIndex: number,
): string {
  return serverImageUrl(`/Videos/${itemId}/Trickplay/${level.width}/${tileIndex}.jpg`, { mediaSourceId });
}

export type SpriteFrame = {
  /** Size of the visible preview box. */
  width: number;
  height: number;
  /** Size to give the whole sprite image, and the offset that brings the tile into view. */
  imageWidth: number;
  imageHeight: number;
  offsetX: number;
  offsetY: number;
};

/** Geometry for rendering one tile of a trickplay sprite inside an `overflow: hidden` box. */
export function spriteFrame(ref: TileRef, previewWidth = PREVIEW_WIDTH): SpriteFrame {
  const { level, col, row } = ref;
  const scale = previewWidth / level.width;
  return {
    width: previewWidth,
    height: Math.round(level.height * scale),
    imageWidth: level.tileWidth * level.width * scale,
    imageHeight: level.tileHeight * level.height * scale,
    offsetX: col * level.width * scale,
    offsetY: row * level.height * scale,
  };
}

/** Last chapter that starts at or before `seconds`. */
export function chapterAt(chapters: Chapter[], seconds: number): Chapter | null {
  let found: Chapter | null = null;
  for (const chapter of chapters) {
    if (chapter.startSeconds <= seconds + 0.001) {
      if (!found || chapter.startSeconds >= found.startSeconds) found = chapter;
    }
  }
  return found;
}

export function chapterImageUrl(itemId: string, chapter: Chapter): string | null {
  if (!chapter.imageTag) return null;
  return serverImageUrl(`/Items/${itemId}/Images/Chapter/${chapter.index}`, { tag: chapter.imageTag, maxWidth: 400, quality: 90 });
}

export function hasChapterImages(chapters: Chapter[]): boolean {
  return chapters.some((chapter) => Boolean(chapter.imageTag));
}
