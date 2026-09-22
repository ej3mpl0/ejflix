import React, { memo, useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Ellipsis, Play } from "lucide-react-native";
import type { Movie } from "../../lib/types";
import { episodeCode, formatRuntime } from "../../lib/format";
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
  const progress = Math.min(100, flags.playedPercentage || 0);
  const code = episodeCode(episode, tr("episodeCode"));
  const title = [code, episode.name].filter(Boolean).join(" · ");
  const thumbW = stacked ? layout.width - 2 * layout.pagePad - 16 : layout.thumbW;
  const thumbH = Math.round((thumbW * 9) / 16);

  const menu = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
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
        {progress > 0 ? <ProgressBar value={progress / 100} height={3} animated={false} style={s.progress} /> : null}
      </View>
      <View style={[s.body, stacked ? s.bodyStacked : null]}>
        <View style={s.titleRow}>
          <Text numberOfLines={stacked ? 2 : 1} style={s.title}>
            {title}
          </Text>
          {meta ? <Text style={s.meta}>{meta}</Text> : null}
        </View>
        {episode.overview ? (
          <Text numberOfLines={2} style={s.overview}>
            {episode.overview}
          </Text>
        ) : null}
      </View>
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
  more: { position: "absolute", top: 4, right: 4 },
}));
