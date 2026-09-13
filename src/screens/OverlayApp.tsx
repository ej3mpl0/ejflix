import { useEffect, useState } from "react";
import { Player } from "./Player";
import { api } from "../lib/api";
import { useSettings } from "../lib/settings-context";
import type { Movie } from "../lib/types";

export function OverlayApp() {
  const [movie, setMovie] = useState<Movie | null>(null);
  const { reload } = useSettings();

  useEffect(() => {
    document.body.classList.remove("opaque");
    document.body.style.cursor = "";
    const open = api.onPlayerOpen((next) => {
      // The profile may have changed since the last playback: refresh the settings copy.
      void reload();
      setMovie(next);
    });
    const close = api.onPlayerClose(() => setMovie(null));
    return () => {
      void open.then((fn) => fn());
      void close.then((fn) => fn());
    };
  }, [reload]);

  if (!movie) {
    return <div className="h-full w-full bg-transparent" />;
  }

  return (
    <Player
      key={movie.id}
      movie={movie}
      mode="overlay"
      onExit={() => void api.exitPlayer()}
      onError={() => void api.exitPlayer()}
    />
  );
}
