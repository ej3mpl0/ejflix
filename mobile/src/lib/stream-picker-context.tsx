import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Movie } from "./types";
import { openDetails } from "../navigation/navigationRef";
import { StreamPickerSheet } from "../components/media/StreamPickerSheet";

type StreamPickerValue = {
  /** Opens the online-sources sheet for an item that carries `external`. */
  open: (movie: Movie) => void;
  close: () => void;
  /** Item currently shown (null when closed). */
  movie: Movie | null;
};

/**
 * Without a provider the picker degrades to the details page of the title, which
 * mounts its own provider and offers Play → sources from there.
 */
const fallback: StreamPickerValue = { open: (movie) => openDetails(movie), close: () => undefined, movie: null };

const StreamPickerContext = createContext<StreamPickerValue>(fallback);

/**
 * Hosts one `StreamPickerSheet` above its children. Mount it once in `App.tsx`
 * (preferred) or per screen; `usePlay()` and the item menus open it through
 * `useStreamPicker()`.
 */
export function StreamPickerProvider({ children }: { children: ReactNode }) {
  const [movie, setMovie] = useState<Movie | null>(null);
  const open = useCallback((next: Movie) => {
    if (!next.external) return;
    setMovie(next);
  }, []);
  const close = useCallback(() => setMovie(null), []);
  const value = useMemo<StreamPickerValue>(() => ({ open, close, movie }), [open, close, movie]);
  return (
    <StreamPickerContext.Provider value={value}>
      {children}
      <StreamPickerSheet movie={movie} visible={movie != null} onClose={close} />
    </StreamPickerContext.Provider>
  );
}

export function useStreamPicker(): StreamPickerValue {
  return useContext(StreamPickerContext);
}
