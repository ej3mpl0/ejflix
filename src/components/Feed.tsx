import type { ReactNode } from "react";
import { HeroCarousel } from "./HeroCarousel";
import { PosterRow } from "./PosterRow";
import { AddonRows } from "./AddonRows";
import type { HomeData, Movie } from "../lib/types";
import { useI18n } from "../lib/locale-context";

/** Home feed: hero carousel plus rows. Used for the main Home and for each library tab. */
export function Feed({
  data,
  tv,
  featured,
  myList = [],
  onlineResume = [],
  showAddons = false,
  empty = null,
  onOpen,
  onPlay,
}: {
  data: HomeData;
  /** TV library: rows talk about series and episodes. */
  tv: boolean;
  /** Hero items; defaults to the server's featured list. */
  featured?: Movie[];
  /** Favorites row (main Home only). */
  myList?: Movie[];
  /** Online titles with a remembered position (main Home only). */
  onlineResume?: Movie[];
  /** Rails from the Stremio addon catalogs (main Home only). */
  showAddons?: boolean;
  /** Shown under the (absent) hero when there is nothing at all to list. */
  empty?: ReactNode;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const inProgress = new Set(data.resume.map((movie) => movie.id));
  const nextUp = data.nextUp.filter((movie) => !inProgress.has(movie.id));
  const hero = featured ?? data.featured;
  const hasRows =
    data.resume.length || onlineResume.length || nextUp.length || myList.length || data.latest.length || data.genres.length || data.all.length || showAddons;

  return (
    <>
      {hero.length ? (
        <HeroCarousel items={hero} onPlay={onPlay} onDetails={onOpen} />
      ) : (
        <div className="h-24" />
      )}
      <div className="enter enter-d4 relative z-10 space-y-section pt-6 pb-16">
        {!hero.length && !hasRows ? empty : null}
        {data.resume.length ? (
          <PosterRow
            title={t("continueWatching")}
            items={data.resume}
            variant="continue"
            onOpen={onOpen}
            onPlay={onPlay}
          />
        ) : null}
        {onlineResume.length ? (
          <PosterRow
            title={t("continueWatchingOnline")}
            items={onlineResume}
            variant="continue"
            onOpen={onOpen}
            onPlay={onPlay}
          />
        ) : null}
        {nextUp.length ? (
          <PosterRow title={t("nextUp")} items={nextUp} variant="nextUp" onOpen={onOpen} onPlay={onPlay} />
        ) : null}
        {myList.length ? <PosterRow title={t("myList")} items={myList} onOpen={onOpen} onPlay={onPlay} /> : null}
        {data.latest.length ? (
          <PosterRow title={t("recentlyAdded")} items={data.latest} onOpen={onOpen} onPlay={onPlay} />
        ) : null}
        {showAddons ? <AddonRows onOpen={onOpen} onPlay={onPlay} empty={hero.length ? null : empty} /> : null}
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
