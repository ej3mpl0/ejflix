import React, { memo, useCallback } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Play } from "lucide-react-native";
import type { Chapter, Movie } from "../../lib/types";
import { formatClock } from "../../lib/format";
import { chapterImageUrl, hasChapterImages } from "../../lib/trickplay";
import { useI18n } from "../../lib/locale-context";
import { makeStyles } from "../../theme/ThemeProvider";
import { useLayout } from "../../theme/responsive";
import { text } from "../../theme/typography";
import { PressableScale } from "../ui/PressableScale";

const ITEM_W = 168;
const GAP = 12;

/** Chapter thumbnails of a movie; tapping one starts playback there. Bleeds to the page edges. */
function ChaptersRailInner({ movie, onPlay }: { movie: Movie; onPlay: (movie: Movie) => void }) {
  const s = useStyles();
  const { t } = useI18n();
  const { pagePad } = useLayout();
  const chapters = hasChapterImages(movie.chapters) ? movie.chapters : [];

  const renderItem = useCallback(
    ({ item }: { item: Chapter }) => {
      const image = chapterImageUrl(movie.id, item);
      const name = item.name ?? `${t("chapter")} ${item.index + 1}`;
      const clock = formatClock(item.startSeconds);
      return (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${name} · ${clock}`}
          onPress={() => onPlay({ ...movie, playbackPositionTicks: Math.round(item.startSeconds * 10_000_000) })}
          style={{ width: ITEM_W }}
        >
          <View style={s.thumb}>
            {image ? <Image source={{ uri: image }} contentFit="cover" transition={300} cachePolicy="memory-disk" recyclingKey={`${movie.id}:${item.index}`} style={StyleSheet.absoluteFill} /> : null}
            <View pointerEvents="none" style={s.playDisc}>
              <Play size={14} color="#000000" fill="#000000" style={{ marginLeft: 1 }} />
            </View>
            <View pointerEvents="none" style={s.outline} />
            <View pointerEvents="none" style={s.clock}>
              <Text style={s.clockText}>{clock}</Text>
            </View>
          </View>
          <Text numberOfLines={1} style={s.name}>
            {name}
          </Text>
        </PressableScale>
      );
    },
    [movie, onPlay, s, t],
  );

  if (!chapters.length) return null;
  return (
    <View style={{ marginHorizontal: -pagePad }}>
      <Text style={[s.heading, { paddingHorizontal: pagePad }]}>{t("chapters")}</Text>
      <FlatList
        horizontal
        data={chapters}
        keyExtractor={(c) => String(c.index)}
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: pagePad, gap: GAP }}
        snapToInterval={ITEM_W + GAP}
        snapToAlignment="start"
        decelerationRate="fast"
        initialNumToRender={6}
        getItemLayout={(_, index) => ({ length: ITEM_W + GAP, offset: pagePad + index * (ITEM_W + GAP), index })}
      />
    </View>
  );
}

export const ChaptersRail = memo(ChaptersRailInner);

const useStyles = makeStyles((t) => ({
  heading: { ...text(18, "semibold", { tracking: -0.01 }), color: t.colors.text, marginBottom: 14 },
  thumb: {
    width: ITEM_W,
    height: Math.round((ITEM_W * 9) / 16),
    borderRadius: t.radii.poster,
    backgroundColor: t.colors.panel,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  outline: { ...StyleSheet.absoluteFill, borderRadius: t.radii.poster, borderWidth: 1, borderColor: t.outline },
  playDisc: { width: 32, height: 32, borderRadius: 16, backgroundColor: t.white(0.9), alignItems: "center", justifyContent: "center", opacity: 0.9 },
  clock: { position: "absolute", right: 6, bottom: 6, backgroundColor: t.black(0.7), borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  clockText: { ...text(11, "regular", { tabular: true, lineHeight: 14 }), color: t.colors.text },
  name: { ...text(12), color: t.colors.muted, marginTop: 6 },
}));
