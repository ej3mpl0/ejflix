import { useEffect, useState } from "react";
import { Player } from "./Player";
import { api } from "../lib/api";
import type { Movie } from "../lib/types";

export function OverlayApp() {
  const [movie, setMovie] = useState<Movie | null>(null);

  useEffect(() => {
    document.body.classList.remove("opaque");
    document.body.style.cursor = "";
    const open = api.onPlayerOpen(setMovie);
    const close = api.onPlayerClose(() => setMovie(null));
    return () => {
      void open.then((fn) => fn());
      void close.then((fn) => fn());
    };
  }, []);

  if (!movie) {
    return <div className="h-full w-full bg-transparent" />;
  }

  return (
    <Player
      movie={movie}
      mode="overlay"
      onExit={() => void api.exitPlayer()}
      onError={() => void api.exitPlayer()}
    />
  );
}
