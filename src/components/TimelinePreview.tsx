import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Movie } from "../lib/types";
import { formatClock } from "../lib/format";
import {
  PREVIEW_WIDTH,
  chapterAt,
  chapterImageUrl,
  pickLevel,
  spriteStyle,
  tileCount,
  tileFor,
  tileUrl,
  type TileRef,
} from "../lib/trickplay";

type TileStatus = "loading" | "ok" | "error";

/**
 * Scene preview shown above the timeline while hovering or scrubbing.
 * Source chain: Jellyfin trickplay sprites → chapter image → time only.
 * Mount with `key={movie.id}` so the tile cache resets per movie.
 */
export function TimelinePreview({ movie, seconds }: { movie: Movie; seconds: number }) {
  const level = useMemo(
    () => (movie.trickplay ? pickLevel(movie.trickplay, window.devicePixelRatio) : null),
    [movie.trickplay],
  );
  const tiles = useRef(new Map<number, TileStatus>());
  const images = useRef(new Map<number, HTMLImageElement>());
  const errors = useRef(0);
  const lastGood = useRef<{ ref: TileRef; url: string } | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [brokenChapters, setBrokenChapters] = useState<Set<number>>(() => new Set());
  const [, rerender] = useState(0);

  useEffect(() => {
    if (!movie.trickplay) {
      console.info(
        `[timeline] no trickplay data for "${movie.name}" (${movie.id}); falling back to chapter images / time only`,
      );
    }
  }, [movie.id, movie.name, movie.trickplay]);

  const ref = level && !disabled ? tileFor(level, seconds) : null;
  const total = level ? tileCount(level) : 0;
  const mediaSourceId = movie.trickplay?.mediaSourceId ?? "";

  useEffect(() => {
    if (!ref || !level) return;
    const ensure = (index: number) => {
      if (index < 0 || index >= total || tiles.current.has(index)) return;
      tiles.current.set(index, "loading");
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        tiles.current.set(index, "ok");
        errors.current = 0;
        images.current.set(index, img);
        // Keep at most three decoded sprites around (current ± 1).
        for (const key of [...images.current.keys()]) {
          if (Math.abs(key - index) > 1) images.current.delete(key);
        }
        rerender((n) => n + 1);
      };
      img.onerror = () => {
        tiles.current.set(index, "error");
        errors.current += 1;
        console.warn(`[timeline] trickplay tile failed to load: ${img.src}`);
        if (index === 0 || errors.current >= 2) setDisabled(true);
        rerender((n) => n + 1);
      };
      img.src = tileUrl(movie.id, mediaSourceId, level, index);
    };
    ensure(ref.tileIndex);
    ensure(ref.tileIndex + 1);
    ensure(ref.tileIndex - 1);
  }, [ref?.tileIndex, level, total, movie.id, mediaSourceId]);

  const chapter = chapterAt(movie.chapters, seconds);
  const chapterImage =
    chapter && !brokenChapters.has(chapter.index) ? chapterImageUrl(movie.id, chapter) : null;

  let picture: ReactNode = null;
  if (ref && level) {
    const status = tiles.current.get(ref.tileIndex);
    if (status === "ok") {
      const url = tileUrl(movie.id, mediaSourceId, level, ref.tileIndex);
      lastGood.current = { ref, url };
      picture = <div className="preview-box" style={spriteStyle(ref, url)} />;
    } else if (lastGood.current) {
      // Keep the last decoded frame while the next sprite loads (no flicker).
      picture = <div className="preview-box" style={spriteStyle(lastGood.current.ref, lastGood.current.url)} />;
    } else {
      picture = (
        <div
          className="preview-box bg-black"
          style={{ width: PREVIEW_WIDTH, height: Math.round((level.height / level.width) * PREVIEW_WIDTH) }}
        />
      );
    }
  } else if (chapterImage && chapter) {
    picture = (
      <img
        src={chapterImage}
        alt=""
        className="preview-box aspect-video object-cover"
        style={{ width: PREVIEW_WIDTH }}
        onError={() => {
          console.warn(`[timeline] chapter image failed to load: ${chapterImage}`);
          setBrokenChapters((set) => new Set(set).add(chapter.index));
        }}
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      {picture}
      <div className="flex max-w-[220px] flex-col items-center rounded-md bg-black/80 px-2.5 py-1 text-center backdrop-blur-sm">
        {chapter?.name ? (
          <span className="w-full truncate text-[11px] leading-4 text-white/80">{chapter.name}</span>
        ) : null}
        <span className="text-[12px] leading-4 font-medium text-white tabular">{formatClock(seconds)}</span>
      </div>
    </div>
  );
}
