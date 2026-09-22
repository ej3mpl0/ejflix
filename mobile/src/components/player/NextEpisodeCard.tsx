import React from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { Play, X } from "lucide-react-native";
import Animated, { SlideInRight, useReducedMotion } from "react-native-reanimated";
import type { Movie } from "../../lib/types";
import { episodeCode } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { IconButton } from "../ui/IconButton";

/** Next-episode card (Nuvio style): thumbnail, code · title, countdown, play badge. */
export function NextEpisodeCard({
  episode,
  countdown,
  onPlay,
  onDismiss,
  right,
  bottom,
}: {
  episode: Movie;
  countdown: number | null;
  onPlay: () => void;
  onDismiss: () => void;
  right: number;
  bottom: number;
}) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const reduced = useReducedMotion();
  const code = episodeCode(episode, tr("episodeCode"));
  const image = episode.thumbUrl ?? episode.backdropUrl ?? episode.posterUrl;

  return (
    <Animated.View entering={reduced ? undefined : SlideInRight.duration(320)} style={[s.root, { right, bottom }]}>
      <Pressable accessibilityRole="button" onPress={onPlay} style={({ pressed }) => [s.body, pressed ? { opacity: 0.85 } : null]}>
        <View style={s.thumb}>{image ? <Image source={{ uri: image }} contentFit="cover" style={s.thumbImg} /> : null}</View>
        <View style={s.textCol}>
          <Text style={s.kicker}>{tr("nextEpisode")}</Text>
          <Text numberOfLines={1} style={s.title}>
            {[code, episode.name].filter(Boolean).join(" · ")}
          </Text>
          <Text numberOfLines={1} style={s.sub}>
            {countdown != null ? tr("playingIn", { n: countdown }) : tr("play")}
          </Text>
        </View>
        <View style={s.play}>
          <Play size={16} color="#000000" fill="#000000" style={{ transform: [{ translateX: 1 }] }} />
        </View>
      </Pressable>
      <View style={s.close}>
        <IconButton icon={X} label={tr("cancelAutoplay")} onPress={onDismiss} size={14} hit={28} color={t.white(0.6)} />
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  root: {
    position: "absolute",
    zIndex: 30,
    width: 292,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.white(0.12),
    backgroundColor: "rgba(25, 25, 25, 0.89)",
    padding: 12,
    shadowColor: "#000",
    shadowOpacity: 0.55,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  body: { flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: 78, height: 44, borderRadius: 6, overflow: "hidden", backgroundColor: t.black(0.4), borderWidth: 1, borderColor: t.outline },
  thumbImg: { width: "100%", height: "100%" },
  textCol: { flex: 1, minWidth: 0, paddingRight: 24 },
  kicker: { ...text(11, "semibold", { tracking: 0.08, uppercase: true }), color: t.white(0.6) },
  title: { ...text(13, "medium"), color: t.colors.text },
  sub: { ...text(12, "regular", { tabular: true }), color: t.white(0.7) },
  play: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" },
  close: { position: "absolute", top: 6, right: 6 },
}));
