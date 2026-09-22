import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { ExternalLink, Globe, Link2Off, Play } from "lucide-react-native";
import type { AddonStream, Movie } from "../../lib/types";
import { api } from "../../lib/api";
import { formatSize } from "../../lib/addons";
import { episodeCode } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";
import { openPlayer } from "../../navigation/navigationRef";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { useLayout } from "../../theme/responsive";
import { text } from "../../theme/typography";
import { Sheet } from "../ui/Sheet";
import { Shimmer } from "../ui/Shimmer";
import { Chip } from "../ui/Chip";

export type StreamPickerSheetProps = {
  /** Online title (carries `external`); null keeps the sheet closed. */
  movie: Movie | null;
  visible: boolean;
  onClose: () => void;
  /** Defaults to opening the player with the chosen stream. */
  onPick?: (movie: Movie, stream: AddonStream) => void;
};

type Row = { kind: "group"; key: string; name: string } | { kind: "stream"; key: string; stream: AddonStream };
type SortMode = "default" | "quality" | "size" | "seeders";

const QUALITY_ORDER = ["2160p", "4k", "1440p", "1080p", "720p", "576p", "480p", "360p"];

/** Seeders as most torrent addons print them ("👤 123"). */
function seedersOf(stream: AddonStream): number {
  const match = /👤\s*(\d+)/u.exec(stream.title ?? "");
  return match ? Number(match[1]) : -1;
}

/** Size in bytes: the addon's field, else "💾 1.4 GB" in the description. */
function sizeOf(stream: AddonStream): number {
  if (stream.videoSize) return stream.videoSize;
  const match = /💾\s*([\d.,]+)\s*(TB|GB|MB)/iu.exec(stream.title ?? "");
  if (!match) return -1;
  const unit = match[2].toUpperCase();
  return Number(match[1].replace(",", ".")) * 1024 ** (unit === "TB" ? 4 : unit === "GB" ? 3 : 2);
}

function qualityRank(stream: AddonStream): number {
  const haystack = `${stream.name} ${stream.title}`.toLowerCase();
  const index = QUALITY_ORDER.findIndex((q) => haystack.includes(q));
  return index < 0 ? QUALITY_ORDER.length : index;
}

/**
 * Bottom sheet listing the online sources (Stremio addon streams) of a title, grouped
 * by addon. Playable ones open the player; torrents are listed but disabled; external
 * links open in the browser.
 */
