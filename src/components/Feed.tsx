import { HeroBanner } from "./HeroBanner";
import { PosterRow } from "./PosterRow";
import type { HomeData, Movie } from "../lib/types";
import { useI18n } from "../lib/locale-context";

/** Netflix-style feed: hero plus rows. Used for the main Home and for each library tab. */
export function Feed({
  data,
  tv,
  onOpen,
  onPlay,
}: {
  data: HomeData;
  /** TV library: rows talk about series and episodes. */
  tv: boolean;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const inProgress = new Set(data.resume.map((movie) => movie.id));
  const nextUp = data.nextUp.filter((movie) => !inProgress.has(movie.id));

  return (
    <>
      {data.featured ? (
        <HeroBanner movie={data.featured} onPlay={onPlay} onMore={onOpen} />
      ) : (
        <div className="h-24" />
      )}
      <div className="enter enter-d4 relative z-10 -mt-6 pb-16">
        {data.resume.length ? (
          <PosterRow
            title={t("continueWatching")}
            items={data.resume}
            variant="continue"
            onOpen={onOpen}
            onPlay={onPlay}
          />
        ) : null}
        {nextUp.length ? (
          <PosterRow title={t("nextUp")} items={nextUp} variant="continue" onOpen={onOpen} onPlay={onPlay} />
        ) : null}
        {data.latest.length ? (
          <PosterRow title={t("recentlyAdded")} items={data.latest} onOpen={onOpen} onPlay={onPlay} />
        ) : null}
        {data.genres.map((row) => (
          <PosterRow key={row.id} title={row.name} items={row.items} onOpen={onOpen} onPlay={onPlay} />
        ))}
        {data.all.length ? (
          <PosterRow
            title={tv ? t("allSeries") : t("allMovies")}
            items={data.all}
            onOpen={onOpen}
            onPlay={onPlay}
          />
        ) : null}
      </div>
    </>
  );
}
