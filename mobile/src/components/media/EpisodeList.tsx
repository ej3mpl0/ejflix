import React, { memo, useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { haptic } from "../../lib/haptics";
import { Ellipsis, Play } from "lucide-react-native";
import type { Movie } from "../../lib/types";
import { episodeCode, formatRuntime, remainingMinutes } from "../../lib/format";
import { episodeProgress, isNewlyAired } from "../../lib/episodes";
import { useI18n } from "../../lib/locale-context";
import { useItemFlags } from "../../lib/userdata-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { useLayout } from "../../theme/responsive";
import { text } from "../../theme/typography";
import { IconButton } from "../ui/IconButton";
import { ProgressBar } from "../ui/ProgressBar";
import { WatchedBadge } from "./WatchedBadge";
import { ItemActionSheet } from "./ItemActionSheet";
import { LONG_PRESS_MS } from "./PosterCard";
import { DownloadButton } from "./DownloadButton";
import { canDownload } from "../../services/downloads/downloads.pure";

const STACK_BELOW = 400;

export type EpisodeListProps = {
  episodes: Movie[];
  onPlay: (movie: Movie) => void;
  /** Online sources of one episode (menu entry); needs `seriesImdb` for Jellyfin rows. */
  onOnline?: (movie: Movie) => void;
  seriesImdb?: string | null;
  /** Trailing text of the title line (defaults to the runtime). */
  metaOf?: (episode: Movie) => string | null;
};

function EpisodeRow({
  episode,
  onPlay,
  onMenu,
  meta,
  stacked,
}: {
  episode: Movie;
  onPlay: (movie: Movie) => void;
  onMenu: (movie: Movie) => void;
  meta: string | null;
  stacked: boolean;
}) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const layout = useLayout();
  const flags = useItemFlags(episode);
  const progress = episodeProgress(flags.playedPercentage, flags.played);
  const isNew = isNewlyAired(episode.premiereDate, flags.played);
  const downloadable = canDownload(episode);
  // In progress: the time left replaces the runtime.
  const trailing = progress > 0 && episode.runtimeTicks ? tr("remaining", { n: remainingMinutes(episode.runtimeTicks, flags.playbackPositionTicks) }) : meta;
  const code = episodeCode(episode, tr("episodeCode"));
  const title = [code, episode.name].filter(Boolean).join(" · ");
  const thumbW = stacked ? layout.width - 2 * layout.pagePad - 16 : layout.thumbW;
  const thumbH = Math.round((thumbW * 9) / 16);
  const [open, setOpen] = useState(false);
  const long = (episode.overview?.length ?? 0) > 120;

  const menu = useCallback(() => {
    haptic("medium");
    onMenu(episode);
  }, [episode, onMenu]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${tr("play")} ${title}`}
      onPress={() => onPlay(episode)}
      onLongPress={menu}
      delayLongPress={LONG_PRESS_MS}
      style={({ pressed }) => [s.row, stacked ? s.rowStacked : null, pressed ? s.rowPressed : null]}
    >
      <View style={[s.thumb, { width: thumbW, height: thumbH }]}>
        {episode.thumbUrl ? (
          <Image source={{ uri: episode.thumbUrl }} contentFit="cover" transition={300} cachePolicy="memory-disk" recyclingKey={episode.id} style={StyleSheet.absoluteFill} />
        ) : null}
        <View pointerEvents="none" style={s.playDisc}>
          <Play size={16} color="#000000" fill="#000000" style={{ marginLeft: 1 }} />
        </View>
        <View pointerEvents="none" style={s.thumbOutline} />
        <WatchedBadge movie={episode} size={22} style={s.watched} />
        {isNew ? (
          <View pointerEvents="none" style={s.newBadge}>
            <Text style={s.newText}>{tr("newBadge")}</Text>
          </View>
        ) : null}
        {progress > 0 ? <ProgressBar value={progress} height={4} animated={false} track={t.black(0.55)} style={s.progress} /> : null}
      </View>
      <View style={[s.body, stacked ? s.bodyStacked : null, downloadable ? s.bodyWithDownload : null]}>
        <View style={s.titleRow}>
          <Text numberOfLines={stacked ? 2 : 1} style={s.title}>
            {title}
          </Text>
          {trailing ? <Text style={s.meta}>{trailing}</Text> : null}
        </View>
        {episode.overview ? (
          <Text numberOfLines={open ? undefined : 2} style={s.overview}>
            {episode.overview}
          </Text>
        ) : null}
        {long ? (
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={8} onPress={() => setOpen((v) => !v)}>
            <Text style={s.moreText}>{open ? tr("less") : tr("more")}</Text>
          </Pressable>
        ) : null}
      </View>
      {downloadable ? <DownloadButton movie={episode} variant="icon" style={s.download} /> : null}
      <IconButton icon={Ellipsis} label={tr("moreOptions")} onPress={menu} size={20} color={t.colors.muted} style={s.more} />
    </Pressable>
  );
}

/**
 * Episode rows of a season: 16:9 thumb, `S1:E3 · title`, runtime, overview, progress
 * and the watched check. Tap plays; `⋯` or a long-press opens the item menu.
 */
function EpisodeListInner({ episodes, onPlay, onOnline, seriesImdb = null, metaOf }: EpisodeListProps) {
  const layout = useLayout();
  const stacked = layout.width < STACK_BELOW;
  const [menu, setMenu] = useState<Movie | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = useCallback((movie: Movie) => {
    setMenu(movie);
    setMenuOpen(true);
  }, []);
  return (
    <View style={{ gap: 4 }}>
      {episodes.map((episode) => (
        <EpisodeRow
          key={episode.id}
          episode={episode}
          onPlay={onPlay}
          onMenu={openMenu}
          meta={metaOf ? metaOf(episode) : formatRuntime(episode.runtimeTicks) || null}
          stacked={stacked}
        />
      ))}
      <ItemActionSheet
        movie={menu}
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onPlay={onPlay}
        onOnline={onOnline}
        seriesImdb={seriesImdb}
        showDetails={false}
      />
    </View>
  );
}

export const EpisodeList = memo(EpisodeListInner);

const useStyles = makeStyles((t) => ({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 14, padding: 8, borderRadius: 12 },
  rowStacked: { flexDirection: "column", gap: 10 },
  rowPressed: { backgroundColor: t.white(0.05) },
  thumb: { borderRadius: t.radii.poster, backgroundColor: t.colors.panel, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  thumbOutline: { ...StyleSheet.absoluteFill, borderRadius: t.radii.poster, borderWidth: 1, borderColor: t.outline },
  playDisc: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.white(0.9), alignItems: "center", justifyContent: "center", opacity: 0.92 },
  watched: { position: "absolute", top: 6, right: 6 },
  progress: { position: "absolute", left: 0, right: 0, bottom: 0, borderRadius: 0 },
  body: { flex: 1, minWidth: 0, paddingVertical: 4, paddingRight: 44 },
  bodyStacked: { alignSelf: "stretch", paddingRight: 44 },
  titleRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  title: { ...text(15, "medium"), color: t.colors.text, flex: 1 },
  meta: { ...text(12, "regular", { tabular: true }), color: t.colors.dim },
  overview: { ...text(13, "regular", { lineHeight: 19 }), color: t.colors.muted, marginTop: 4 },
  moreText: { ...text(12, "semibold"), color: t.colors.text, marginTop: 4 },
  more: { position: "absolute", top: 4, right: 4 },
  download: { position: "absolute", top: 4, right: 44 },
  bodyWithDownload: { paddingRight: 88 },
  newBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: t.colors.accent,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  newText: { ...text(10, "bold", { tracking: 0.06, uppercase: true, lineHeight: 13 }), color: t.colors.onAccent },
}));
