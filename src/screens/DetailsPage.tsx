import { useEffect, useRef, useState } from "react";
import { Clapperboard, Globe, ListPlus, ListVideo, Play, RotateCcw, Shuffle } from "lucide-react";
import type { Movie, Person } from "../lib/types";
import type { DetailsRoute } from "../lib/view-stack";
import { api } from "../lib/api";
import { externalRefForJellyfin } from "../lib/addons";
import { cn, episodeCode, formatClock, ticksToSeconds } from "../lib/format";
import { chapterImageUrl, hasChapterImages } from "../lib/trickplay";
import { useDominantColor } from "../lib/dominant-color";
import { useBackNavigation } from "../lib/use-back";
import { useI18n } from "../lib/locale-context";
import { errorText } from "../lib/errors";
import { isParentalBlocked } from "../lib/parental";
import { RestrictedNotice } from "../components/RestrictedNotice";
import { useSettings } from "../lib/settings-context";
import { useUserData } from "../lib/userdata-context";
import { Pill } from "../components/Pill";
import { FavoriteButton } from "../components/FavoriteButton";
import { WatchedButton } from "../components/WatchedButton";
import { MetaChips } from "../components/MetaChips";
import { CastRow } from "../components/CastRow";
import { SeasonChips } from "../components/SeasonChips";
import { EpisodeList } from "../components/EpisodeList";
import { SimilarRail } from "../components/SimilarRail";
import { ProductionInfo } from "../components/ProductionInfo";
import { FloatingTitleBar } from "../components/FloatingTitleBar";
import { DetailsSkeleton, EpisodeListSkeleton } from "../components/Skeletons";
import { ScrollRow } from "../components/ScrollRow";
import { TrailerDialog, playableTrailer } from "../components/TrailerDialog";
import { PersonDialog } from "../components/PersonDialog";
import { TrailerBackdrop, TrailerMuteButton, type TrailerPhase } from "../components/TrailerBackdrop";
import { useTrailerGate } from "../lib/trailer-autoplay";
import { useArtworkAccent } from "../lib/auto-accent";
import { useCustomLists } from "../lib/lists-context";
import { startShuffle } from "../lib/play-queue";

/**
 * Full details page (movie or series) stacked over Home. Owns its scroller so Home keeps
 * its position; Escape, the header arrow and the mouse back button pop it.
 */
