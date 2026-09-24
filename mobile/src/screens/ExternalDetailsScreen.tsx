import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { CheckCheck, Clapperboard, Globe, Play, RotateCcw } from "lucide-react-native";
import { api } from "../lib/api";
import { metaFullToMovie, sortedVideos, videoToMovie } from "../lib/addons";
import { episodeCode } from "../lib/format";
import { useDominantColor } from "../lib/tint";
import { useI18n } from "../lib/locale-context";
import { usePlay } from "../lib/play";
import type { AddonMetaFull, Movie, ResumeEntry } from "../lib/types";
import type { MainScreenProps } from "../navigation/types";
import { alpha, mix } from "../theme/color";
import { makeStyles, useTheme } from "../theme/ThemeProvider";
import { useLayout } from "../theme/responsive";
import { text } from "../theme/typography";
import { Pill } from "../components/ui/Pill";
import { EpisodeListSkeleton } from "../components/ui/Skeletons";
import { CastRow } from "../components/media/CastRow";
import { EpisodeList } from "../components/media/EpisodeList";
import { MetaChips } from "../components/media/MetaChips";
import { ProductionInfo } from "../components/media/ProductionInfo";
import { SeasonChips, type SeasonChip } from "../components/media/SeasonChips";
import { FloatingTitleBar } from "../components/shell";
import { useUserData } from "../lib/userdata-context";
import { FavoriteButton } from "../components/media/FavoriteButton";
import { WatchedButton } from "../components/media/WatchedButton";
import { DownloadButton } from "../components/media/DownloadButton";

/** Height of the tint → base gradient under the backdrop (desktop 720 px). */
const BODY_TINT_H = 720;
const OVERVIEW_TOGGLE_AT = 240;
/** Anything past this share of the runtime counts as finished. */
const FINISHED_AT = 0.95;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Details of an online title (Stremio addon metadata), port of the desktop
 * `ExternalDetailsPage`. No Jellyfin user data is involved: playing anything hands the
 * item to the shared dispatch, which opens the stream picker.
 */
