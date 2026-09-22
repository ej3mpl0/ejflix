import React, { useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, Text, View } from "react-native";
import { Image } from "expo-image";
import type { Movie } from "../../lib/types";
import { formatClock } from "../../lib/format";
import {
  PREVIEW_WIDTH,
  chapterAt,
  chapterImageUrl,
  pickLevel,
  spriteFrame,
  tileCount,
  tileFor,
  tileUrl,
  type TileRef,
} from "../../lib/trickplay";
import { makeStyles } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";

type TileStatus = "loading" | "ok" | "error";

/**
 * Scene preview shown above the timeline while scrubbing.
 * Source chain: Jellyfin trickplay sprites → chapter image → time only.
 * Mount with `key={movie.id}` so the tile cache resets per movie.
 * `delta` (seconds) switches the caption to `+1:24 / 12:30` for the pan-to-seek gesture.
 */
export function TimelinePreview({
  movie,
  seconds,
  delta = null,
  width = PREVIEW_WIDTH,
}: {
  movie: Movie;
  seconds: number;
  delta?: number | null;
  width?: number;
}) {
  const s = useStyles();
  const level = useMemo(() => (movie.trickplay ? pickLevel(movie.trickplay, PixelRatio.get()) : null), [movie.trickplay]);
  const tiles = useRef(new Map<number, TileStatus>());
  const errors = useRef(0);
  const lastGood = useRef<TileRef | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [brokenChapters, setBrokenChapters] = useState<Set<number>>(() => new Set());
  const [, rerender] = useState(0);

  const ref = level && !disabled ? tileFor(level, seconds) : null;
  const total = level ? tileCount(level) : 0;
  const mediaSourceId = movie.trickplay?.mediaSourceId ?? "";
  const tileIndex = ref?.tileIndex ?? -1;

  useEffect(() => {
    if (tileIndex < 0 || !level) return;
    let alive = true;
    const ensure = (index: number) => {
      if (index < 0 || index >= total || tiles.current.has(index)) return;
      tiles.current.set(index, "loading");
      const url = tileUrl(movie.id, mediaSourceId, level, index);
      Image.prefetch(url)
        .then((ok) => {
          if (!alive) return;
          if (ok) {
            tiles.current.set(index, "ok");
            errors.current = 0;
          } else {
            tiles.current.set(index, "error");
            errors.current += 1;
            if (index === 0 || errors.current >= 2) setDisabled(true);
          }
          rerender((n) => n + 1);
        })
        .catch(() => {
          if (!alive) return;
          tiles.current.set(index, "error");
          errors.current += 1;
          if (index === 0 || errors.current >= 2) setDisabled(true);
          rerender((n) => n + 1);
        });
    };
    ensure(tileIndex);
    ensure(tileIndex + 1);
    ensure(tileIndex - 1);
    return () => {
      alive = false;
    };
  }, [tileIndex, level, total, movie.id, mediaSourceId]);

  const chapter = chapterAt(movie.chapters, seconds);
  const chapterImage = chapter && !brokenChapters.has(chapter.index) ? chapterImageUrl(movie.id, chapter) : null;

  let picture: React.ReactNode = null;
  if (ref && level) {
    const status = tiles.current.get(ref.tileIndex);
    const shown = status === "ok" ? ref : lastGood.current;
    if (status === "ok") lastGood.current = ref;
    if (shown) {
      const frame = spriteFrame(shown, width);
      picture = (
        <View style={[s.box, { width: frame.width, height: frame.height }]}>
          <Image
            source={{ uri: tileUrl(movie.id, mediaSourceId, shown.level, shown.tileIndex) }}
            contentFit="fill"
            cachePolicy="memory-disk"
            style={{
              position: "absolute",
              width: frame.imageWidth,
              height: frame.imageHeight,
              left: -frame.offsetX,
              top: -frame.offsetY,
            }}
          />
        </View>
      );
    } else {
      picture = <View style={[s.box, { width, height: Math.round((level.height / level.width) * width) }]} />;
    }
  } else if (chapterImage && chapter) {
    picture = (
      <View style={[s.box, { width, height: Math.round((width * 9) / 16) }]}>
        <Image
          source={{ uri: chapterImage }}
          contentFit="cover"
          style={{ width: "100%", height: "100%" }}
          onError={() => setBrokenChapters((set) => new Set(set).add(chapter.index))}
        />
      </View>
    );
  }

  const clock =
    delta != null ? `${delta >= 0 ? "+" : "-"}${formatClock(Math.abs(delta))} / ${formatClock(seconds)}` : formatClock(seconds);

  return (
    <View style={s.root}>
      {picture}
      <View style={s.caption}>
        {chapter?.name ? (
          <Text numberOfLines={1} style={s.chapter}>
            {chapter.name}
          </Text>
        ) : null}
        <Text style={s.clock}>{clock}</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { alignItems: "center", gap: 6 },
  box: {
    overflow: "hidden",
    borderRadius: 8,
    backgroundColor: "#000000",
    borderWidth: 1,
    borderColor: t.white(0.15),
  },
  caption: { maxWidth: 220, alignItems: "center", borderRadius: 6, backgroundColor: t.black(0.8), paddingHorizontal: 10, paddingVertical: 4 },
  chapter: { ...text(11, "regular", { lineHeight: 16 }), color: t.white(0.8) },
  clock: { ...text(12, "medium", { lineHeight: 16, tabular: true }), color: t.colors.text },
}));
