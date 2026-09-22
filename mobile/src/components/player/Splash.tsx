import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn, FadeOut, useReducedMotion } from "react-native-reanimated";
import type { Movie } from "../../lib/types";
import { useLayout } from "../../theme/responsive";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { Spinner } from "../ui/Spinner";
import { Badges } from "./Badges";

/**
 * Black cover shown until the first frame: backdrop at 50 %, gradient, logo or title,
 * episode line, year + quality badges and a rotating accent ring. The parent unmounts it
 * 450 ms after the file is ready; `FadeOut` covers that fade.
 */
export function Splash({
  movie,
  heading,
  subheading,
  showYear,
}: {
  movie: Movie;
  heading: string;
  subheading: string;
  showYear: boolean;
}) {
  const s = useStyles();
  const t = useTheme();
  const l = useLayout();
  const reduced = useReducedMotion();
  const titleSize = Math.round(Math.min(48, Math.max(28, l.width * 0.04)));
  const logoW = Math.min(420, l.width * 0.7);

  return (
    <Animated.View
      pointerEvents="none"
      exiting={reduced ? undefined : FadeOut.duration(450)}
      style={[StyleSheet.absoluteFill, s.root]}
    >
      {movie.backdropUrl ? (
        <Animated.View entering={reduced ? undefined : FadeIn.duration(400)} style={StyleSheet.absoluteFill}>
          <Image source={{ uri: movie.backdropUrl }} contentFit="cover" style={[StyleSheet.absoluteFill, { opacity: 0.5 }]} />
        </Animated.View>
      ) : null}
      <LinearGradient
        colors={[t.black(0.3), t.black(0.4), "#000000"]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={s.centre}>
        <Animated.View entering={reduced ? undefined : FadeIn.duration(350)} style={s.stack}>
          {movie.logoUrl ? (
            <Image
              source={{ uri: movie.logoUrl }}
              contentFit="contain"
              accessibilityLabel={heading}
              style={{ width: logoW, height: 110 }}
            />
          ) : (
            <Text numberOfLines={2} style={[s.title, text(titleSize, "extrabold", { tracking: -0.02, lineHeight: Math.round(titleSize * 1.05) })]}>
              {heading}
            </Text>
          )}
          {subheading ? <Text numberOfLines={1} style={s.sub}>{subheading}</Text> : null}
          {(showYear && movie.year) || movie.badges.length ? (
            <View style={s.meta}>
              {showYear && movie.year ? <Text style={s.year}>{movie.year}</Text> : null}
              <Badges badges={movie.badges.slice(0, 4)} size="md" />
            </View>
          ) : null}
          <View style={{ marginTop: 8 }}>
            <Spinner size={40} thickness={2} />
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { backgroundColor: "#000000", zIndex: 10 },
  centre: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  stack: { alignItems: "center", gap: 14, paddingHorizontal: 32, maxWidth: 720 },
  title: { color: t.colors.text, textAlign: "center" },
  sub: { ...text(16, "medium"), color: t.white(0.9), textAlign: "center" },
  meta: { flexDirection: "row", alignItems: "center", gap: 8 },
  year: { ...text(13), color: t.colors.muted },
}));
