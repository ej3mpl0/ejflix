import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeIn,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useIsFocused } from "@react-navigation/native";
import { Info, Play } from "lucide-react-native";
import type { Movie } from "../../lib/types";
import { formatRuntime } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";
import { alpha } from "../../theme/color";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { useLayout } from "../../theme/responsive";
import { text } from "../../theme/typography";
import { Pill } from "../ui/Pill";
import { FavoriteButton } from "./FavoriteButton";
import { QualityBadges } from "./QualityBadges";

const AUTO_ADVANCE_MS = 8000;
const DRAG_THRESHOLD = 60;
const FADE_MS = 700;
const EASE = Easing.bezier(0.2, 0, 0, 1);

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export type HeroCarouselProps = {
  items: Movie[];
  onPlay: (movie: Movie) => void;
  onDetails: (movie: Movie) => void;
  /** Page scroll offset for the 0.3 parallax of the backdrop. */
  scrollY?: SharedValue<number>;
};

function Dot({ active, onPress, label }: { active: boolean; onPress: () => void; label: string }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const w = useSharedValue(active ? 32 : 8);
  useEffect(() => {
    w.value = reduced ? (active ? 32 : 8) : withTiming(active ? 32 : 8, { duration: 220, easing: EASE });
  }, [active, reduced, w]);
  const style = useAnimatedStyle(() => ({ width: w.value }));
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={label} onPress={onPress} hitSlop={8} style={{ height: 24, justifyContent: "center", paddingHorizontal: 2 }}>
      <Animated.View style={[{ height: 8, borderRadius: 4, backgroundColor: active ? t.colors.accent : t.white(0.4) }, style]} />
    </Pressable>
  );
}

/**
 * Full-bleed hero carousel (Nuvio style): cross-fading backdrops with scroll parallax,
 * logo or title, meta line, actions and stretchy page dots. Auto-advances every 8 s
 * unless touched, unfocused, backgrounded or under reduced motion; swipes turn pages.
 */
