import { useEffect, useState } from "react";
import type { Movie, RecommendationRow } from "../lib/types";
import { api } from "../lib/api";
import { useI18n } from "../lib/locale-context";
import type { MessageKey } from "../lib/i18n";
import { useCustomLists } from "../lib/lists-context";
import { useCalendar } from "../lib/calendar";
import { PosterRow } from "./PosterRow";

/** Home rows of the profile's own things: custom lists, new episodes, recommendations. */
export type PersonalProps = {
  userId: string;
  hasServer: boolean;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
};

/** One row per custom list; "See all" opens the list page with its actions. */
export function CustomListRows({ hasServer, onOpen, onPlay }: PersonalProps) {
  const { lists, moviesOf } = useCustomLists();
  return (
    <>
      {lists.map((list) => {
        // Server items cannot open without the server they came from.
        const items = moviesOf(list).filter((movie) => hasServer || movie.external);
        if (!items.length) return null;
        return (
          <PosterRow
            key={list.id}
            title={list.name}
            items={items}
            seeAll={{ title: list.name, items, listId: list.id }}
            onOpen={onOpen}
            onPlay={onPlay}
          />
        );
      })}
    </>
  );
}

/** Episodes of followed series aired since the calendar was last opened. */
export function NewEpisodesRow({ userId, hasServer, onOpen, onPlay }: PersonalProps) {
  const { t } = useI18n();
  const { fresh } = useCalendar(hasServer, userId);
  if (!fresh.length) return null;
  return (
    <PosterRow
      title={t("newEpisodes")}
      caption={t("newEpisodesCaption")}
      items={fresh.map((entry) => entry.episode)}
      variant="new"
      onOpen={onOpen}
      onPlay={onPlay}
    />
  );
}

/** Title and reason of a Jellyfin recommendation row, by what it grew from. */
const REASONS: Record<string, { title: MessageKey; caption: MessageKey }> = {
  SimilarToRecentlyPlayed: { title: "recommendedForYou", caption: "becauseYouWatched" },
  SimilarToLikedItem: { title: "recommendedForYou", caption: "becauseYouLiked" },
  HasDirectorFromRecentlyPlayed: { title: "sameDirector", caption: "directedBy" },
  HasDirectorFromLikedItem: { title: "sameDirector", caption: "directedBy" },
  HasActorFromRecentlyPlayed: { title: "sameCast", caption: "starring" },
  HasActorFromLikedItem: { title: "sameCast", caption: "starring" },
};

/** Jellyfin's recommendation rows, each saying why it is there. */
export function RecommendationRows({ hasServer, onOpen, onPlay }: PersonalProps) {
  const { t } = useI18n();
  const [rows, setRows] = useState<RecommendationRow[]>([]);
  /** Bumped when the age limit changes: the server filters these rows by it. */
  const [limitVersion, setLimitVersion] = useState(0);

  useEffect(() => {
    const unlisten = api.onParentalChanged(() => setLimitVersion((n) => n + 1));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!hasServer) {
      setRows([]);
      return;
    }
    let alive = true;
    api
      .getRecommendations()
      .then((list) => {
        if (alive) setRows(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hasServer, limitVersion]);

  return (
    <>
      {rows.map((row) => {
        const reason = REASONS[row.kind];
        // Only rows whose reason is known get a caption; the rest are not shown at all.
        if (!reason) return null;
        return (
          <PosterRow
            key={`${row.kind}:${row.baseline}`}
            title={t(reason.title)}
            caption={t(reason.caption, { name: row.baseline })}
            items={row.items}
            onOpen={onOpen}
            onPlay={onPlay}
          />
        );
      })}
    </>
  );
}
