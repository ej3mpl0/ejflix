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
  /** Where the page grows from (the clicked poster), in viewport pixels. */
  origin: { x: number; y: number } | null;
  leaving?: boolean;
};

/** Normalises any item into a details route: episodes open their series. */
export function routeFor(movie: Movie): DetailsRoute {
  const origin = originOf(movie.id);
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

function originOf(itemId: string): { x: number; y: number } | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(itemId)}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