export function DetailsPage({
  route,
  top,
  refreshToken = 0,
  onBack,
  onPush,
  onPlay,
  onOnline,
}: {
  route: DetailsRoute;
  /** Only the topmost page reacts to back navigation. */
  top: boolean;
  /** Bumped after playback: the resume point and the next episode moved. */
  refreshToken?: number;
  onBack: () => void;
  onPush: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  /** Open the online sources (addon streams) of a Jellyfin title with an IMDb id. */
  onOnline: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const { settings } = useSettings();
  const { version: userDataVersion } = useUserData();
  const { openPicker } = useCustomLists();
  /** "Play all" / "Shuffle" waiting for the server. */
  const [starting, setStarting] = useState<"all" | "shuffle" | null>(null);
  const [startError, setStartError] = useState("");
  const [detail, setDetail] = useState<Movie | null>(route.seed);
  const [seasons, setSeasons] = useState<Movie[]>([]);
  const [seasonId, setSeasonId] = useState<string | null>(route.seasonId);
  const [episodes, setEpisodes] = useState<Movie[] | null>(null);
  const [nextUp, setNextUp] = useState<Movie | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showTrailer, setShowTrailer] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const [error, setError] = useState("");
  /** Above the open profile's age limit. */
  const [blocked, setBlocked] = useState(false);
  /** Seasons or episodes failed: shown in the episodes section with a retry, not as an endless skeleton. */
  const [listError, setListError] = useState("");
  const [reload, setReload] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const loadedSeason = useRef<string | null>(null);
  const isSeries = route.kind === "Series";
  const tint = useDominantColor(detail?.backdropUrl);
  const trailerGate = useTrailerGate();
  const [trailerMuted, setTrailerMuted] = useState(true);
  const [trailerPhase, setTrailerPhase] = useState<TrailerPhase>("idle");
  useArtworkAccent(`details:${route.key}`, route.leaving ? null : detail?.backdropUrl);

  useBackNavigation(top && !route.leaving ? onBack : null);

  useEffect(() => {
    let alive = true;
    api
      .getItem(route.id)
      .then((full) => {
        if (alive) setDetail(full);
      })
      .catch((err) => {
        if (alive && isParentalBlocked(err)) setBlocked(true);
        else if (alive && !route.seed) setError(errorText(t, err));
      });
    return () => {
      alive = false;
    };
  }, [route.id, route.seed, refreshToken]);

  useEffect(() => {
    if (!isSeries) return;
    let alive = true;
    setListError("");
    Promise.all([api.getSeasons(route.id), api.getSeriesNextUp(route.id).catch(() => null)])
      .then(([list, next]) => {
        if (!alive) return;
        setSeasons(list);
        setNextUp(next);
        setSeasonId((current) => current ?? next?.seasonId ?? list[0]?.id ?? null);
      })
      .catch((err) => {
        if (alive) setListError(errorText(t, err));
      });
    return () => {
      alive = false;
    };
  }, [route.id, isSeries, reload, refreshToken]);

  useEffect(() => {
    if (!isSeries || !seasonId) return;
    let alive = true;
    // Keep the rows while a watched/favorite toggle refreshes the same season; blank
    // them when another season is selected.
    if (loadedSeason.current !== seasonId) setEpisodes(null);
    setListError("");
    api
      .getEpisodes(route.id, seasonId)
      .then((list) => {
        if (!alive) return;
        loadedSeason.current = seasonId;
        setEpisodes(list);
      })
      .catch((err) => {
        if (alive) setListError(errorText(t, err));
      });
    return () => {
      alive = false;
    };
  }, [isSeries, route.id, seasonId, userDataVersion, reload, refreshToken]);

  const movie = detail;
  const heading = movie?.name ?? route.seed?.name ?? "";
  const resume = !isSeries && (movie?.playbackPositionTicks ?? 0) > 10_000_000 * 30;
  const startEpisode = nextUp ?? episodes?.[0] ?? null;
  const startCode = startEpisode ? episodeCode(startEpisode, t("episodeCode")) : "";
  const startResumes = (startEpisode?.playbackPositionTicks ?? 0) > 10_000_000 * 30;
  const playLabel = isSeries
    ? !startEpisode || !startCode
      ? t("play")
      : startResumes
        ? t("resumeEpisode", { code: startCode })
        : t("playEpisode", { code: startCode })
    : resume && movie
      ? t("resumeFrom", { time: formatClock(ticksToSeconds(movie.playbackPositionTicks)) })
      : t("play");
  const trailer = movie ? playableTrailer(movie.remoteTrailers) : null;
  const currentSeason = seasons.find((season) => season.id === seasonId) ?? null;
  const chapters = movie && !isSeries && hasChapterImages(movie.chapters) ? movie.chapters : [];
  const genresLine = movie?.genres.slice(0, 3).join(" • ") ?? "";
  const tintValue = settings.appearance.amoled ? null : tint;
  const seriesImdb = movie?.providerIds.Imdb ?? null;
  const hasAddons = settings.addons.urls.length > 0;
  /** Online sources of this movie (movies only; episodes get a button per row). */
  const onlineRef = movie && hasAddons && !isSeries ? externalRefForJellyfin(movie) : null;
  const openOnline = (item: Movie) => {
    const ref = externalRefForJellyfin(item, seriesImdb);
    if (ref) onOnline({ ...item, external: ref });
  };

  /** Play all from the first episode of the first regular season (the chain goes on from there). */
  const playAll = async () => {
    const first = seasons.find((season) => season.seasonNumber !== 0) ?? seasons[0];
    if (!first) return;
    const list = first.id === seasonId && episodes ? episodes : await api.getEpisodes(route.id, first.id);
    const episode = list.find((item) => item.seasonNumber !== 0) ?? list[0];
    if (episode) onPlay(episode);
  };

  const begin = (kind: "all" | "shuffle") => {
    if (!movie || starting) return;
    setStarting(kind);
    setStartError("");
    const job =
      kind === "all"
        ? playAll()
        : startShuffle(movie).then((episode) => {
            if (episode) onPlay(episode);
            else setStartError(t("noEpisodes"));
          });
    job
      .catch((err) => setStartError(errorText(t, err)))
      .finally(() => setStarting(null));
  };

  const play = () => {
    if (isSeries) {
      if (startEpisode) onPlay(startEpisode);
      return;
    }
    if (movie) onPlay(movie);
  };

  if (blocked) return <RestrictedNotice leaving={route.leaving} top={top} onBack={onBack} />;

  return (
    <div
      ref={root}
      className={cn(
        "absolute inset-0 z-30 overflow-hidden bg-base text-text",
        route.leaving ? "page-exit" : "page-enter",
      )}
      style={{
        ["--details-tint" as string]: tintValue ?? "var(--color-base)",
        ["--page-scale" as string]: route.origin ? 0.94 : 1,
        transformOrigin: route.origin ? `${route.origin.x}px ${route.origin.y}px` : "50% 50%",
      }}
      aria-hidden={!top}
    >
      <div
        className="absolute inset-0 overflow-y-auto"
        onScroll={(e) => root.current?.style.setProperty("--scroll-y", String(e.currentTarget.scrollTop))}
      >
        {!movie && !error ? (
          <DetailsSkeleton />
        ) : !movie ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="mb-4 text-lg">{t("cannotConnect")}</p>
              <p className="mb-6 text-sm text-muted">{error}</p>
              <Pill variant="primary" onClick={onBack}>
                {t("back")}
              </Pill>
            </div>
          </div>
        ) : (
          <>
            {/* Grows with its content instead of clipping it on a short window. */}
            <section className="relative flex min-h-[max(58vh,420px)] w-full items-end overflow-hidden">
              <div
                className="absolute inset-0 will-change-transform"
                style={{ transform: "translateY(calc(var(--scroll-y, 0) * 0.5px))" }}
              >
                {movie.backdropUrl ? (
                  <img
                    src={movie.backdropUrl}
                    alt=""
                    className="fade-in absolute inset-0 h-full w-full scale-[1.08] object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-surface" />
                )}
                <TrailerBackdrop
                  url={trailer}
                  active={top && !route.leaving && !showTrailer && trailerGate.pages}
                  muted={trailerMuted}
                  loop
                  onPhase={setTrailerPhase}
                />
              </div>
              <div className="pointer-events-none absolute inset-x-0 top-0 h-[120px] bg-gradient-to-b from-black/50 to-transparent" />
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-[320px]"
                style={{
                  background:
                    "linear-gradient(180deg, transparent 0%, color-mix(in oklab, var(--details-tint) 40%, transparent) 45%, color-mix(in oklab, var(--details-tint) 85%, transparent) 80%, var(--details-tint) 100%)",
                }}
              />
              <div className="relative w-full max-w-[768px] px-page pt-28 pb-8 md:max-w-[min(768px,75%)]">
                {movie.logoUrl ? (
                  <img
                    src={movie.logoUrl}
                    alt={movie.name}
                    className="enter mb-4 max-h-[80px] max-w-[60%] object-contain object-left drop-shadow-[0_4px_16px_rgb(0_0_0_/_0.5)]"
                  />
                ) : (
                  <h1 className="enter mb-3 text-[clamp(36px,5vw,64px)] leading-[1.02] font-extrabold tracking-[-0.02em] [text-wrap:balance]">
                    {movie.name}
                  </h1>
                )}
                {movie.tagline ? <p className="enter enter-d1 mb-2 text-[15px] text-text/80 italic">{movie.tagline}</p> : null}
                {genresLine ? <p className="enter enter-d1 mb-5 text-[14px] text-muted">{genresLine}</p> : null}
                <div className="enter enter-d2 flex flex-wrap items-center gap-3">
                  <Pill
                    variant="primary"
                    pill
                    size="lg"
                    className="btn-play"
                    icon={<Play size={18} fill="currentColor" />}
                    onClick={play}
                    disabled={isSeries && !startEpisode}
                  >
                    {playLabel}
                  </Pill>
                  {resume ? (
                    <Pill
                      variant="tonal"
                      pill
                      size="lg"
                      icon={<RotateCcw size={16} />}
                      onClick={() => onPlay({ ...movie, playbackPositionTicks: 0 })}
                    >
                      {t("startOver")}
                    </Pill>
                  ) : null}
                  <FavoriteButton movie={movie} pill className="h-12" />
                  <Pill variant="tonal" pill size="lg" icon={<ListPlus size={17} />} onClick={() => openPicker(movie)}>
                    {t("listsButton")}
                  </Pill>
                  <WatchedButton movie={movie} pill className="h-12" />
                  {isSeries && seasons.length ? (
                    <>
                      <Pill
                        variant="tonal"
                        pill
                        size="lg"
                        icon={<ListVideo size={17} />}
                        disabled={starting != null}
                        title={t("playAllHint")}
                        onClick={() => begin("all")}
                      >
                        {t("playAll")}
                      </Pill>
                      <Pill
                        variant="tonal"
                        pill
                        size="lg"
                        icon={<Shuffle size={16} />}
                        disabled={starting != null}
                        title={t("shuffleHint")}
                        onClick={() => begin("shuffle")}
                      >
                        {t("shuffle")}
                      </Pill>
                    </>
                  ) : null}
                  {trailer ? (
                    <Pill variant="tonal" pill size="lg" icon={<Clapperboard size={16} />} onClick={() => setShowTrailer(true)}>
                      {t("trailer")}
                    </Pill>
                  ) : null}
                  {onlineRef ? (
                    <Pill variant="tonal" pill size="lg" icon={<Globe size={16} />} onClick={() => openOnline(movie)}>
                      {t("onlineSources")}
                    </Pill>
                  ) : null}
                </div>
                {startError ? <p className="mt-3 text-[13px] text-danger" role="alert">{startError}</p> : null}
              </div>
              {trailerPhase === "playing" ? (
                <TrailerMuteButton
                  muted={trailerMuted}
                  onToggle={() => setTrailerMuted((v) => !v)}
                  className="absolute right-page bottom-8"
                />
              ) : null}
            </section>

            <div
              className="relative space-y-10 px-page pt-6 pb-16"
              style={{
                background:
                  "linear-gradient(180deg, var(--details-tint) 0%, color-mix(in oklab, var(--details-tint) 30%, var(--color-base)) 320px, var(--color-base) 720px)",
              }}
            >
              <MetaChips movie={movie} seasons={isSeries ? seasons.length : undefined} />

              {/* Synopsis on the left, the production details in a column beside it. */}
              <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
                <div className="max-w-[72ch]">
                  {movie.overview ? (
                    <>
                      <p className={cn("text-[15px] leading-[1.65] text-muted", !expanded && "line-clamp-3")}>
                        {movie.overview}
                      </p>
                      {movie.overview.length > 240 ? (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => setExpanded((v) => !v)}
                          className="mt-1 text-[13px] font-semibold text-text hover:underline"
                        >
                          {expanded ? t("less") : t("more")}
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
                <ProductionInfo movie={movie} aside />
              </div>

              {isSeries ? (
                <section>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                    <h2 className="text-[18px] font-semibold">{t("episodes")}</h2>
                    {currentSeason ? (
                      <div className="flex items-center gap-3">
                        {currentSeason.unplayedCount ? (
                          <span className="text-[13px] text-dim tabular">
                            {t("unwatchedCount", { n: currentSeason.unplayedCount })}
                          </span>
                        ) : null}
                        <WatchedButton movie={currentSeason} scope="season" className="h-9 text-[13px]" />
                      </div>
                    ) : null}
                  </div>
                  <div className="mb-4">
                    <SeasonChips seasons={seasons} value={seasonId} onChange={setSeasonId} />
                  </div>
                  {listError ? (
                    <div className="flex flex-wrap items-center gap-4 rounded-btn bg-surface px-5 py-4">
                      <p className="min-w-0 flex-1 text-sm text-muted">
                        {t("cannotConnect")} <span className="text-dim">· {listError}</span>
                      </p>
                      <Pill variant="tonal" icon={<RotateCcw size={14} />} onClick={() => setReload((n) => n + 1)}>
                        {t("retry")}
                      </Pill>
                    </div>
                  ) : episodes == null ? (
                    <EpisodeListSkeleton />
                  ) : episodes.length ? (
                    <EpisodeList
                      episodes={episodes}
                      onPlay={onPlay}
                      onOnline={hasAddons && seriesImdb ? openOnline : undefined}
                    />
                  ) : (
                    <p className="text-sm text-muted">{t("noEpisodes")}</p>
                  )}
                </section>
              ) : null}

              <CastRow people={movie.cast} onPerson={setPerson} />

              {chapters.length ? (
                <section>
                  <h2 className="mb-4 text-[18px] font-semibold">{t("chapters")}</h2>
                  <ScrollRow gap="gap-3" className="snap-x pb-1">
                    {chapters.map((chapter) => {
                      const image = chapterImageUrl(movie.id, chapter);
                      const name = chapter.name ?? `${t("chapter")} ${chapter.index + 1}`;
                      return (
                        <button
                          key={chapter.index}
                          type="button"
                          onClick={() =>
                            onPlay({ ...movie, playbackPositionTicks: Math.round(chapter.startSeconds * 10_000_000) })
                          }
                          className="group/ch w-[168px] shrink-0 snap-start text-left"
                          aria-label={`${name} · ${formatClock(chapter.startSeconds)}`}
                        >
                          <div className="img-outline relative aspect-video w-full overflow-hidden rounded-poster bg-panel">
                            {image ? <img src={image} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                            <div className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition-opacity duration-150 group-hover/ch:opacity-100">
                              <span className="grid h-9 w-9 place-items-center rounded-full bg-white/90 text-black">
                                <Play size={16} fill="currentColor" className="translate-x-px" />
                              </span>
                            </div>
                            <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] tabular">
                              {formatClock(chapter.startSeconds)}
                            </span>
                          </div>
                          <p className="mt-1.5 truncate text-[12px] text-muted group-hover/ch:text-text">{name}</p>
                        </button>
                      );
                    })}
                  </ScrollRow>
                </section>
              ) : null}

              <div className="-mx-page">
                <SimilarRail itemId={movie.id} name={movie.name} onOpen={onPush} onPlay={onPlay} />
              </div>
            </div>
          </>
        )}
      </div>
      <FloatingTitleBar title={heading} onBack={onBack} />
      {person ? <PersonDialog person={person} onClose={() => setPerson(null)} onOpen={onPush} onPlay={onPlay} /> : null}
      {showTrailer && trailer ? <TrailerDialog url={trailer} title={heading} onClose={() => setShowTrailer(false)} /> : null}
    </div>
  );
}