export function ExternalDetailsScreen({ route, navigation }: MainScreenProps<"ExternalDetails">) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const layout = useLayout();
  const play = usePlay();
  const seed = route.params.seed;
  const ext = seed.external ?? null;

  const [meta, setMeta] = useState<AddonMetaFull | null>(null);
  const [progress, setProgress] = useState<ResumeEntry[]>([]);
  const [season, setSeason] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [markingSeason, setMarkingSeason] = useState(false);
  const { setPlayed } = useUserData();
  const scrollY = useSharedValue(0);

  const movie = meta ? metaFullToMovie(meta) : seed;
  const tint = useDominantColor(movie.backdropUrl);
  const tintColor = tint ?? t.colors.base;
  const tintMid = useMemo(() => mix(tintColor, t.colors.base, 0.7), [tintColor, t.colors.base]);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const parallax = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(0, scrollY.value) * 0.5 }] }));

  useEffect(() => {
    if (!ext) return undefined;
    let alive = true;
    setError("");
    api
      .addonMeta(ext.type, ext.metaId)
      .then((full) => {
        if (alive) setMeta(full);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
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

  // Back from the player: the resume position and the next episode moved.
  useEffect(() => {
    let alive = true;
    const unlisten = api.onPlayerClose(() => {
      api
        .addonProgressList()
        .then((list) => {
          if (alive) setProgress(list);
        })
        .catch(() => undefined);
    });
    return () => {
      alive = false;
      void unlisten.then((fn) => fn()).catch(() => undefined);
    };
  }, []);

  const videos = useMemo(() => (meta ? sortedVideos(meta.videos) : []), [meta]);
  const seasonNumbers = useMemo(() => {
    const set = new Set<number>();
    for (const video of videos) set.add(video.season ?? 0);
    return [...set].sort((a, b) => (a === 0 ? Infinity : a) - (b === 0 ? Infinity : b));
  }, [videos]);
  const isSeries = ext?.type === "series" && videos.length > 0;

  // Resume target: the most recent unfinished episode, else the first one.
  const resumeEntry = useMemo(() => {
    if (!ext) return null;
    return (
      progress
        .filter((p) => p.metaId === ext.metaId && p.durationSeconds > 0 && p.positionSeconds / p.durationSeconds < FINISHED_AT)
        .sort((a, b) => b.updatedMs - a.updatedMs)[0] ?? null
    );
  }, [progress, ext]);

  useEffect(() => {
    if (season != null || !seasonNumbers.length) return;
    setSeason(resumeEntry?.season ?? seasonNumbers.find((n) => n !== 0) ?? seasonNumbers[0]);
  }, [seasonNumbers, season, resumeEntry]);

  const withPosition = useCallback(
    (item: Movie): Movie => {
      const entry = progress.find((p) => p.key === (item.external?.videoId ?? "")) ?? null;
      if (!entry) return item;
      const percent = entry.durationSeconds > 0 ? Math.min(100, (entry.positionSeconds / entry.durationSeconds) * 100) : 0;
      return {
        ...item,
        playbackPositionTicks: Math.round(entry.positionSeconds * 10_000_000),
        playedPercentage: percent,
        runtimeTicks: item.runtimeTicks ?? (entry.durationSeconds > 0 ? Math.round(entry.durationSeconds * 10_000_000) : null),
      };
    },
    [progress],
  );

  const onPlay = useCallback((item: Movie) => play(item), [play]);
  const back = useCallback(() => navigation.goBack(), [navigation]);

  const episodes = useMemo<Movie[]>(() => {
    if (!meta || season == null) return [];
    return videos.filter((video) => (video.season ?? 0) === season).map((video) => withPosition(videoToMovie(meta, video)));
  }, [meta, season, videos, withPosition]);

  const seasonChips = useMemo<SeasonChip[]>(
    () =>
      seasonNumbers.map((n) => ({
        id: String(n),
        name: n === 0 ? tr("specials") : `${tr("season")} ${n}`,
        count: videos.filter((video) => (video.season ?? 0) === n).length,
      })),
    [seasonNumbers, videos, tr],
  );

  const startItem = useMemo<Movie | null>(() => {
    if (!isSeries || !meta) return withPosition(movie);
    const target = resumeEntry
      ? videos.find((video) => video.id === resumeEntry.key)
      : (videos.find((video) => (video.season ?? 0) !== 0) ?? videos[0]);
    return target ? withPosition(videoToMovie(meta, target)) : null;
  }, [isSeries, meta, movie, resumeEntry, videos, withPosition]);

  if (!ext) return null;

  const trailer = movie?.remoteTrailers?.find((url) => /youtu\.?be/.test(url)) ?? null;
  const startCode = startItem?.kind === "Episode" ? episodeCode(startItem, tr("episodeCode")) : "";
  const playLabel =
    startItem?.kind === "Episode" && startCode
      ? startItem.playbackPositionTicks > 0
        ? tr("resumeEpisode", { code: startCode })
        : tr("playEpisode", { code: startCode })
      : startItem && startItem.playbackPositionTicks > 0
        ? tr("resume")
        : tr("playOnline");
  const genresLine = movie.genres.slice(0, 3).join(" • ");
  const backdropH = layout.wide
    ? Math.max(420, Math.round(0.58 * layout.height))
    : Math.round(Math.min(0.5 * layout.height, 0.9 * layout.width));
  const titleSize = clamp(0.085 * layout.width, 28, 56);
  const logoH = clamp(0.18 * backdropH, 48, 92);
  const scrimH = Math.round(Math.min(340, backdropH * 0.8));
  const seasonCount = seasonNumbers.filter((n) => n !== 0).length;

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
            <View style={s.onlineRow}>
              <Globe size={13} color={t.colors.muted} strokeWidth={2.2} />
              <Text numberOfLines={1} style={s.genres}>
                {genresLine ? `${tr("online")} • ${genresLine}` : tr("online")}
              </Text>
            </View>
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
              disabled={!startItem}
              onPress={() => startItem && onPlay(startItem)}
            />
            {startItem && startItem.playbackPositionTicks > 0 ? (
              <Pill
                variant="tonal"
                pill
                size="lg"
                icon={RotateCcw}
                label={tr("startOver")}
                onPress={() => onPlay({ ...startItem, playbackPositionTicks: 0 })}
              />
            ) : null}
            <FavoriteButton movie={movie} pill size="lg" />
            <WatchedButton movie={movie} pill size="lg" />
            <DownloadButton movie={movie} />
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

          <MetaChips movie={movie} seasons={isSeries ? seasonCount : undefined} />

          {error ? (
            <View style={s.retryRow}>
              <Text style={[s.empty, { flex: 1 }]}>{error}</Text>
              <Pill variant="tonal" size="sm" icon={RotateCcw} label={tr("retry")} onPress={() => setReload((n) => n + 1)} />
            </View>
          ) : null}

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

          {ext.type === "series" ? (
            <View>
              <View style={s.episodesHead}>
                <Text style={s.heading}>{tr("episodes")}</Text>
                {meta && episodes.length ? (
                  <Pill
                    variant="tonal"
                    size="sm"
                    icon={CheckCheck}
                    loading={markingSeason}
                    label={tr("markSeasonWatched")}
                    onPress={() => {
                      // One entry per episode in the local list, one after another.
                      setMarkingSeason(true);
                      void (async () => {
                        for (const episode of episodes) await setPlayed(episode, true);
                      })().finally(() => setMarkingSeason(false));
                    }}
                  />
                ) : null}
              </View>
              <View style={{ marginHorizontal: -layout.pagePad, marginBottom: 14 }}>
                <SeasonChips
                  seasons={seasonChips}
                  value={season == null ? null : String(season)}
                  onChange={(id) => setSeason(Number(id))}
                  padHorizontal={layout.pagePad}
                />
              </View>
              {!meta && error ? null : !meta ? (
                <EpisodeListSkeleton />
              ) : episodes.length ? (
                <EpisodeList episodes={episodes} onPlay={onPlay} metaOf={(item) => (item.year ? String(item.year) : null)} />
              ) : (
                <Text style={s.empty}>{tr("noEpisodes")}</Text>
              )}
            </View>
          ) : null}

          <CastRow people={movie.cast} />

          <ProductionInfo movie={movie} />
        </View>
      </Animated.ScrollView>
      <FloatingTitleBar title={movie.name} scrollY={scrollY} onBack={back} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  retryRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  episodesHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  root: { flex: 1, backgroundColor: t.colors.base },
  hero: { width: "100%", overflow: "hidden", backgroundColor: t.colors.surface },
  backdrop: { transform: [{ scale: 1.08 }] },
  topScrim: { position: "absolute", top: 0, left: 0, right: 0 },
  bottomScrim: { position: "absolute", left: 0, right: 0, bottom: 0 },
  heroText: { position: "absolute", bottom: 20 },
  logo: { width: "70%", alignSelf: "flex-start", marginBottom: 12 },
  title: { ...text(40, "extrabold", { tracking: -0.02 }), color: t.colors.text, marginBottom: 8 },
  onlineRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  genres: { ...text(13), color: t.colors.muted, flexShrink: 1 },
  body: { paddingTop: 22, gap: 28 },
  bodyTint: { position: "absolute", top: 0, left: 0, right: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  overview: { ...text(15, "regular", { lineHeight: 24 }), color: t.colors.muted },
  moreBtn: { paddingHorizontal: 0, marginTop: 2, alignSelf: "flex-start" },
  heading: { ...text(18, "semibold", { tracking: -0.01 }), color: t.colors.text },
  empty: { ...text(14), color: t.colors.muted },
}));
