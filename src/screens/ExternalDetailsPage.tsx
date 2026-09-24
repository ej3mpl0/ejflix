import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCheck, Clapperboard, Globe, Play, RotateCcw } from "lucide-react";
import type { AddonMetaFull, Movie, ResumeEntry } from "../lib/types";
import type { DetailsRoute } from "../lib/view-stack";
import { api } from "../lib/api";
import { cn, episodeCode } from "../lib/format";
import { metaFullToMovie, sortedVideos, videoToMovie } from "../lib/addons";
import { useDominantColor } from "../lib/dominant-color";
import { useBackNavigation } from "../lib/use-back";
import { useI18n } from "../lib/locale-context";
import { isParentalBlocked } from "../lib/parental";
import { RestrictedNotice } from "../components/RestrictedNotice";
import { useSettings } from "../lib/settings-context";
import { Pill } from "../components/Pill";
import { MetaChips } from "../components/MetaChips";
import { CastRow } from "../components/CastRow";
import { FavoriteButton } from "../components/FavoriteButton";
import { WatchedButton } from "../components/WatchedButton";
import { OnlineSimilarRail } from "../components/OnlineSimilarRail";
import { ProductionInfo } from "../components/ProductionInfo";
import { FloatingTitleBar } from "../components/FloatingTitleBar";
import { DetailsSkeleton, EpisodeListSkeleton } from "../components/Skeletons";
import { SeasonChips } from "../components/SeasonChips";
import { TrailerDialog, playableTrailer } from "../components/TrailerDialog";
import { useUserData } from "../lib/userdata-context";

/**
 * Details of an online title (Stremio addon metadata). Playing anything opens the
 * stream picker through `onPlay` (Home decides), so no Jellyfin state is involved.
 */
