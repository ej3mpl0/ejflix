import { useCallback } from "react";
import { api } from "./api";
import type { Movie } from "./types";
import { useI18n } from "./locale-context";
import { useToast } from "./toast-context";
import { useStreamPicker } from "./stream-picker-context";
import { openDetails, openPlayer } from "../navigation/navigationRef";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Desktop `Home.play` rules:
 * - live channels and online titles with a chosen stream → player;
 * - online series → details (pick an episode there); online movies → stream picker;
 * - Jellyfin series → the episode Jellyfin suggests next, else a toast;
 * - anything else → player.
 */
export function usePlay(): (movie: Movie) => void {
  const { t } = useI18n();
  const { toast } = useToast();
  const picker = useStreamPicker();

  return useCallback(
    (movie: Movie) => {
      if (movie.live) {
        openPlayer(movie);
        return;
      }
      if (movie.external) {
        // A downloaded online title plays from the device without asking for a source.
        if (movie.external.stream || api.playableDownload(movie)) openPlayer(movie);
        else if (movie.kind === "Series") openDetails(movie);
        else picker.open(movie);
        return;
      }
      if (movie.kind === "Series") {
        api
          .getSeriesNextUp(movie.id)
          .then((episode) => {
            if (episode) openPlayer(episode);
            else toast(t("noEpisodes"));
          })
          .catch((err) => toast(errorText(err)));
        return;
      }
      openPlayer(movie);
    },
    [picker, t, toast],
  );
}
