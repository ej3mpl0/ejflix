import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { Check } from "lucide-react-native";
import type { AddonMetaFull, Movie, ResumeEntry } from "../../lib/types";
import { sortedVideos, videoToMovie } from "../../lib/addons";
import { api } from "../../lib/api";
import { episodeCode, formatRuntime } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { Chip } from "../ui/Chip";
import { ProgressBar } from "../ui/ProgressBar";
import { Sheet } from "../ui/Sheet";
import { EpisodeListSkeleton } from "../ui/Skeletons";

const THUMB_W = 120;
const THUMB_H = Math.round((THUMB_W * 9) / 16);
const ROW_H = THUMB_H + 16;

/**
 * Side panel inside the player: versions of the current item (several media sources)
 * and, for episodes, the season list to jump to another episode.
 */
export function EpisodesPanel({
  visible,
  movie,
  time,
  duration,
  width,
  onPlay,
  onClose,
}: {
  visible: boolean;
  movie: Movie;
  time: number;
  duration: number;
  width: number;
  /** Plays another episode or another version through the next-episode flow. */
  onPlay: (movie: Movie) => void;
  onClose: () => void;
}) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  /** Addon series: the episode list comes from the addon metadata instead of Jellyfin. */
  const online = movie.kind === "Episode" && movie.external?.type === "series" ? movie.external : null;
  const seriesId = movie.kind === "Episode" && !online ? movie.seriesId : null;
  const listed = Boolean(seriesId || online);
  const [seasons, setSeasons] = useState<Array<{ id: string; name: string }>>([]);
  const [seasonId, setSeasonId] = useState<string | null>(online ? String(online.season ?? 0) : movie.seasonId);
  const [episodes, setEpisodes] = useState<Movie[] | null>(null);
  const [onlineMeta, setOnlineMeta] = useState<AddonMetaFull | null>(null);
  const [progress, setProgress] = useState<ResumeEntry[]>([]);
  const [error, setError] = useState("");
  const listRef = useRef<FlatList<Movie>>(null);

  useEffect(() => {
    if (!online || !visible || onlineMeta) return;
    let alive = true;
    api
      .addonMeta("series", online.metaId)
      .then((meta) => {
        if (!alive) return;
        const numbers = [...new Set(sortedVideos(meta.videos).map((v) => v.season ?? 0))];
        setSeasons(numbers.map((n) => ({ id: String(n), name: n === 0 ? tr("specials") : tr("seasonNumber", { n }) })));
        setOnlineMeta(meta);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online?.metaId, visible]);

  useEffect(() => {
    if (!onlineMeta || seasonId == null) return;
    const prefer = online?.prefer;
    setEpisodes(
      sortedVideos(onlineMeta.videos)
        .filter((v) => String(v.season ?? 0) === seasonId)
        .map((v) => {
          const item = videoToMovie(onlineMeta, v);
          const entry = progress.find((p) => p.key === v.id);
          const pct = entry && entry.durationSeconds > 0 ? (entry.positionSeconds / entry.durationSeconds) * 100 : 0;
          return { ...item, external: item.external ? { ...item.external, prefer } : item.external, playedPercentage: Math.min(100, pct), played: pct >= 95 };
        }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineMeta, seasonId, progress]);

  useEffect(() => {
    if (!seriesId || !visible) return;
    let alive = true;
    api
      .getSeasons(seriesId)
      .then((list) => {
        if (!alive) return;
        setSeasons(list.map((season) => ({ id: season.id, name: season.name })));
        setSeasonId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [seriesId, visible]);

  useEffect(() => {
    if (!seriesId || !seasonId || !visible) return;
    let alive = true;
    setEpisodes(null);
    api
      .getEpisodes(seriesId, seasonId)
      .then((list) => {
        if (alive) setEpisodes(list);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [seriesId, seasonId, visible]);

  const currentIndex = useMemo(() => (episodes ? episodes.findIndex((e) => e.id === movie.id) : -1), [episodes, movie.id]);
  const liveProgress = duration > 0 ? Math.min(1, time / duration) : 0;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      side="right"
      width={width}
      title={movie.seriesName ?? movie.name}
      contentStyle={s.content}
    >
      <Text style={s.kicker}>{listed ? tr("episodes") : tr("versions")}</Text>

      {movie.mediaSources.length > 1 ? (
        <View style={s.section}>
          <Text style={s.sectionLabel}>{tr("versions")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
            {movie.mediaSources.map((source) => (
              <Chip
                key={source.id}
                label={source.name}
                selected={source.id === movie.mediaSourceId}
                onPress={() => {
                  if (source.id !== movie.mediaSourceId) onPlay({ ...movie, mediaSourceId: source.id });
                }}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {listed ? (
        <>
          {seasons.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.chips, s.seasons]}>
              {seasons.map((season) => (
                <Chip key={season.id} label={season.name} selected={season.id === seasonId} onPress={() => setSeasonId(season.id)} />
              ))}
            </ScrollView>
          ) : null}
          {error ? <Text style={s.error}>{error}</Text> : null}
          {episodes && !episodes.length && !error ? <Text style={s.error}>{tr("noEpisodes")}</Text> : null}
          {episodes == null && !error ? (
            <View style={s.skeleton}>
              <EpisodeListSkeleton count={6} />
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={episodes ?? []}
              keyExtractor={(episode) => episode.id}
              style={s.list}
              contentContainerStyle={s.listContent}
              initialScrollIndex={currentIndex > 0 ? currentIndex : undefined}
              getItemLayout={(_, index) => ({ length: ROW_H, offset: ROW_H * index, index })}
              onScrollToIndexFailed={() => undefined}
              renderItem={({ item: episode }) => {
                const current = episode.id === movie.id;
                const progress = current ? liveProgress : (episode.playedPercentage || 0) / 100;
                const code = episodeCode(episode, tr("episodeCode"));
                const runtime = formatRuntime(episode.runtimeTicks);
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: current }}
                    onPress={() => (current ? onClose() : onPlay(episode))}
                    style={({ pressed }) => [s.row, current ? s.rowCurrent : null, pressed ? s.rowPressed : null]}
                  >
                    {current ? <View style={s.rail} /> : null}
                    <View style={s.thumb}>
                      {episode.thumbUrl ? <Image source={{ uri: episode.thumbUrl }} contentFit="cover" style={s.thumbImg} /> : null}
                      {episode.played && !current ? (
                        <View style={s.watched}>
                          <Check size={12} color={t.colors.text} strokeWidth={3} />
                        </View>
                      ) : null}
                      {progress > 0 ? <ProgressBar value={progress} height={3} animated={false} style={s.progress} /> : null}
                    </View>
                    <View style={s.textCol}>
                      <Text numberOfLines={1} style={[s.title, current ? s.titleCurrent : null]}>
                        {[code, episode.name].filter(Boolean).join(" · ")}
                      </Text>
                      {runtime ? <Text style={s.runtime}>{runtime}</Text> : null}
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
        </>
      ) : null}
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  content: { flex: 1 },
  kicker: { ...text(11, "semibold", { tracking: 0.08, uppercase: true }), color: t.colors.dim, paddingHorizontal: 20, marginTop: -6, marginBottom: 8 },
  section: { paddingBottom: 8 },
  sectionLabel: { ...text(11, "semibold", { tracking: 0.08, uppercase: true }), color: t.colors.dim, paddingHorizontal: 20, marginBottom: 8 },
  chips: { flexDirection: "row", gap: 8, paddingHorizontal: 20 },
  seasons: { paddingBottom: 12 },
  error: { ...text(13), color: t.colors.muted, paddingHorizontal: 20, paddingVertical: 8 },
  skeleton: { paddingHorizontal: 12 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingBottom: 16 },
  row: { height: ROW_H, flexDirection: "row", alignItems: "center", gap: 12, padding: 8, borderRadius: 10 },
  rowCurrent: { backgroundColor: t.white(0.08) },
  rowPressed: { backgroundColor: t.white(0.06) },
  rail: { position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, backgroundColor: t.colors.accent },
  thumb: { width: THUMB_W, height: THUMB_H, borderRadius: 6, overflow: "hidden", backgroundColor: t.colors.panel, borderWidth: 1, borderColor: t.outline },
  thumbImg: { width: "100%", height: "100%" },
  watched: { position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: t.black(0.7), alignItems: "center", justifyContent: "center" },
  progress: { position: "absolute", left: 0, right: 0, bottom: 0, borderRadius: 0 },
  textCol: { flex: 1, minWidth: 0 },
  title: { ...text(13), color: t.colors.text },
  titleCurrent: { ...text(13, "semibold"), color: t.colors.text },
  runtime: { ...text(11, "regular", { tabular: true }), color: t.colors.dim },
}));
