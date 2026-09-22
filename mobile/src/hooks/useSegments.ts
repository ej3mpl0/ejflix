import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { clampSegments } from "../lib/segments";
import type { MediaSegment, Movie } from "../lib/types";

/**
 * Skippable ranges of an item, fetched once and clamped to the known duration.
 * Jellyfin items use the server (plus IntroDB); online episodes use IntroDB by IMDb id.
 */
export function useSegments(movie: Movie, duration: number, enabled: boolean): MediaSegment[] {
  const [raw, setRaw] = useState<MediaSegment[]>([]);
  const ext = movie.external;
  const key = ext ? `${ext.imdb ?? ""}:${ext.season ?? ""}:${ext.episode ?? ""}` : movie.id;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setRaw([]);
    const request = ext
      ? ext.imdb && ext.season != null && ext.episode != null
        ? api.getMediaSegmentsExternal(ext.imdb, ext.season, ext.episode)
        : Promise.resolve([] as MediaSegment[])
      : api.getMediaSegments(movie.id);
    request
      .then((list) => {
        if (alive) setRaw(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return useMemo(() => clampSegments(raw, duration), [raw, duration]);
}
