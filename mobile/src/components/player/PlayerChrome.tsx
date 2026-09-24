import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  Info,
  ArrowLeft,
  AudioLines,
  Captions,
  Gauge,
  ListVideo,
  Lock,
  Pause,
  PictureInPicture2,
  Play,
  Ratio,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Tv,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import type { MediaSegment, Movie, PlayerState, Programme } from "../../lib/types";
import { episodeCode, formatClock } from "../../lib/format";
import { aspectLabel } from "../../lib/aspect";
import { formatRange } from "../../lib/iptv";
import { useI18n } from "../../lib/locale-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { useLayout } from "../../theme/responsive";
import { text } from "../../theme/typography";
import { Glass } from "../ui/Glass";
import { IconButton } from "../ui/IconButton";
import { IconSwap } from "../ui/IconSwap";
import { PressableScale } from "../ui/PressableScale";
import { Badges } from "./Badges";
import { LiveStrip } from "./LiveStrip";
import { formatSpeed } from "./SpeedSheet";
import { Timeline } from "./Timeline";
import { isSeriesEpisode } from "../../lib/addons";
import { useSettings } from "../../lib/settings-context";
import { trackShortName } from "./TrackSheet";

/** Bottom sheet opened from the chip row (desktop `PlayerMenu`). */
export type PlayerSheet = "speed" | "audio" | "sub" | "stats" | null;

/** What the chrome shows while an IPTV channel plays (desktop `LiveInfo`). */
export type LiveInfo = {
  number: number | null;
  now: Programme | null;
  next: Programme | null;
  /** A past programme from the archive: labelled as such, with its own progress. */
  catchup?: boolean;
};

/** Height of the bottom block, so floating cards can sit above it. */
export const CHROME_BOTTOM_HEIGHT = 168;

const FADE_MS = 200;

