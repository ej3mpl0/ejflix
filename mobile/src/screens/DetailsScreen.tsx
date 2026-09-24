import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { Clapperboard, Globe, Play, RotateCcw, ShieldAlert } from "lucide-react-native";
import { api } from "../lib/api";
import { externalRefForJellyfin } from "../lib/addons";
import { episodeCode, formatClock, ticksToSeconds } from "../lib/format";
import { useDominantColor } from "../lib/tint";
import { useI18n } from "../lib/locale-context";
import { isParentalBlocked } from "../lib/parental";
import { usePlay } from "../lib/play";
import { useSettings } from "../lib/settings-context";
import { useStreamPicker } from "../lib/stream-picker-context";
import { useUserData } from "../lib/userdata-context";
import type { Movie, Person } from "../lib/types";
import { openDetails } from "../navigation/navigationRef";
import type { MainScreenProps } from "../navigation/types";
import { alpha, mix } from "../theme/color";
import { makeStyles, useTheme } from "../theme/ThemeProvider";
import { useLayout } from "../theme/responsive";
import { text } from "../theme/typography";
import { EmptyCard } from "../components/ui/EmptyCard";
import { Pill } from "../components/ui/Pill";
import { DetailsSkeleton, EpisodeListSkeleton } from "../components/ui/Skeletons";
import { CastRow } from "../components/media/CastRow";
import { PersonSheet } from "../components/media/PersonSheet";
import { ChaptersRail } from "../components/media/ChaptersRail";
import { EpisodeList } from "../components/media/EpisodeList";
import { FavoriteButton } from "../components/media/FavoriteButton";
import { MetaChips } from "../components/media/MetaChips";
import { ProductionInfo } from "../components/media/ProductionInfo";
import { SeasonChips, type SeasonChip } from "../components/media/SeasonChips";
import { SimilarRail } from "../components/media/SimilarRail";
import { WatchedButton } from "../components/media/WatchedButton";
import { FloatingTitleBar } from "../components/shell";

/** Position over which an item is considered "in progress" (30 s). */
const RESUME_TICKS = 10_000_000 * 30;
/** Height of the tint → base gradient under the backdrop (desktop 720 px). */
const BODY_TINT_H = 720;
const OVERVIEW_TOGGLE_AT = 240;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Details of a Jellyfin item (port of the desktop `DetailsPage`): parallax backdrop
 * tinted with its dominant colour, actions, meta, episodes of the selected season,
 * cast, chapters, similar titles and the production credits.
 */
