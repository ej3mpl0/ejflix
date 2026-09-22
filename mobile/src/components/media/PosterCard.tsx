import React, { memo, useCallback, useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Globe, Heart } from "lucide-react-native";
import type { Movie } from "../../lib/types";
import { formatRuntime, isRecentlyAdded } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";
import { useItemFlags } from "../../lib/userdata-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { useLayout } from "../../theme/responsive";
import { text } from "../../theme/typography";
import { PressableScale } from "../ui/PressableScale";
import { ProgressBar } from "../ui/ProgressBar";
import { WatchedBadge } from "./WatchedBadge";
import { ItemActionSheet } from "./ItemActionSheet";

export const LONG_PRESS_MS = 400;

export type PosterCardProps = {
  movie: Movie;
  /** Card width (defaults to the layout poster width). */
  width?: number;
  /** Tap. */
  onOpen: (movie: Movie) => void;
  /** Used by the long-press menu ("Play"); defaults to the shared dispatch. */
  onPlay?: (movie: Movie) => void;
  /**
   * Long-press. When given, the parent shows one `ItemActionSheet` for the whole
   * row / grid; otherwise the card mounts its own.
   */
  onMenu?: (movie: Movie) => void;
  style?: StyleProp<ViewStyle>;
};

function PosterCardInner({ movie, width, onOpen, onPlay, onMenu, style }: PosterCardProps) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const layout = useLayout();
  const flags = useItemFlags(movie);
  const w = width ?? layout.posterW;
  const h = Math.round(w * 1.5);
  const runtime = formatRuntime(movie.runtimeTicks);
  const meta = [movie.year ? String(movie.year) : null, runtime || null].filter(Boolean).join(" • ");
  const isNew = isRecentlyAdded(movie.dateCreated);
  const progress = Math.min(100, flags.playedPercentage || 0);
  const [menuMounted, setMenuMounted] = useState(false);
  const [menu, setMenu] = useState(false);

  const longPress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    if (onMenu) onMenu(movie);
    else {
      setMenuMounted(true);
      setMenu(true);
    }
  }, [movie, onMenu]);

  return (
    <View style={[{ width: w }, style]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={movie.name}
        accessibilityHint={tr("moreOptions")}
        onPress={() => onOpen(movie)}
        onLongPress={longPress}
        delayLongPress={LONG_PRESS_MS}
        scaleTo={0.97}
        style={[s.poster, { width: w, height: h }]}
      >
        {movie.posterUrl ? (
          <Image
            source={{ uri: movie.posterUrl }}
            contentFit="cover"
            transition={300}
            cachePolicy="memory-disk"
            recyclingKey={movie.id}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={s.fallback}>
            <Text numberOfLines={4} style={s.fallbackText}>
              {movie.name}
            </Text>
          </View>
        )}
        <View pointerEvents="none" style={s.topLine} />
        <View pointerEvents="none" style={s.outline} />
        {isNew ? (
          <View pointerEvents="none" style={s.newBadge}>
            <Text style={s.newText}>{tr("newBadge")}</Text>
          </View>
        ) : null}
        {movie.external ? (
          <View pointerEvents="none" style={s.globe} accessibilityLabel={tr("online")}>
            {/* A saved online title shows the heart instead of the plain globe. */}
            {flags.favorite ? (
              <Heart size={13} color={t.colors.accent} fill={t.colors.accent} strokeWidth={2} />
            ) : (
              <Globe size={13} color={t.white(0.85)} strokeWidth={2} />
            )}
          </View>
        ) : (
          <WatchedBadge movie={movie} style={s.watched} />
        )}
        {progress > 0 ? <ProgressBar value={progress / 100} height={3} animated={false} style={s.progress} /> : null}
      </PressableScale>
      <Text numberOfLines={1} style={s.title}>
        {movie.name}
      </Text>
      {meta ? (
        <Text numberOfLines={1} style={s.meta}>
          {meta}
        </Text>
      ) : null}
      {menuMounted && !onMenu ? (
        <ItemActionSheet movie={movie} visible={menu} onClose={() => setMenu(false)} onOpen={onOpen} onPlay={onPlay} />
      ) : null}
    </View>
  );
}

/** 2:3 poster with the title under it (Nuvio style). Tap opens, long-press shows the item menu. */
export const PosterCard = memo(PosterCardInner);

const useStyles = makeStyles((t) => ({
  poster: {
    borderRadius: t.radii.poster,
    backgroundColor: t.colors.surface,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  outline: { ...StyleSheet.absoluteFill, borderRadius: t.radii.poster, borderWidth: 1, borderColor: t.outline },
  topLine: { position: "absolute", top: 0, left: 0, right: 0, height: 1, backgroundColor: t.white(0.08) },
  fallback: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, backgroundColor: t.white(0.05) },
  fallbackText: { ...text(13, "medium", { lineHeight: 18 }), color: t.colors.muted, textAlign: "center" },
  newBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: t.colors.accent,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  newText: { ...text(10, "bold", { tracking: 0.06, uppercase: true, lineHeight: 13 }), color: t.colors.onAccent },
  globe: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: t.black(0.6),
    alignItems: "center",
    justifyContent: "center",
  },
  watched: { position: "absolute", top: 8, right: 8 },
  progress: { position: "absolute", left: 0, right: 0, bottom: 0, borderRadius: 0 },
  title: { ...text(13, "medium"), color: t.colors.text, marginTop: 8 },
  meta: { ...text(11, "regular", { tabular: true }), color: t.colors.dim, marginTop: 1 },
}));