export function ExternalDetailsPage({
  route,
  top,
  onBack,
  onOpen,
  onPlay,
}: {
  route: DetailsRoute;
  top: boolean;
  onBack: () => void;
  /** Opening another title from the "more like this" rail. */
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
}) {
  const { t, locale } = useI18n();
  const { settings } = useSettings();
  const seed = route.seed;
  const ext = seed?.external ?? null;
  const [meta, setMeta] = useState<AddonMetaFull | null>(null);
  const [progress, setProgress] = useState<ResumeEntry[]>([]);
  const [season, setSeason] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  /** Above the open profile's age limit. */
  const [blocked, setBlocked] = useState(false);
  const [reload, setReload] = useState(0);
  const [showTrailer, setShowTrailer] = useState(false);
  const [markingSeason, setMarkingSeason] = useState(false);
  const { setPlayed, flags } = useUserData();
  const root = useRef<HTMLDivElement>(null);
  const movie = meta ? metaFullToMovie(meta) : seed;
  const tint = useDominantColor(movie?.backdropUrl);
  const tintValue = settings.appearance.amoled ? null : tint;

  useBackNavigation(top && !route.leaving ? onBack : null);

  useEffect(() => {
    if (!ext) return;
    let alive = true;
    setError("");
    api
      .addonMeta(ext.type, ext.metaId)
      .then((full) => {
        if (alive) setMeta(full);
      })
      .catch((err) => {
        if (alive && isParentalBlocked(err)) setBlocked(true);
        else if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    api
      .addonProgressList()
      .then((list) => {
        if (alive) setProgress(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ext?.type, ext?.metaId, reload]);

  const videos = useMemo(() => (meta ? sortedVideos(meta.videos) : []), [meta]);
  const seasons = useMemo(() => {
    const set = new Set<number>();
    for (const v of videos) set.add(v.season ?? 0);
    return [...set].sort((a, b) => (a === 0 ? Infinity : a) - (b === 0 ? Infinity : b));
  }, [videos]);
  const isSeries = ext?.type === "series" && videos.length > 0;

  // Resume target: the most recent unfinished episode, else the first episode.
  const resumeEntry = useMemo(() => {
    if (!ext) return null;
    return progress
      .filter((p) => p.metaId === ext.metaId && p.durationSeconds > 0 && p.positionSeconds / p.durationSeconds < 0.95)
      .sort((a, b) => b.updatedMs - a.updatedMs)[0] ?? null;
  }, [progress, ext]);

  useEffect(() => {
    if (season != null || !seasons.length) return;
    const preferred = resumeEntry?.season ?? seasons.find((s) => s !== 0) ?? seasons[0];
    setSeason(preferred);
  }, [seasons, season, resumeEntry]);

  const retryBar = error ? (
    <div className="flex flex-wrap items-center gap-4 rounded-btn bg-surface px-5 py-4">
      <p className="min-w-0 flex-1 text-sm text-muted">
        {t("cannotConnect")} <span className="text-dim">· {error}</span>
      </p>
      <Pill variant="tonal" icon={<RotateCcw size={14} />} onClick={() => setReload((n) => n + 1)}>
        {t("retry")}
      </Pill>
    </div>
  ) : null;

  if (blocked) return <RestrictedNotice leaving={route.leaving} top={top} onBack={onBack} />;

  // Without a seed there is nothing to draw until the addon answers; keep the title bar so
  // the page can always be left.
  if (!ext || !movie) {
    return (
      <div className={cn("absolute inset-0 z-30 overflow-hidden bg-base text-text", route.leaving ? "page-exit" : "page-enter")} aria-hidden={!top}>
        {ext && !error ? (
          <div className="absolute inset-0 overflow-y-auto">
            <DetailsSkeleton />
          </div>
        ) : (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <p className="mb-4 text-lg">{t("cannotConnect")}</p>
              {error ? <p className="mb-6 text-sm text-muted">{error}</p> : null}
              <div className="flex justify-center gap-3">
                {ext ? (
                  <Pill variant="primary" icon={<RotateCcw size={14} />} onClick={() => setReload((n) => n + 1)}>
                    {t("retry")}
                  </Pill>
                ) : null}
                <Pill variant="tonal" onClick={onBack}>
                  {t("back")}
                </Pill>
              </div>
            </div>
          </div>
        )}
        <FloatingTitleBar title={seed?.name ?? ""} onBack={onBack} />
      </div>
    );
  }

  const releaseFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  const releaseLabel = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso.slice(0, 10) : releaseFormat.format(date);
  };

  const positionOf = (videoId: string) => progress.find((p) => p.key === videoId) ?? null;
  const withPosition = (item: Movie): Movie => {
    const entry = positionOf(item.external?.videoId ?? "");
    return entry ? { ...item, playbackPositionTicks: Math.round(entry.positionSeconds * 10_000_000) } : item;
  };

  const startItem: Movie | null = isSeries && meta
    ? (() => {
        const target = resumeEntry
          ? videos.find((v) => v.id === resumeEntry.key)
          : videos.find((v) => (v.season ?? 0) !== 0) ?? videos[0];
        return target ? withPosition(videoToMovie(meta, target)) : null;
      })()
    : withPosition(movie);
  const startCode = startItem?.kind === "Episode" ? episodeCode(startItem, t("episodeCode")) : "";
  const playLabel = startItem?.kind === "Episode" && startCode
    ? startItem.playbackPositionTicks > 0
      ? t("resumeEpisode", { code: startCode })
      : t("playEpisode", { code: startCode })
    : startItem && startItem.playbackPositionTicks > 0
      ? t("resume")
      : t("playOnline");
  const genresLine = movie.genres.slice(0, 3).join(" • ");
  const trailer = playableTrailer(movie.remoteTrailers);
  const resumes = Boolean(startItem && startItem.playbackPositionTicks > 0);
  const episodes = meta && season != null ? videos.filter((v) => (v.season ?? 0) === season) : [];

  return (
    <div
      ref={root}
      className={cn("absolute inset-0 z-30 overflow-hidden bg-base text-text", route.leaving ? "page-exit" : "page-enter")}
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
        {(
          <>
            {/* Grows with its content instead of clipping it on a short window. */}
            <section className="relative flex min-h-[max(58vh,420px)] w-full items-end overflow-hidden">
              <div className="absolute inset-0 will-change-transform" style={{ transform: "translateY(calc(var(--scroll-y, 0) * 0.5px))" }}>
                {movie.backdropUrl ? (
                  <img src={movie.backdropUrl} alt="" className="fade-in absolute inset-0 h-full w-full scale-[1.08] object-cover" />
                ) : (
                  <div className="absolute inset-0 bg-surface" />
                )}
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
                  <img src={movie.logoUrl} alt={movie.name} className="enter mb-4 max-h-[80px] max-w-[60%] object-contain object-left drop-shadow-[0_4px_16px_rgb(0_0_0_/_0.5)]" />
                ) : (
                  <h1 className="enter mb-3 text-[clamp(36px,5vw,64px)] leading-[1.02] font-extrabold tracking-[-0.02em] [text-wrap:balance]">
                    {movie.name}
                  </h1>
                )}
                <p className="enter enter-d1 mb-5 flex items-center gap-2 text-[14px] text-muted">
                  <Globe size={14} />
                  {t("online")}
                  {genresLine ? <span>• {genresLine}</span> : null}
                </p>
                <div className="enter enter-d2 flex flex-wrap items-center gap-3">
                  <Pill
                    variant="primary"
                    pill
                    size="lg"
                    className="btn-play"
                    icon={<Play size={18} fill="currentColor" />}
                    disabled={!startItem}
                    onClick={() => startItem && onPlay(startItem)}
                  >
                    {playLabel}
                  </Pill>
                  <FavoriteButton movie={movie} pill className="h-12" />
                  {resumes && startItem ? (
                    <Pill
                      variant="tonal"
                      pill
                      size="lg"
                      icon={<RotateCcw size={16} />}
                      onClick={() => onPlay({ ...startItem, playbackPositionTicks: 0 })}
                    >
                      {t("startOver")}
                    </Pill>
                  ) : null}
                  <WatchedButton movie={movie} pill className="h-12" />
                  {trailer ? (
                    <Pill variant="tonal" pill size="lg" icon={<Clapperboard size={16} />} onClick={() => setShowTrailer(true)}>
                      {t("trailer")}
                    </Pill>
                  ) : null}
                </div>
              </div>
            </section>

            <div
              className="relative space-y-10 px-page pt-6 pb-16"
              style={{
                background:
                  "linear-gradient(180deg, var(--details-tint) 0%, color-mix(in oklab, var(--details-tint) 30%, var(--color-base)) 320px, var(--color-base) 720px)",
              }}
            >
              <MetaChips movie={movie} seasons={isSeries ? seasons.filter((s) => s !== 0).length : undefined} />
              {retryBar}
              {/* Synopsis on the left, the production details in a column beside it. */}
              <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
                <div className="max-w-[72ch]">
                  {movie.overview ? (
                    <>
                      <p className={cn("text-[15px] leading-[1.65] text-muted", !expanded && "line-clamp-3")}>{movie.overview}</p>
                      {movie.overview.length > 240 ? (
                        <button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} className="mt-1 text-[13px] font-semibold text-text hover:underline">
                          {expanded ? t("less") : t("more")}
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
                <ProductionInfo movie={movie} aside />
              </div>

              {ext.type === "series" ? (
                <section>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                    <h2 className="text-[18px] font-semibold">{t("episodes")}</h2>
                    {meta && episodes.length ? (
                      <Pill
                        variant="tonal"
                        size="sm"
                        disabled={markingSeason}
                        icon={<CheckCheck size={15} />}
                        onClick={() => {
                          // One entry per episode in the local list, one after another.
                          setMarkingSeason(true);
                          void (async () => {
                            for (const video of episodes) await setPlayed(videoToMovie(meta, video), true);
                          })().finally(() => setMarkingSeason(false));
                        }}
                      >
                        {t("markSeasonWatched")}
                      </Pill>
                    ) : null}
                  </div>
                  <div className="mb-4 empty:hidden">
                    <SeasonChips
                      seasons={seasons.map((s) => ({
                        id: String(s),
                        name: s === 0 ? t("specials") : t("seasonNumber", { n: s }),
                        childCount: videos.filter((v) => (v.season ?? 0) === s).length,
                      }))}
                      value={season == null ? null : String(season)}
                      onChange={(id) => setSeason(Number(id))}
                    />
                  </div>
                  {!meta && error ? null : !meta ? (
                    <EpisodeListSkeleton />
                  ) : episodes.length ? (
                    <div className="space-y-1">
                      {episodes.map((video) => {
                        const item = withPosition(videoToMovie(meta, video));
                        const entry = positionOf(video.id);
                        const pct = entry && entry.durationSeconds > 0 ? Math.min(100, (entry.positionSeconds / entry.durationSeconds) * 100) : 0;
                        return (
                          <button
                            key={video.id}
                            type="button"
                            onClick={() => onPlay(item)}
                            className="group/ep flex w-full items-start gap-4 rounded-xl p-2 text-left transition-colors duration-150 hover:bg-white/5"
                          >
                            <div className="img-outline relative aspect-video w-[200px] shrink-0 overflow-hidden rounded-poster bg-panel">
                              {video.thumbnail ? <img src={video.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
                              <div className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition-opacity duration-150 group-hover/ep:opacity-100">
                                <span className="grid h-10 w-10 place-items-center rounded-full bg-white/90 text-black">
                                  <Play size={18} fill="currentColor" className="translate-x-px" />
                                </span>
                              </div>
                              {flags(item).played ? (
                                <span className="absolute top-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white">
                                  <CheckCheck size={13} />
                                </span>
                              ) : null}
                              {pct > 0 ? (
                                <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
                                  <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                                </div>
                              ) : null}
                            </div>
                            <div className="min-w-0 flex-1 py-1">
                              <div className="flex items-baseline justify-between gap-3">
                                <p className="truncate text-[15px] font-medium text-white">
                                  {video.episode != null ? `${video.episode}. ` : ""}
                                  {video.title}
                                </p>
                                {video.released ? <span className="shrink-0 text-[12px] text-dim tabular">{releaseLabel(video.released)}</span> : null}
                              </div>
                              {video.overview ? <p className="mt-1 line-clamp-2 text-[13px] leading-[1.5] text-muted">{video.overview}</p> : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted">{t("noEpisodes")}</p>
                  )}
                </section>
              ) : null}

              <CastRow people={movie.cast} />
              <div className="-mx-page">
                <OnlineSimilarRail meta={meta} movie={movie} onOpen={onOpen} onPlay={onPlay} />
              </div>
            </div>
          </>
        )}
      </div>
      <FloatingTitleBar title={movie.name} onBack={onBack} />
      {showTrailer && trailer ? <TrailerDialog url={trailer} title={movie.name} onClose={() => setShowTrailer(false)} /> : null}
    </div>
  );
}