export function DetailsScreen({ route: navRoute, navigation }: MainScreenProps<"Details">) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { settings } = useSettings();
  const { version: userDataVersion } = useUserData();
  const layout = useLayout();
  const play = usePlay();
  const picker = useStreamPicker();
  const route = navRoute.params.route;

  const [detail, setDetail] = useState<Movie | null>(route.seed);
  const [seasons, setSeasons] = useState<Movie[]>([]);
  const [seasonId, setSeasonId] = useState<string | null>(route.seasonId);
  const [episodes, setEpisodes] = useState<Movie[] | null>(null);
  const [nextUp, setNextUp] = useState<Movie | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const [error, setError] = useState("");
  /** Above the open profile's age limit. */
  const [blocked, setBlocked] = useState(false);
  const loadedSeason = useRef<string | null>(null);
  const scrollY = useSharedValue(0);
  const isSeries = route.kind === "Series";
  const tint = useDominantColor(detail?.backdropUrl);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  useEffect(() => {
    let alive = true;
    api
      .getItem(route.id)
      .then((full) => {
        if (alive) setDetail(full);
      })
      .catch((err) => {
        if (alive && isParentalBlocked(err)) setBlocked(true);
        else if (alive && !route.seed) setError(errorText(err));
      });
    if (isSeries) {
      Promise.all([api.getSeasons(route.id), api.getSeriesNextUp(route.id).catch(() => null)])
        .then(([list, next]) => {
          if (!alive) return;
          setSeasons(list);
          setNextUp(next);
          setSeasonId((current) => current ?? next?.seasonId ?? list[0]?.id ?? null);
        })
        .catch((err) => {
          if (alive) setError(errorText(err));
        });
    }
    return () => {
      alive = false;
    };
  }, [route.id, route.seed, isSeries]);

  useEffect(() => {
    if (!isSeries || !seasonId) return undefined;
    let alive = true;
    // Keep the rows while a watched/favorite toggle refreshes the same season; blank
    // them when another season is selected.
    if (loadedSeason.current !== seasonId) setEpisodes(null);
    api
      .getEpisodes(route.id, seasonId)
      .then((list) => {
        if (!alive) return;
        loadedSeason.current = seasonId;
        setEpisodes(list);
      })
      .catch((err) => {
        if (alive) setError(errorText(err));
      });
    return () => {
      alive = false;
    };
  }, [isSeries, route.id, seasonId, userDataVersion]);

  const movie = detail;
  const heading = movie?.name ?? route.seed?.name ?? "";
  const tintColor = tint ?? t.colors.base;
  const tintMid = useMemo(() => mix(tintColor, t.colors.base, 0.7), [tintColor, t.colors.base]);

  const backdropH = layout.wide
    ? Math.max(420, Math.round(0.58 * layout.height))
    : Math.round(Math.min(0.5 * layout.height, 0.9 * layout.width));
  const parallax = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(0, scrollY.value) * 0.5 }] }));

  const seriesImdb = movie?.providerIds.Imdb ?? null;
  const hasAddons = settings.addons.urls.length > 0;
  const openOnline = useCallback(
    (item: Movie) => {
      const ref = externalRefForJellyfin(item, seriesImdb);
      if (ref) picker.open({ ...item, external: ref });
    },
    [picker, seriesImdb],
  );

  const onPlay = useCallback((item: Movie) => play(item), [play]);
  const onPush = useCallback((item: Movie) => openDetails(item), []);
  const trailer = detail?.remoteTrailers?.find((url) => /youtu\.?be/.test(url)) ?? null;
  const back = useCallback(() => navigation.goBack(), [navigation]);

  const seasonChips = useMemo<SeasonChip[]>(
    () => seasons.map((season) => ({ id: season.id, name: season.name, count: season.childCount })),
    [seasons],
  );

  if (blocked) {
    return (
      <View style={s.root}>
        <View style={{ paddingTop: layout.insets.top + 96, paddingHorizontal: layout.pagePad }}>
          <EmptyCard icon={ShieldAlert} title={tr("parentalBlockedTitle")} hint={tr("parentalBlockedHint")} actionLabel={tr("back")} onAction={back} />
        </View>
      </View>
    );
  }

  if (!movie && error) {
    return (
      <View style={s.root}>
        <View style={{ paddingTop: layout.insets.top + 96, paddingHorizontal: layout.pagePad }}>
          <EmptyCard title={tr("cannotConnect")} hint={error} actionLabel={tr("back")} onAction={back} />
        </View>
        <PersonSheet person={person} onClose={() => setPerson(null)} onOpen={onPush} onPlay={onPlay} />
      <FloatingTitleBar title={heading} scrollY={scrollY} onBack={back} />
      </View>
    );
  }

  if (!movie) {
    return (
      <View style={s.root}>
        <DetailsSkeleton />
        <FloatingTitleBar title={heading} scrollY={scrollY} onBack={back} />
      </View>
    );
  }

  const resume = !isSeries && movie.playbackPositionTicks > RESUME_TICKS;
  const startEpisode = nextUp ?? episodes?.[0] ?? null;
  const startCode = startEpisode ? episodeCode(startEpisode, tr("episodeCode")) : "";
  const startResumes = (startEpisode?.playbackPositionTicks ?? 0) > RESUME_TICKS;
  const playLabel = isSeries
    ? !startEpisode || !startCode
      ? tr("play")
      : startResumes
        ? tr("resumeEpisode", { code: startCode })
        : tr("playEpisode", { code: startCode })
    : resume
      ? tr("resumeFrom", { time: formatClock(ticksToSeconds(movie.playbackPositionTicks)) })
      : tr("play");
  const currentSeason = seasons.find((season) => season.id === seasonId) ?? null;
  const genresLine = movie.genres.slice(0, 3).join(" • ");
  /** Online sources of this movie (episodes get their own entry per row). */
  const onlineRef = hasAddons && !isSeries ? externalRefForJellyfin(movie) : null;
  const titleSize = clamp(0.085 * layout.width, 28, 56);
  const logoH = clamp(0.18 * backdropH, 48, 92);
  const scrimH = Math.round(Math.min(340, backdropH * 0.8));

  const start = () => {
    if (isSeries) {
      if (startEpisode) onPlay(startEpisode);
      return;
    }
    onPlay(movie);
  };

  return (
    <View style={s.root}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: layout.insets.bottom + 40 }}
      >
        <View style={[s.hero, { height: backdropH }]}>
          <Animated.View style={[StyleSheet.absoluteFill, parallax]}>
            {movie.backdropUrl ? (
              <Image
                source={{ uri: movie.backdropUrl }}
                contentFit="cover"
                transition={300}
                cachePolicy="memory-disk"
                recyclingKey={`backdrop-${movie.id}`}
                priority="high"
                style={[StyleSheet.absoluteFill, s.backdrop]}
              />
            ) : null}
          </Animated.View>
          <LinearGradient
            pointerEvents="none"
            colors={[t.black(0.5), "transparent"]}
            style={[s.topScrim, { height: 120 + layout.insets.top }]}
          />
          <LinearGradient
            pointerEvents="none"
            colors={["transparent", alpha(tintColor, 0.4), alpha(tintColor, 0.85), tintColor]}
            locations={[0, 0.45, 0.8, 1]}
            style={[s.bottomScrim, { height: scrimH }]}
          />
          <View style={[s.heroText, { left: layout.pagePad, right: layout.pagePad }]}>
            {movie.logoUrl ? (
              <Image
                source={{ uri: movie.logoUrl }}
                contentFit="contain"
                contentPosition="left"
                transition={300}
                cachePolicy="memory-disk"
                recyclingKey={`logo-${movie.id}`}
                accessibilityLabel={movie.name}
                style={[s.logo, { height: logoH }]}
              />
            ) : (
              <Text numberOfLines={2} style={[s.title, { fontSize: titleSize, lineHeight: Math.round(titleSize * 1.06) }]}>
                {movie.name}
              </Text>
            )}
            {movie.tagline ? (
              <Text numberOfLines={1} style={s.tagline}>
                {movie.tagline}
              </Text>
            ) : null}
            {genresLine ? (
              <Text numberOfLines={1} style={s.genres}>
                {genresLine}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={[s.body, { paddingHorizontal: layout.pagePad }]}>
          <LinearGradient
            pointerEvents="none"
            colors={[tintColor, tintMid, t.colors.base]}
            locations={[0, 320 / BODY_TINT_H, 1]}
            style={[s.bodyTint, { height: BODY_TINT_H }]}
          />

          <View style={s.actions}>
            <Pill
              variant="primary"
              pill
              size="lg"
              iconNode={<Play size={18} color={t.colors.onAccent} fill={t.colors.onAccent} style={{ marginLeft: 1 }} />}
              label={playLabel}
              disabled={isSeries && !startEpisode}
              onPress={start}
            />
            {resume ? (
              <Pill
                variant="tonal"
                pill
                size="lg"
                icon={RotateCcw}
                label={tr("startOver")}
                onPress={() => onPlay({ ...movie, playbackPositionTicks: 0 })}
              />
            ) : null}
            <FavoriteButton movie={movie} pill size="lg" />
            <WatchedButton movie={movie} pill size="lg" />
            {onlineRef ? (
              <Pill variant="tonal" pill size="lg" icon={Globe} label={tr("onlineSources")} onPress={() => openOnline(movie)} />
            ) : null}
            {trailer ? (
              <Pill
                variant="tonal"
                pill
                size="lg"
                icon={Clapperboard}
                label={tr("trailer")}
                onPress={() => void Linking.openURL(trailer).catch(() => undefined)}
              />
            ) : null}
          </View>

          <MetaChips movie={movie} seasons={isSeries ? seasons.length : undefined} />

          {movie.overview ? (
            <View>
              <Text numberOfLines={expanded ? undefined : 3} style={s.overview}>
                {movie.overview}
              </Text>
              {movie.overview.length > OVERVIEW_TOGGLE_AT ? (
                <Pill
                  variant="ghost"
                  size="md"
                  label={expanded ? tr("less") : tr("more")}
                  accessibilityLabel={expanded ? tr("less") : tr("more")}
                  onPress={() => setExpanded((v) => !v)}
                  style={s.moreBtn}
                />
              ) : null}
            </View>
          ) : null}

          {isSeries ? (
            <View>
              <View style={s.sectionHead}>
                <Text style={s.heading}>{tr("episodes")}</Text>
                {currentSeason ? (
                  <View style={s.sectionHeadRight}>
                    {currentSeason.unplayedCount ? (
                      <Text style={s.unwatched}>{tr("unwatchedCount", { n: currentSeason.unplayedCount })}</Text>
                    ) : null}
                    <WatchedButton movie={currentSeason} scope="season" size="sm" pill />
                  </View>
                ) : null}
              </View>
              <View style={{ marginHorizontal: -layout.pagePad, marginBottom: 14 }}>
                <SeasonChips seasons={seasonChips} value={seasonId} onChange={setSeasonId} padHorizontal={layout.pagePad} />
              </View>
              {episodes == null ? (
                <EpisodeListSkeleton />
              ) : episodes.length ? (
                <EpisodeList
                  episodes={episodes}
                  onPlay={onPlay}
                  onOnline={hasAddons && seriesImdb ? openOnline : undefined}
                  seriesImdb={seriesImdb}
                />
              ) : (
                <Text style={s.empty}>{tr("noEpisodes")}</Text>
              )}
            </View>
          ) : null}

          <CastRow people={movie.cast} onPerson={setPerson} />

          {!isSeries ? <ChaptersRail movie={movie} onPlay={onPlay} /> : null}

          <SimilarRail itemId={movie.id} onOpen={onPush} onPlay={onPlay} style={{ marginHorizontal: -layout.pagePad }} />

          <ProductionInfo movie={movie} />
        </View>
      </Animated.ScrollView>
      <FloatingTitleBar title={heading} scrollY={scrollY} onBack={back} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.base },
  hero: { width: "100%", overflow: "hidden", backgroundColor: t.colors.surface },
  backdrop: { transform: [{ scale: 1.08 }] },
  topScrim: { position: "absolute", top: 0, left: 0, right: 0 },
  bottomScrim: { position: "absolute", left: 0, right: 0, bottom: 0 },
  heroText: { position: "absolute", bottom: 20 },
  logo: { width: "70%", alignSelf: "flex-start", marginBottom: 12 },
  title: { ...text(40, "extrabold", { tracking: -0.02 }), color: t.colors.text, marginBottom: 8 },
  tagline: { ...text(14), color: t.white(0.8), fontStyle: "italic", marginBottom: 4 },
  genres: { ...text(13), color: t.colors.muted },
  body: { paddingTop: 22, gap: 28 },
  bodyTint: { position: "absolute", top: 0, left: 0, right: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  overview: { ...text(15, "regular", { lineHeight: 24 }), color: t.colors.muted },
  moreBtn: { paddingHorizontal: 0, marginTop: 2, alignSelf: "flex-start" },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 },
  sectionHeadRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  heading: { ...text(18, "semibold", { tracking: -0.01 }), color: t.colors.text },
  unwatched: { ...text(12, "regular", { tabular: true }), color: t.colors.dim },
  empty: { ...text(14), color: t.colors.muted },
}));
