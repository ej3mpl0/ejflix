import React, { useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

export type TapZone = "left" | "centre" | "right";
export type PanPhase = "start" | "move" | "end" | "cancel";
export type VerticalSide = "left" | "right";

type Axis = "h" | "v" | "none" | null;

/**
 * Touch layer under the chrome (one `GestureDetector`):
 * - single tap → `onSingleTap` (toggle chrome); double tap → `onDoubleTap(zone)` (left 35 % /
 *   centre / right 35 %);
 * - vertical pan on the left half → brightness, right half → volume (`fraction` = −dy/height);
 * - horizontal pan → scrub (`dx` in dp, only when `scrubEnabled`);
 * - pinch → `onPinch(scale)` on release.
 * Everything is disabled while locked or while a sheet / panel is open (`enabled`).
 */
export function PlayerGestures({
  enabled,
  scrubEnabled,
  width,
  height,
  onSingleTap,
  onDoubleTap,
  onVerticalPan,
  onScrub,
  onPinch,
  children,
}: {
  enabled: boolean;
  scrubEnabled: boolean;
  width: number;
  height: number;
  onSingleTap: () => void;
  onDoubleTap: (zone: TapZone) => void;
  onVerticalPan: (side: VerticalSide, phase: PanPhase, fraction: number) => void;
  onScrub: (phase: PanPhase, dx: number) => void;
  onPinch: (scale: number) => void;
  children?: React.ReactNode;
}) {
  const axis = useRef<Axis>(null);
  const side = useRef<VerticalSide>("left");
  const latest = useRef({ width, height, scrubEnabled, onSingleTap, onDoubleTap, onVerticalPan, onScrub, onPinch });
  latest.current = { width, height, scrubEnabled, onSingleTap, onDoubleTap, onVerticalPan, onScrub, onPinch };

  const gesture = useMemo(() => {
    const single = Gesture.Tap()
      .enabled(enabled)
      .runOnJS(true)
      .numberOfTaps(1)
      .maxDuration(250)
      .onEnd((_e, success) => {
        if (success) latest.current.onSingleTap();
      });

    const double = Gesture.Tap()
      .enabled(enabled)
      .runOnJS(true)
      .numberOfTaps(2)
      .maxDuration(250)
      .maxDelay(250)
      .onEnd((e, success) => {
        if (!success) return;
        const w = latest.current.width || 1;
        const zone: TapZone = e.x < w * 0.35 ? "left" : e.x > w * 0.65 ? "right" : "centre";
        latest.current.onDoubleTap(zone);
      });

    const pan = Gesture.Pan()
      .enabled(enabled)
      .runOnJS(true)
      .maxPointers(1)
      .minDistance(12)
      .onStart((e) => {
        axis.current = null;
        side.current = e.x < (latest.current.width || 1) / 2 ? "left" : "right";
      })
      .onUpdate((e) => {
        const { height: h, scrubEnabled: scrub, onVerticalPan: vertical, onScrub: horizontal } = latest.current;
        if (axis.current == null) {
          if (Math.abs(e.translationX) > Math.abs(e.translationY)) {
            if (!scrub) {
              axis.current = "none";
              return;
            }
            axis.current = "h";
            horizontal("start", 0);
          } else {
            axis.current = "v";
            vertical(side.current, "start", 0);
          }
        }
        if (axis.current === "h") horizontal("move", e.translationX);
        else if (axis.current === "v") vertical(side.current, "move", -e.translationY / (h || 1));
      })
      .onEnd((e, success) => {
        const { height: h, onVerticalPan: vertical, onScrub: horizontal } = latest.current;
        const phase: PanPhase = success ? "end" : "cancel";
        if (axis.current === "h") horizontal(phase, e.translationX);
        else if (axis.current === "v") vertical(side.current, phase, -e.translationY / (h || 1));
        axis.current = null;
      });

    const pinch = Gesture.Pinch()
      .enabled(enabled)
      .runOnJS(true)
      .onEnd((e, success) => {
        if (success) latest.current.onPinch(e.scale);
      });

    return Gesture.Race(pinch, pan, Gesture.Exclusive(double, single));
  }, [enabled]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} collapsable={false}>
        {children}
      </View>
    </GestureDetector>
  );
}
