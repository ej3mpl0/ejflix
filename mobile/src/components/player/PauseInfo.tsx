import React from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import Animated, { FadeIn, FadeOut, useReducedMotion } from "react-native-reanimated";
import type { Movie } from "../../lib/types";
import { formatRuntime } from "../../lib/format";
import { makeStyles } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";

/** Compact metadata block under the title bar while playback is paused (wide screens only). */
export function PauseInfo({ movie, heading, top, left }: { movie: Movie; heading: string; top: number; left: number }) {
  const s = useStyles();
  const reduced = useReducedMotion();
  const meta = [movie.year ? String(movie.year) : null, formatRuntime(movie.runtimeTicks) || null, movie.officialRating].filter(Boolean);
  const genres = movie.genres.slice(0, 3).join(" • ");
  return (
    <Animated.View
      pointerEvents="none"
      entering={reduced ? undefined : FadeIn.duration(220)}
      exiting={reduced ? undefined : FadeOut.duration(160)}
      style={[s.root, { top, left }]}
    >
      {movie.posterUrl ? (
        <Image source={{ uri: movie.posterUrl }} contentFit="cover" style={s.poster} />
      ) : movie.logoUrl ? (
        <Image source={{ uri: movie.logoUrl }} contentFit="contain" style={s.logo} />
      ) : null}
      <View style={s.body}>
        <Text numberOfLines={1} style={s.heading}>
          {heading}
        </Text>
        {meta.length ? <Text style={s.meta}>{meta.join(" · ")}</Text> : null}
        {genres ? <Text style={s.genres}>{genres}</Text> : null}
        {movie.overview ? (
          <Text numberOfLines={3} style={s.overview}>
            {movie.overview}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { position: "absolute", zIndex: 20, flexDirection: "row", alignItems: "flex-start", gap: 16, maxWidth: 460 },
  poster: {
    width: 56,
    height: 84,
    borderRadius: 6,
    backgroundColor: t.colors.panel,
    borderWidth: 1,
    borderColor: t.outline,
  },
  logo: { width: 120, height: 40 },
  body: { flexShrink: 1, minWidth: 0 },
  heading: { ...text(15, "semibold"), color: t.colors.text },
  meta: { ...text(12, "regular", { tabular: true }), color: t.white(0.7), marginTop: 2 },
  genres: { ...text(12), color: t.white(0.6) },
  overview: { ...text(13, "regular", { lineHeight: 19 }), color: t.colors.muted, marginTop: 6 },
}));