export function StreamPickerSheet({ movie, visible, onClose, onPick }: StreamPickerSheetProps) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { wide, width } = useLayout();
  const [streams, setStreams] = useState<AddonStream[] | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<SortMode>("default");
  const ext = movie?.external ?? null;
  const preferred = ext ? api.preferredSource(ext.metaId) : null;
  const isPreferred = (stream: AddonStream) =>
    Boolean(preferred && preferred.bingeGroup && stream.addonUrl === preferred.addonUrl && stream.bingeGroup === preferred.bingeGroup);
  const type = ext?.type;
  const videoId = ext?.videoId;

  useEffect(() => {
    if (!visible || !type || !videoId) return;
    let alive = true;
    setStreams(null);
    setError("");
    api
      .addonStreams(type, videoId)
      .then((list) => {
        if (alive) setStreams(list);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [visible, type, videoId]);

  const rows = useMemo<Row[]>(() => {
    const rank = (stream: AddonStream) =>
      sort === "quality" ? qualityRank(stream) : sort === "size" ? -sizeOf(stream) : sort === "seeders" ? -seedersOf(stream) : 0;
    // The usual source first, then the chosen order (stable: the addon's order breaks ties).
    const ordered = [...(streams ?? [])].sort(
      (a, b) => Number(isPreferred(b)) - Number(isPreferred(a)) || rank(a) - rank(b),
    );
    const groups = new Map<string, AddonStream[]>();
    for (const stream of ordered) {
      const list = groups.get(stream.addonName) ?? [];
      list.push(stream);
      groups.set(stream.addonName, list);
    }
    const out: Row[] = [];
    for (const [name, list] of groups) {
      out.push({ kind: "group", key: `g:${name}`, name });
      list.forEach((stream, i) => out.push({ kind: "stream", key: `${stream.addonUrl}:${name}:${i}`, stream }));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streams, sort, preferred?.addonUrl, preferred?.bingeGroup]);

  const pick = useCallback(
    (stream: AddonStream) => {
      if (!movie?.external) return;
      if (stream.playable && stream.url) {
        api.savePreferredSource(movie.external.metaId, stream);
        onClose();
        if (onPick) onPick(movie, stream);
        else openPlayer({ ...movie, external: { ...movie.external, stream } });
        return;
      }
      if (stream.externalUrl) void Linking.openURL(stream.externalUrl).catch(() => undefined);
    },
    [movie, onClose, onPick],
  );

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === "group") return <Text style={s.group}>{item.name}</Text>;
      const stream = item.stream;
      const external = !stream.playable && !!stream.externalUrl;
      const enabled = stream.playable || external;
      const size = formatSize(stream.videoSize);
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !enabled }}
          disabled={!enabled}
          onPress={() => pick(stream)}
          style={({ pressed }) => [s.row, pressed ? s.rowPressed : null, enabled ? null : { opacity: 0.5 }]}
        >
          <View style={[s.disc, stream.playable ? s.discPlayable : null]}>
            {stream.playable ? (
              <Play size={15} color={t.colors.text} fill={t.colors.text} style={{ marginLeft: 1 }} />
            ) : external ? (
              <ExternalLink size={15} color={t.colors.muted} />
            ) : (
              <Link2Off size={15} color={t.colors.dim} />
            )}
          </View>
          <View style={s.labels}>
            <View style={s.nameRow}>
              <Text numberOfLines={1} style={[s.name, { flexShrink: 1 }]}>
                {stream.name}
              </Text>
              {isPreferred(stream) ? (
                <View style={s.usual}>
                  <Text style={s.usualText}>{tr("usualSource")}</Text>
                </View>
              ) : null}
              {seedersOf(stream) >= 0 ? <Text style={s.seeders}>👤 {seedersOf(stream)}</Text> : null}
            </View>
            <Text numberOfLines={2} style={s.desc}>
              {stream.playable ? stream.title || stream.filename || "" : external ? tr("openLink") : tr("streamUnsupported")}
            </Text>
          </View>
          {size ? <Text style={s.size}>{size}</Text> : null}
        </Pressable>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pick, s, t, tr, preferred?.addonUrl, preferred?.bingeGroup],
  );

  const heading = movie ? (movie.kind === "Episode" ? (movie.seriesName ?? movie.name) : movie.name) : "";
  const sub = movie && movie.kind === "Episode" ? [episodeCode(movie, tr("episodeCode")), movie.name].filter(Boolean).join(" · ") : null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      side={wide && width >= 900 ? "right" : "bottom"}
      snap={0.86}
      width={480}
      contentStyle={{ flex: 1 }}
    >
      <View style={s.header}>
        {movie?.posterUrl ? (
          <View style={s.thumbWrap}>
            <Image source={{ uri: movie.posterUrl }} contentFit="cover" transition={200} cachePolicy="memory-disk" style={StyleSheet.absoluteFill} />
            <View pointerEvents="none" style={s.thumbOutline} />
          </View>
        ) : null}
        <View style={s.headerText}>
          <View style={s.eyebrow}>
            <Globe size={13} color={t.colors.dim} />
            <Text style={s.eyebrowText}>{tr("onlineSources")}</Text>
          </View>
          <Text numberOfLines={2} style={s.heading}>
            {heading}
          </Text>
          {sub ? (
            <Text numberOfLines={1} style={s.sub}>
              {sub}
            </Text>
          ) : null}
        </View>
      </View>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {streams == null && !error ? (
        <View style={s.loading}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Shimmer key={i} height={64} radius={12} delay={i * 80} />
          ))}
          <Text style={s.loadingText}>{tr("loadingStreams")}</Text>
        </View>
      ) : null}
      {streams && !streams.length ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>{tr("noStreams")}</Text>
          <Text style={s.emptyHint}>{tr("noStreamsHint")}</Text>
        </View>
      ) : null}
      {streams && streams.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sorts}>
          {(
            [
              ["default", tr("sortRecommended")],
              ["quality", tr("sortQuality")],
              ["size", tr("sortSize")],
              ["seeders", tr("sortSeeders")],
            ] as Array<[SortMode, string]>
          ).map(([value, label]) => (
            <Chip key={value} label={label} selected={sort === value} onPress={() => setSort(value)} />
          ))}
        </ScrollView>
      ) : null}
      {rows.length ? (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          style={{ flex: 1 }}
        />
      ) : null}
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  header: { flexDirection: "row", alignItems: "flex-start", gap: 16, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  thumbWrap: { width: 64, height: 96, borderRadius: 8, overflow: "hidden", backgroundColor: t.colors.panel },
  thumbOutline: { ...StyleSheet.absoluteFill, borderRadius: 8, borderWidth: 1, borderColor: t.outline },
  headerText: { flex: 1, minWidth: 0 },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 6 },
  eyebrowText: { ...text(11, "semibold", { tracking: 0.08, uppercase: true }), color: t.colors.dim },
  heading: { ...text(20, "semibold", { tracking: -0.01 }), color: t.colors.text, marginTop: 4 },
  sub: { ...text(14), color: t.colors.muted, marginTop: 2 },
  error: { ...text(13), color: t.colors.muted, textAlign: "center", paddingHorizontal: 20, paddingVertical: 24 },
  loading: { paddingHorizontal: 16, gap: 8 },
  loadingText: { ...text(13), color: t.colors.dim, textAlign: "center", paddingTop: 8 },
  empty: { paddingHorizontal: 20, paddingVertical: 40, alignItems: "center" },
  emptyTitle: { ...text(15, "medium"), color: t.colors.text },
  emptyHint: { ...text(13), color: t.colors.dim, marginTop: 4, textAlign: "center" },
  list: { paddingHorizontal: 12, paddingBottom: 16 },
  group: { ...text(11, "semibold", { tracking: 0.08, uppercase: true }), color: t.colors.dim, paddingHorizontal: 8, paddingTop: 12, paddingBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 12, minHeight: 56 },
  rowPressed: { backgroundColor: t.white(0.06) },
  disc: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.white(0.05), alignItems: "center", justifyContent: "center" },
  discPlayable: { backgroundColor: t.white(0.1) },
  labels: { flex: 1, minWidth: 0 },
  name: { ...text(14, "medium"), color: t.colors.text },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  usual: { borderRadius: 5, backgroundColor: t.colors.accent, paddingHorizontal: 6, paddingVertical: 1 },
  usualText: { ...text(10, "bold", { tracking: 0.04, uppercase: true }), color: t.colors.onAccent },
  seeders: { ...text(11, "regular", { tabular: true }), color: t.colors.dim },
  sorts: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  desc: { ...text(12, "regular", { lineHeight: 17 }), color: t.colors.muted, marginTop: 1 },
  size: { ...text(12, "regular", { tabular: true }), color: t.colors.dim },
}));
