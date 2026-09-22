import React, { memo, useCallback, useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Play } from "lucide-react-native";
import type { Movie } from "../../lib/types";
import { episodeCode, formatRuntime, remainingMinutes } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";
import { useItemFlags } from "../../lib/userdata-context";
import { makeStyles } from "../../theme/ThemeProvider";
import { useLayout } from "../../theme/responsive";
import { text } from "../../theme/typography";
import { PressableScale } from "../ui/PressableScale";
import { ProgressBar } from "../ui/ProgressBar";
import { ItemActionSheet } from "./ItemActionSheet";
import { LONG_PRESS_MS } from "./PosterCard";

export type ContinueCardProps = {
  movie: Movie;
  /** Card width (defaults to the layout continue-card width). */
  width?: number;
  /** Tap. */
  onPlay: (movie: Movie) => void;
  /** "View details" of the long-press menu. */
  onOpen: (movie: Movie) => void;
  /** "nextUp" items get a badge instead of a progress bar. */
  variant?: "resume" | "nextUp";
  /** Long-press; when absent the card mounts its own `ItemActionSheet`. */
  onMenu?: (movie: Movie) => void;
  style?: StyleProp<ViewStyle>;
};

function ContinueCardInner({ movie, width, onPlay, onOpen, variant = "resume", onMenu, style }: ContinueCardProps) {
  const s = useStyles();
  const { t } = useI18n();
  const layout = useLayout();
  const flags = useItemFlags(movie);
  const w = width ?? layout.contW;
  const h = Math.round((w * 9) / 16);
  const progress = flags.playedPercentage || 0;
  const started = flags.playbackPositionTicks > 0 && progress > 0;
  const remaining = remainingMinutes(movie.runtimeTicks, flags.playbackPositionTicks);
  const isEpisode = movie.kind === "Episode";
  const code = isEpisode ? episodeCode(movie, t("episodeCode")) : "";
  const title = isEpisode ? (movie.seriesName ?? movie.name) : movie.name;
  const subtitle = isEpisode ? [code, movie.name].filter(Boolean).join(" · ") : null;
  const image = movie.thumbUrl || movie.backdropUrl || movie.posterUrl;
  const label = isEpisode ? `${title} ${subtitle ?? ""}`.trim() : movie.name;
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
        accessibilityLabel={`${t("play")} ${label}`}
        accessibilityHint={t("moreOptions")}
        onPress={() => onPlay(movie)}
        onLongPress={longPress}
        delayLongPress={LONG_PRESS_MS}
        scaleTo={0.97}
        style={[s.card, { width: w, height: h }]}
      >
        {image ? (
          <Image source={{ uri: image }} contentFit="cover" transition={300} cachePolicy="memory-disk" recyclingKey={movie.id} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={s.fallback}>
            <Text numberOfLines={3} style={s.fallbackText}>
              {title}
            </Text>
          </View>
        )}
        <View pointerEvents="none" style={s.scrim} />
        <View pointerEvents="none" style={s.topLine} />
        <View pointerEvents="none" style={s.outline} />
        <View pointerEvents="none" style={s.playDisc}>
          <Play size={20} color="#000000" fill="#000000" strokeWidth={2} style={{ marginLeft: 2 }} />
        </View>
        {variant === "nextUp" && !started ? (
          <View pointerEvents="none" style={s.badge}>
            <Text style={s.badgeText}>{t("nextUpBadge")}</Text>
          </View>
        ) : null}
        {started ? <ProgressBar value={Math.min(100, progress) / 100} height={4} animated={false} style={s.progress} /> : null}
      </PressableScale>
      <Text numberOfLines={1} style={s.title}>
        {title}
      </Text>
      {subtitle ? (
        <Text numberOfLines={1} style={s.subtitle}>
          {subtitle}
        </Text>
      ) : null}
      <Text numberOfLines={1} style={s.meta}>
        {started ? t("remaining", { n: remaining }) : formatRuntime(movie.runtimeTicks)}
      </Text>
      {menuMounted && !onMenu ? (
        <ItemActionSheet movie={movie} visible={menu} onClose={() => setMenu(false)} onOpen={onOpen} onPlay={onPlay} continueRow={variant === "resume"} />
      ) : null}
    </View>
  );
}

/** 16:9 card for "Continue watching" and "Next up" (movies and episodes). Tap plays. */
export const ContinueCard = memo(ContinueCardInner);

const useStyles = makeStyles((t) => ({
  card: {
    borderRadius: t.radii.poster,
    backgroundColor: t.colors.surface,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: t.black(0.12) },
  outline: { ...StyleSheet.absoluteFill, borderRadius: t.radii.poster, borderWidth: 1, borderColor: t.outline },
  topLine: { position: "absolute", top: 0, left: 0, right: 0, height: 1, backgroundColor: t.white(0.08) },
  fallback: { flex: 1, alignSelf: "stretch", alignItems: "center", justifyContent: "center", paddingHorizontal: 12, backgroundColor: t.white(0.05) },
  fallbackText: { ...text(13, "medium", { lineHeight: 18 }), color: t.colors.muted, textAlign: "center" },
  playDisc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.white(0.9),
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  badge: { position: "absolute", top: 8, left: 8, backgroundColor: t.black(0.7), borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { ...text(10, "bold", { tracking: 0.06, uppercase: true, lineHeight: 13 }), color: "#ffffff" },
  progress: { position: "absolute", left: 0, right: 0, bottom: 0, borderRadius: 0 },
  title: { ...text(14, "regular"), color: t.colors.text, marginTop: 8 },
  subtitle: { ...text(12), color: t.colors.muted, marginTop: 1 },
  meta: { ...text(12, "regular", { tabular: true }), color: t.colors.dim, marginTop: 1 },
}));
