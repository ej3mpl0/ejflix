import type { ItemKind, Movie } from "./types";
import { seriesSeedOf } from "./addons";

/** One details page on top of Home. */
export type DetailsRoute = {
  key: number;
  id: string;
  kind: ItemKind | string;
  /** Season to open first (episode clicked from a rail). */
  seasonId: string | null;
  /** Item data already at hand, painted while the full detail loads. */
  seed: Movie | null;
  /** Kept for parity with the desktop routes; always null on mobile. */
  origin: { x: number; y: number } | null;
};

/** Normalises any item into a details route: episodes open their series. */
export function routeFor(movie: Movie): DetailsRoute {
  const origin = null;
  if (movie.external) {
    const seed = movie.kind === "Episode" ? seriesSeedOf(movie) : movie;
    return { key: Date.now(), id: seed.id, kind: seed.kind, seasonId: null, seed, origin };
  }
  if (movie.kind === "Episode" && movie.seriesId) {
    return {
      key: Date.now(),
      id: movie.seriesId,
      kind: "Series",
      seasonId: movie.seasonId,
      seed: null,
      origin,
    };
  }
  return { key: Date.now(), id: movie.id, kind: movie.kind, seasonId: null, seed: movie, origin };
}