function ControlChip({
  icon: Icon,
  label,
  active = false,
  onPress,
  accessibilityLabel,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const s = useStyles();
  const t = useTheme();
  const fg = active ? t.colors.text : t.white(0.9);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[s.chip, active ? s.chipActive : null]}
    >
      <Icon size={16} color={fg} strokeWidth={2} />
      <Text numberOfLines={1} style={[s.chipLabel, { color: fg }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** "EN DIRECTO" pill with a slowly pulsing dot, in place of the clock. */
function LivePill({ catchup = false }: { catchup?: boolean }) {
  const s = useStyles();
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(withTiming(0.25, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduced, pulse]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={s.livePill}>
      <Animated.View style={[s.livePillDot, dotStyle]} />
      <Text style={s.livePillText}>{catchup ? t("catchup") : t("liveBadge")}</Text>
    </View>
  );
}

/**
 * Control layer of the player (desktop `PlayerControls`): top bar with the title, bottom
 * block with the timeline (or the live strip), the transport row and the chip row.
 * The whole thing fades over 200 ms and stops taking touches while hidden.
 */
export function PlayerChrome({
  movie,
  timelineMovie,
  segments,
  state,
  visible,
  sheet,
  remaining,
  panelOpen,
  live = null,
  onSheet,
  onToggleRemaining,
  onBack,
  onTogglePause,
  onSeek,
  onSeekTo,
  onScrub,
  onMute,
  onAspect,
  onLock,
  onPanel,
  externalSub = null,
  onPip = null,
  onZap,
  onReveal,
  onHoldUi,
}: {
  movie: Movie;
  /** Movie with trickplay / chapters for the timeline (may be a fuller copy). */
  timelineMovie: Movie;
  segments: MediaSegment[];
  state: PlayerState;
  visible: boolean;
  /** Sheet currently open (the chip stays highlighted). */
  sheet: PlayerSheet;
  /** Show the time left instead of elapsed / total. */
  remaining: boolean;
  panelOpen: boolean;
  /** Set while a live channel plays: no timeline, programme on air instead of the clock. */
  live?: LiveInfo | null;
  onSheet: (sheet: PlayerSheet) => void;
  onToggleRemaining: () => void;
  onBack: () => void;
  onTogglePause: () => void;
  onSeek: (delta: number) => void;
  onSeekTo: (seconds: number) => void;
  /** Throttled live seek while dragging the timeline. */
  onScrub: (seconds: number) => void;
  onMute: () => void;
  onAspect: () => void;
  onLock: () => void;
  onPanel: () => void;
  /** Name of the subtitle file the app is drawing itself, if one is loaded. */
  externalSub?: string | null;
  /** Enters picture-in-picture; null when the device cannot. */
  onPip?: (() => void) | null;
  /** Previous (−1) / next (+1) channel of the group. */
  onZap: (dir: 1 | -1) => void;
  onReveal: () => void;
  onHoldUi: (hold: boolean) => void;
}) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const seekStep = useSettings().settings.playback.seekStep;
  const { insets, width } = useLayout();
  const reduced = useReducedMotion();
  const [scrub, setScrub] = useState<number | null>(null);
  const [chipsWidth, setChipsWidth] = useState(0);

  const fade = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    fade.value = reduced
      ? visible
        ? 1
        : 0
      : withTiming(visible ? 1 : 0, { duration: FADE_MS, easing: Easing.bezier(0.2, 0, 0, 1) });
  }, [visible, reduced, fade]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const shownTime = scrub ?? state.time;
  const clock =
    remaining && state.duration > 0
      ? `-${formatClock(Math.max(0, state.duration - shownTime))}`
      : `${formatClock(shownTime)} / ${formatClock(state.duration)}`;

  const isEpisode = isSeriesEpisode(movie);
  const heading = isEpisode ? movie.seriesName ?? movie.name : movie.name;
  const episodeLine = isEpisode ? [episodeCode(movie, tr("episodeCode")), movie.name].filter(Boolean).join(" · ") : "";
  const hasVersions = movie.mediaSources.length > 1;
  const showPanel = isEpisode || hasVersions || live != null;
  const panelLabel = live ? tr("channels") : isEpisode ? tr("episodes") : tr("versions");
  const liveLine = live ? (live.now ? `${formatRange(live.now, locale)} · ${live.now.title}` : movie.genres[0] ?? "") : "";

  const padLeft = 24 + insets.left;
  const padRight = 24 + insets.right;
  const available = Math.max(0, width - padLeft - padRight);
  const scrollChips = chipsWidth > available;

  const toggleSheet = (next: Exclude<PlayerSheet, null>) => onSheet(sheet === next ? null : next);
  // The chips name the track in use ("English"), not just the kind of menu they open.
  const currentSub = state.tracks.find((track) => track.kind === "sub" && track.selected) ?? null;
  const currentAudio = state.tracks.find((track) => track.kind === "audio" && track.selected) ?? null;
  const subLabel = externalSub ?? (currentSub ? trackShortName(currentSub, locale) : tr("subtitlesOff"));
  const audioLabel = currentAudio ? trackShortName(currentAudio, locale) : tr("audio");

  const chips = (
    <>
      <ControlChip
        icon={Ratio}
        label={aspectLabel(state.aspect, tr)}
        accessibilityLabel={tr("aspectRatio")}
        active={state.aspect !== "auto"}
        onPress={onAspect}
      />
      {live ? null : (
        <ControlChip
          icon={Gauge}
          label={formatSpeed(state.speed)}
          accessibilityLabel={tr("playbackSpeed")}
          active={sheet === "speed"}
          onPress={() => toggleSheet("speed")}
        />
      )}
      <ControlChip
        icon={Captions}
        label={subLabel}
        accessibilityLabel={`${tr("subtitles")}: ${subLabel}`}
        active={sheet === "sub" || currentSub != null || externalSub != null}
        onPress={() => toggleSheet("sub")}
      />
      <ControlChip
        icon={AudioLines}
        label={audioLabel}
        accessibilityLabel={`${tr("audio")}: ${audioLabel}`}
        active={sheet === "audio"}
        onPress={() => toggleSheet("audio")}
      />
      {live ? null : (
        <ControlChip icon={Info} label={tr("statsTitle")} active={sheet === "stats"} onPress={() => toggleSheet("stats")} />
      )}
      {showPanel ? <ControlChip icon={live ? Tv : ListVideo} label={panelLabel} active={panelOpen} onPress={onPanel} /> : null}
    </>
  );

  return (
    <Animated.View pointerEvents={visible ? "box-none" : "none"} style={[StyleSheet.absoluteFill, s.root, fadeStyle]}>
      <LinearGradient
        pointerEvents="none"
        colors={[t.black(0.8), t.black(0.4), t.black(0)]}
        locations={[0, 0.5, 1]}
        style={s.topGradient}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[t.black(0), t.black(0.7), "#000000"]}
        locations={[0, 0.55, 1]}
        style={s.bottomGradient}
      />

      <View pointerEvents="box-none" style={[s.top, { paddingTop: insets.top + 8, paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right }]}>
        <IconButton icon={ArrowLeft} label={tr("back")} onPress={onBack} size={22} hit={44} color={t.colors.text} />
        <View style={s.titleCol}>
          <Text numberOfLines={1} style={s.heading}>
            {heading}
          </Text>
          <View style={s.metaRow}>
            {live ? (
              <View style={s.liveBadge}>
                <View style={s.liveDot} />
                <Text style={s.liveBadgeText}>{live.catchup ? tr("catchup") : tr("liveBadge")}</Text>
              </View>
            ) : null}
            {live && live.number != null ? <Text style={s.number}>{String(live.number)}</Text> : null}
            {liveLine ? (
              <Text numberOfLines={1} style={s.meta}>
                {liveLine}
              </Text>
            ) : null}
            {episodeLine ? (
              <Text numberOfLines={1} style={s.meta}>
                {episodeLine}
              </Text>
            ) : null}
            {!isEpisode && !live && movie.year ? <Text style={s.meta}>{String(movie.year)}</Text> : null}
            <Badges badges={movie.badges.slice(0, 3)} />
          </View>
        </View>
        <View style={s.topRight}>
          {onPip ? (
            <IconButton icon={PictureInPicture2} label={tr("pip")} onPress={onPip} size={20} hit={44} color={t.white(0.85)} />
          ) : null}
          <IconButton icon={Lock} label={tr("lockControls")} onPress={onLock} size={19} hit={44} color={t.white(0.85)} />
          {showPanel ? (
            <IconButton
              icon={live ? Tv : ListVideo}
              label={panelLabel}
              onPress={onPanel}
              size={20}
              hit={44}
              variant={panelOpen ? "tonal" : "plain"}
              active={panelOpen}
              color={panelOpen ? t.colors.text : t.white(0.85)}
            />
          ) : null}
        </View>
      </View>

      <View
        pointerEvents="box-none"
        style={[s.bottom, { paddingLeft: padLeft, paddingRight: padRight, paddingBottom: insets.bottom + 10 }]}
      >
        {live ? (
          <LiveStrip
            now={live.now}
            next={live.next}
            progress={live.catchup && live.now ? state.time / Math.max(1, live.now.stop - live.now.start) : undefined}
          />
        ) : (
          <Timeline
            movie={timelineMovie}
            time={state.time}
            duration={state.duration}
            cacheTime={state.cacheTime}
            segments={segments}
            onSeekTo={onSeekTo}
            onScrub={onScrub}
            onScrubbing={(seconds) => {
              setScrub(seconds);
              if (seconds != null) {
                onHoldUi(true);
              } else {
                onHoldUi(false);
                onReveal();
              }
            }}
          />
        )}

        <View pointerEvents="box-none" style={s.transport}>
          <View pointerEvents="box-none" style={s.side}>
            <IconButton
              icon={state.mute ? VolumeX : Volume2}
              label={state.mute ? tr("unmute") : tr("mute")}
              onPress={onMute}
              size={20}
              hit={44}
              color={t.colors.text}
            />
            {live ? (
              <LivePill catchup={live.catchup} />
            ) : (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={remaining ? tr("elapsedTime") : tr("remainingTime")}
                onPress={onToggleRemaining}
                style={s.clock}
              >
                <Text style={s.clockText}>{clock}</Text>
              </PressableScale>
            )}
          </View>

          <View pointerEvents="box-none" style={s.centre}>
            <IconButton
              icon={live ? SkipBack : RotateCcw}
              label={live ? tr("previousChannel") : tr("seekBack")}
              onPress={() => (live ? onZap(-1) : onSeek(-seekStep))}
              size={22}
              hit={48}
              color={t.colors.text}
            />
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={state.paused ? tr("play") : tr("pause")}
              onPress={onTogglePause}
              style={s.playButton}
            >
              <IconSwap on={state.paused} iconOn={Play} iconOff={Pause} size={26} color={t.colors.text} fillOn />
            </PressableScale>
            <IconButton
              icon={live ? SkipForward : RotateCw}
              label={live ? tr("nextChannel") : tr("seekForward")}
              onPress={() => (live ? onZap(1) : onSeek(seekStep))}
              size={22}
              hit={48}
              color={t.colors.text}
            />
          </View>

          <View pointerEvents="box-none" style={[s.side, s.sideRight]}>
            <IconButton icon={Ratio} label={tr("aspectRatio")} onPress={onAspect} size={20} hit={44} color={t.colors.text} />
          </View>
        </View>

        <View pointerEvents="box-none" style={s.chipRow}>
          <Glass
            variant="pill"
            blur={false}
            style={[s.chipBar, { maxWidth: available }, chipsWidth > 0 ? { width: Math.min(chipsWidth, available) } : null]}
          >
            <ScrollView
              horizontal
              scrollEnabled={scrollChips}
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              contentContainerStyle={s.chips}
              onContentSizeChange={(w) => setChipsWidth(Math.ceil(w))}
            >
              {chips}
            </ScrollView>
          </Glass>
        </View>
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { zIndex: 25 },
  topGradient: { position: "absolute", left: 0, right: 0, top: 0, height: 160 },
  bottomGradient: { position: "absolute", left: 0, right: 0, bottom: 0, height: 280 },

  top: { position: "absolute", left: 0, right: 0, top: 0, flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 8 },
  titleCol: { flex: 1, minWidth: 0 },
  heading: { ...text(15, "medium"), color: t.colors.text },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 1 },
  meta: { ...text(12), color: t.colors.muted, flexShrink: 1 },
  number: { ...text(12, "regular", { tabular: true }), color: t.colors.muted },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 4,
    backgroundColor: t.colors.accent,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.colors.onAccent },
  liveBadgeText: { ...text(9, "bold", { tracking: 0.06, uppercase: true, lineHeight: 12 }), color: t.colors.onAccent },
  topRight: { flexDirection: "row", alignItems: "center", gap: 2 },

  bottom: { position: "absolute", left: 0, right: 0, bottom: 0 },
  transport: { height: 56, flexDirection: "row", alignItems: "center" },
  side: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  sideRight: { justifyContent: "flex-end" },
  centre: { ...StyleSheet.absoluteFill, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  playButton: { width: 56, height: 56, borderRadius: 28, backgroundColor: t.white(0.12), alignItems: "center", justifyContent: "center" },
  clock: { paddingHorizontal: 6, paddingVertical: 6, borderRadius: 8 },
  clockText: { ...text(13, "regular", { tabular: true }), color: t.white(0.9) },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: 4,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  livePillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.colors.accent },
  livePillText: { ...text(11, "bold", { tracking: 0.06, uppercase: true, lineHeight: 14 }), color: t.colors.accent },

  chipRow: { alignItems: "center", marginTop: 4 },
  chipBar: { alignSelf: "center" },
  chips: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 6, paddingVertical: 6 },
  chip: { height: 36, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: t.radii.pill, paddingHorizontal: 14 },
  chipActive: { backgroundColor: t.white(0.15) },
  chipLabel: { ...text(13, "medium", { tabular: true }) },
}));
