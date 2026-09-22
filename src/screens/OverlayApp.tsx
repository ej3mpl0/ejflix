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
    let seq = 0;
    const open = api.onPlayerOpen((next) => {
      // The profile may have changed since the last playback: refresh the settings copy
      // before the player mounts, so it starts with this profile's volume, speed, subtitles.
      const mine = ++seq;
      void reload()
        .catch(() => undefined)
        .then(() => {
          if (mine === seq) setMovie(next);
        });
    });
    const close = api.onPlayerClose(() => {
      seq += 1;
      setMovie(null);
    });
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
