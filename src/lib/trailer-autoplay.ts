import { createContext, useContext, useEffect, useState } from "react";
import type { Movie } from "./types";
import { api } from "./api";
import { playableTrailer } from "../components/TrailerDialog";
import { useLocalizedInfo } from "./localized";

/**
 * Where a muted trailer may play right now. Home owns it: nothing plays while the player
 * runs, and the hero also stops while a page, a grid or the sources sheet covers it.
 */
export const TrailerGate = createContext<{ hero: boolean; pages: boolean }>({ hero: true, pages: true });

export function useTrailerGate() {
  return useContext(TrailerGate);
}

/** Online titles only list their trailers in the full metadata, fetched once per title. */
const onlineTrailers = new Map<string, Promise<string | null>>();

/**
 * The YouTube trailer of a title, in the content language when TMDB has one (nothing
 * until that is known, so the player does not start twice). Otherwise: Jellyfin items
 * carry it already; for an online title the addon metadata is fetched, only while
 * `wanted` (so a carousel does not query every slide).
 */
export function useTrailerUrl(movie: Movie | null | undefined, wanted: boolean): string | null {
  const localized = useLocalizedInfo(movie, wanted);
  const own = useOwnTrailerUrl(movie, wanted && localized !== undefined && !localized?.trailers.length);
  if (localized === undefined) return null;
  return (localized ? playableTrailer(localized.trailers) : null) ?? own;
}

/** The trailer the addon or the server gives. */
function useOwnTrailerUrl(movie: Movie | null | undefined, wanted: boolean): string | null {
  const known = movie ? playableTrailer(movie.remoteTrailers) : null;
  const external = movie?.external && !movie.external.stream ? movie.external : null;
  const key = external ? `${external.type}:${external.metaId}` : "";
  const [fetched, setFetched] = useState<{ key: string; url: string | null } | null>(null);

  useEffect(() => {
    if (known || !external || !wanted) return;
    let alive = true;
    let job = onlineTrailers.get(key);
    if (!job) {
      job = api
        .addonMeta(external.type, external.metaId)
        .then((meta) => playableTrailer(meta.trailers ?? []))
        .catch(() => null);
      onlineTrailers.set(key, job);
    }
    void job.then((url) => {
      if (alive) setFetched({ key, url });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known, key, wanted]);

  return known ?? (fetched && fetched.key === key ? fetched.url : null);
}