function HeroCarouselInner({ items, onPlay, onDetails, scrollY }: HeroCarouselProps) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const layout = useLayout();
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const [index, setIndex] = useState(0);
  const [previous, setPrevious] = useState<Movie | null>(null);
  const [dir, setDir] = useState<1 | -1>(1);
  const [touching, setTouching] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const count = items.length;
  const safeIndex = count ? index % count : 0;
  const current = items[safeIndex];
  const portraitCompact = layout.sizeClass === "compact" && !layout.landscape;
  const heroH = layout.heroH;

  const own = useSharedValue(0);
  const scroll = scrollY ?? own;
  const fade = useSharedValue(1);
  const dirRef = useRef<1 | -1>(1);
  dirRef.current = dir;

  const go = useCallback(
    (delta: 1 | -1) => {
      if (count < 2) return;
      setPrevious(items[safeIndex] ?? null);
      setDir(delta);
      setIndex((safeIndex + delta + count) % count);
    },
    [count, items, safeIndex],
  );

  const goTo = useCallback(
    (target: number) => {
      if (target === safeIndex || count < 2) return;
      setPrevious(items[safeIndex] ?? null);
      setDir(target > safeIndex ? 1 : -1);
      setIndex(target);
    },
    [count, items, safeIndex],
  );

  // Incoming backdrop: fade + 3 % lateral drift (`hero-in`), 700 ms.
  useEffect(() => {
    if (!current) return;
    fade.value = 0;
    fade.value = reduced ? 1 : withTiming(1, { duration: FADE_MS, easing: EASE });
  }, [current?.id, fade, reduced]);

  // Drop the outgoing backdrop once the cross-fade is over.
  useEffect(() => {
    if (!previous) return;
    const handle = setTimeout(() => setPrevious(null), FADE_MS + 50);
    return () => clearTimeout(handle);
  }, [previous]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (count < 2 || touching || !focused || !appActive || reduced) return;
    const handle = setInterval(() => go(1), AUTO_ADVANCE_MS);
    return () => clearInterval(handle);
  }, [count, touching, focused, appActive, reduced, go]);

  const parallax = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(0, scroll.value) * 0.3 }] }));
  const incoming = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ scale: 1.14 }, { translateX: (1 - fade.value) * dirRef.current * 0.03 * layout.width }],
  }));

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-16, 16])
        .failOffsetY([-12, 12])
        .onBegin(() => {
          runOnJS(setTouching)(true);
        })
        .onEnd((e) => {
          if (Math.abs(e.translationX) >= DRAG_THRESHOLD) runOnJS(go)(e.translationX < 0 ? 1 : -1);
        })
        .onFinalize(() => {
          runOnJS(setTouching)(false);
        }),
    [go],
  );

  if (!current) return null;

  const imageOf = (m: Movie) => (portraitCompact ? m.posterUrl ?? m.backdropUrl : m.backdropUrl ?? m.posterUrl);
  const resume = current.playbackPositionTicks > 10_000_000 * 30;
  const typeLabel = current.kind === "Series" ? tr("seriesOne") : current.kind === "Episode" ? tr("episode") : tr("movie");
  const meta = [typeLabel, current.genres[0] ?? null, current.year ? String(current.year) : null].filter((p): p is string => Boolean(p));
  const runtime = formatRuntime(current.runtimeTicks);
  const base = t.colors.base;
  const titleSize = clamp(0.09 * layout.width, 32, 72);
  const bottom = layout.sizeClass === "compact" ? 32 : 64;
  const contentMaxW = layout.wide ? Math.min(640, layout.width * 0.6) : undefined;
  const logoH = clamp(0.12 * heroH, 56, 112);

  const dots =
    count > 1 ? (
      <View accessibilityRole="tablist" style={s.dots}>
        {items.map((item, i) => (
          <Dot key={item.id} active={i === safeIndex} label={tr("slide", { n: i + 1 })} onPress={() => goTo(i)} />
        ))}
      </View>
    ) : null;

  return (
    <GestureDetector gesture={pan}>
      <View style={[s.root, { height: heroH }]} accessibilityRole="summary">
        <Animated.View style={[StyleSheet.absoluteFill, parallax]}>
          {previous && imageOf(previous) ? (
            <Image
              key={`prev-${previous.id}`}
              source={{ uri: imageOf(previous) as string }}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={`hero-${previous.id}`}
              style={[StyleSheet.absoluteFill, { transform: [{ scale: 1.14 }] }]}
            />
          ) : null}
          {imageOf(current) ? (
            <Animated.View key={current.id} style={[StyleSheet.absoluteFill, incoming]}>
              <Image
                source={{ uri: imageOf(current) as string }}
                contentFit="cover"
                transition={previous ? 0 : 300}
                cachePolicy="memory-disk"
                recyclingKey={`hero-${current.id}`}
                priority="high"
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          ) : null}
        </Animated.View>
        <LinearGradient
          pointerEvents="none"
          colors={[alpha(base, 0.02), alpha(base, 0.12), alpha(base, 0.34), alpha(base, 0.78)]}
          locations={[0, 0.4, 0.7, 1]}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient pointerEvents="none" colors={["transparent", base]} style={[s.bottomScrim, { height: Math.min(220, heroH * 0.4) }]} />
        <LinearGradient
          pointerEvents="none"
          colors={[alpha(base, 0.8), alpha(base, 0.3), "transparent"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[s.leftScrim, { width: layout.wide ? "55%" : "85%" }]}
        />

        <Animated.View
          key={`content-${current.id}`}
          entering={reduced ? undefined : FadeIn.duration(400)}
          style={[s.content, { left: layout.pagePad, right: layout.pagePad, bottom, maxWidth: contentMaxW }]}
        >
          {current.logoUrl ? (
            <Image
              source={{ uri: current.logoUrl }}
              contentFit="contain"
              contentPosition="left"
              transition={300}
              cachePolicy="memory-disk"
              accessibilityLabel={current.name}
              style={[s.logo, { height: logoH, width: "62%" }]}
            />
          ) : (
            <Text numberOfLines={3} style={[s.title, { fontSize: titleSize, lineHeight: Math.round(titleSize * 1.02) }]}>
              {current.name}
            </Text>
          )}
          <View style={s.metaRow}>
            {meta.map((part, i) => (
              <React.Fragment key={`${part}-${i}`}>
                {i > 0 ? <View style={s.dotSep} /> : null}
                <Text style={s.metaText}>{part}</Text>
              </React.Fragment>
            ))}
            {runtime ? (
              <>
                <View style={s.dotSep} />
                <Text style={[s.metaText, { fontVariant: ["tabular-nums"] }]}>{runtime}</Text>
              </>
            ) : null}
            {current.communityRating ? (
              <>
                <View style={s.dotSep} />
                <Text style={[s.metaText, { color: t.colors.star, fontVariant: ["tabular-nums"] }]}>★ {current.communityRating.toFixed(1)}</Text>
              </>
            ) : null}
            <QualityBadges badges={current.badges.slice(0, 3)} style={{ marginLeft: 4 }} />
          </View>
          {current.overview ? (
            <Text numberOfLines={3} style={s.overview}>
              {current.overview}
            </Text>
          ) : null}
          <View style={s.actions}>
            <Pill variant="primary" pill size="lg" iconNode={<Play size={18} color={t.colors.onAccent} fill={t.colors.onAccent} style={{ marginLeft: 1 }} />} label={resume ? tr("resume") : tr("play")} onPress={() => onPlay(current)} />
            <Pill variant="tonal" pill size="lg" icon={Info} label={tr("viewDetails")} onPress={() => onDetails(current)} />
            {current.external ? null : <FavoriteButton movie={current} pill size="lg" />}
          </View>
          {!layout.wide && dots ? <View style={{ marginTop: 16 }}>{dots}</View> : null}
        </Animated.View>

        {layout.wide && dots ? <View style={[s.dotsWide, { right: layout.pagePad, bottom: bottom + 12 }]}>{dots}</View> : null}
      </View>
    </GestureDetector>
  );
}

export const HeroCarousel = memo(HeroCarouselInner);

const useStyles = makeStyles((t) => ({
  root: {
    width: "100%",
    overflow: "hidden",
    backgroundColor: t.colors.surface,
    borderBottomLeftRadius: t.radii.hero,
    borderBottomRightRadius: t.radii.hero,
  },
  bottomScrim: { position: "absolute", left: 0, right: 0, bottom: 0 },
  leftScrim: { position: "absolute", top: 0, bottom: 0, left: 0 },
  content: { position: "absolute" },
  logo: { marginBottom: 18, alignSelf: "flex-start" },
  title: { ...text(56, "extrabold", { tracking: -0.02 }), color: t.colors.text, marginBottom: 14 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 },
  metaText: { ...text(14), color: t.white(0.8) },
  dotSep: { width: 4, height: 4, borderRadius: 2, backgroundColor: t.white(0.5) },
  overview: { ...text(15, "regular", { lineHeight: 24 }), color: t.colors.muted, marginBottom: 20, maxWidth: 560 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  dots: { flexDirection: "row", alignItems: "center", gap: 4 },
  dotsWide: { position: "absolute" },
}));
