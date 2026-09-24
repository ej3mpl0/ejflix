import { createContext, useContext } from "react";
import type { Movie } from "./types";

/** A row opened as a full grid ("See all"). `loadMore` fetches the next page after `loaded` items. */
export type SeeAllRequest = {
  title: string;
  items: Movie[];
  loadMore?: (loaded: number) => Promise<Movie[]>;
  /** A custom list: the page follows its live contents and offers its actions. */
  listId?: string;
};

export const SeeAllContext = createContext<((request: SeeAllRequest) => void) | null>(null);

/** The screen's "See all" opener, or null where rows cannot open one. */
export function useSeeAll() {
  return useContext(SeeAllContext);
}
