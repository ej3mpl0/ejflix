import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { MediaSegment, Movie } from "../../lib/types";
import { useI18n } from "../../lib/locale-context";
import { PREVIEW_WIDTH } from "../../lib/trickplay";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { TimelinePreview } from "./TimelinePreview";

const SCRUB_THROTTLE_MS = 200;
const SCRUB_MIN_DELTA = 1;
const PENDING_MS = 1200;
const PENDING_TOLERANCE = 1.5;
const HIT = 44;

/**
 * Seek bar: 44 dp touch area with a pan gesture (throttled keyframe scrub while dragging,
 * exact seek on release), buffered band, segment bands, chapter ticks and the preview card.
 */
export function Timeline({
  movie,
  time,
  duration,
  cacheTime,
  segments = [],
  onSeekTo,
  onScrub,
  onScrubbing,
}: {
  movie: Movie;
  time: number;
  duration: number;
  cacheTime: number;
  /** Intro / recap / credits ranges, drawn as translucent bands. */
  segments?: MediaSegment[];
  /** Committed, exact seek (on release / tap). */
  onSeekTo: (seconds: number) => void;
  /** Throttled live seek while dragging (keyframe accuracy). */
  onScrub?: (seconds: number) => void;
  /** Current scrub position, or null when the drag ends. */
  onScrubbing: (seconds: number | null) => void;
}) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [dragX, setDragX] = useState(0);
  const [pending, setPending] = useState<{ seconds: number; at: number } | null>(null);
  const dragRef = useRef<number | null>(null);
  const lastScrub = useRef<{ seconds: number; at: number }>({ seconds: -Infinity, at: 0 });
  const latest = useRef({ duration, width, onSeekTo, onScrub, onScrubbing });
  latest.current = { duration, width, onSeekTo, onScrub, onScrubbing };

  const interactive = duration > 0 && width > 0;

  useEffect(() => {
    if (!pending) return;
    if (Math.abs(time - pending.seconds) <= PENDING_TOLERANCE || Date.now() - pending.at > PENDING_MS) setPending(null);
  }, [time, pending]);

  const secondsAt = useCallback((x: number) => {
    const { duration: d, width: w } = latest.current;
    if (w <= 0 || d <= 0) return 0;
    return (Math.min(w, Math.max(0, x)) / w) * d;
  }, []);

  const updateDrag = useCallback(
    (x: number) => {
      const seconds = secondsAt(x);
      dragRef.current = seconds;
      setDrag(seconds);
      setDragX(Math.min(latest.current.width, Math.max(0, x)));
      latest.current.onScrubbing(seconds);
      const now = Date.now();
      const scrub = latest.current.onScrub;
      if (scrub && now - lastScrub.current.at >= SCRUB_THROTTLE_MS && Math.abs(seconds - lastScrub.current.seconds) >= SCRUB_MIN_DELTA) {
        lastScrub.current = { seconds, at: now };
        scrub(seconds);
      }
    },
    [secondsAt],
  );

  const commit = useCallback(() => {
    const seconds = dragRef.current;
    if (seconds == null) return;
    dragRef.current = null;
    setDrag(null);
    setPending({ seconds, at: Date.now() });
    latest.current.onSeekTo(seconds);
    latest.current.onScrubbing(null);
  }, []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(interactive)
        .runOnJS(true)
        .minDistance(0)
        .maxPointers(1)
        .onBegin((e) => {
          lastScrub.current = { seconds: -Infinity, at: 0 };
          updateDrag(e.x);
        })
        .onUpdate((e) => updateDrag(e.x))
        .onFinalize(() => commit()),
    [interactive, updateDrag, commit],
  );

  const shown = drag ?? (pending && Math.abs(time - pending.seconds) > PENDING_TOLERANCE ? pending.seconds : time);
  const pct = (seconds: number) => (interactive ? Math.min(100, Math.max(0, (seconds / duration) * 100)) : 0);
  const progress = pct(shown);
  const buffered = interactive && cacheTime > shown ? pct(cacheTime) : 0;
  const dragging = drag != null;
  const thumb = dragging ? 16 : 12;
  const barH = dragging ? 6 : 4;
  const previewLeft = Math.min(width - PREVIEW_WIDTH / 2 - 4, Math.max(PREVIEW_WIDTH / 2 + 4, dragX));

  return (
    <View style={s.wrap}>
      {dragging && interactive ? (
        <View pointerEvents="none" style={[s.preview, { left: previewLeft - PREVIEW_WIDTH / 2, width: PREVIEW_WIDTH }]}>
          <TimelinePreview key={movie.id} movie={movie} seconds={drag} />
        </View>
      ) : null}
      <GestureDetector gesture={pan}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel={tr("timeline")}
          accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(shown) }}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          style={s.hit}
        >
          <View style={[s.bar, { height: barH, borderRadius: barH }]}>
            {buffered > 0 ? <View style={[s.buffered, { width: `${buffered}%` }]} /> : null}
            {interactive
              ? segments.map((segment) => (
                  <View
                    key={`${segment.kind}:${segment.startSeconds}`}
                    pointerEvents="none"
                    style={[
                      s.segment,
                      { left: `${pct(segment.startSeconds)}%`, width: `${Math.max(0.2, pct(segment.endSeconds) - pct(segment.startSeconds))}%` },
                    ]}
                  />
                ))
              : null}
            {interactive
              ? movie.chapters
                  .filter((chapter) => chapter.startSeconds > 0 && chapter.startSeconds < duration)
                  .map((chapter) => <View key={chapter.index} pointerEvents="none" style={[s.tick, { left: `${pct(chapter.startSeconds)}%` }]} />)
              : null}
            <View style={[s.progress, { width: `${progress}%` }]} />
          </View>
          {interactive ? (
            <View
              pointerEvents="none"
              style={[
                s.thumb,
                {
                  width: thumb,
                  height: thumb,
                  borderRadius: thumb / 2,
                  left: (progress / 100) * width - thumb / 2,
                  top: HIT / 2 - thumb / 2,
                  backgroundColor: t.colors.accent,
                },
              ]}
            />
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { marginBottom: 4 },
  preview: { position: "absolute", bottom: HIT - 4, alignItems: "center", zIndex: 5 },
  hit: { height: HIT, justifyContent: "center" },
  bar: { backgroundColor: t.white(0.2), overflow: "hidden" },
  buffered: { position: "absolute", top: 0, bottom: 0, left: 0, backgroundColor: t.white(0.35) },
  segment: { position: "absolute", top: 0, bottom: 0, backgroundColor: t.white(0.28), borderRadius: 2 },
  tick: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: t.white(0.7) },
  progress: { position: "absolute", top: 0, bottom: 0, left: 0, backgroundColor: t.colors.accent },
  thumb: {
    position: "absolute",
    borderWidth: 2,
    borderColor: t.black(0.25),
  },
}));
