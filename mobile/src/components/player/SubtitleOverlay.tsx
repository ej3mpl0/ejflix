import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { SubBackground, SubPosition } from "../../lib/types";
import { cueTextAt, type Cue } from "../../lib/subtitles";
import { subtitlePlacement, subtitleTextStyle } from "../../lib/subtitle-style";

/**
 * Subtitles the app draws itself, over the video, for files loaded from the device. The
 * look comes from the profile settings; `delay` moves them later (positive) or earlier.
 */
export function SubtitleOverlay({
  cues,
  time,
  delay,
  scale,
  color,
  background,
  position = "bottom",
  frameHeight = 0,
  topInset = 24,
  bottom,
}: {
  cues: Cue[];
  time: number;
  delay: number;
  scale: number;
  color: string;
  background: SubBackground;
  position?: SubPosition;
  /** Height of the video frame, for the raised position. */
  frameHeight?: number;
  /** Distance from the top edge for the top position. */
  topInset?: number;
  /** Distance from the bottom edge (higher while the controls are on screen). */
  bottom: number;
}) {
  const line = cueTextAt(cues, time - delay);
  if (!line) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, subtitlePlacement(position, frameHeight, bottom, topInset)]}>
      <Text style={[styles.text, subtitleTextStyle({ scale, color, background }, 22)]}>{line}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 32, right: 32, alignItems: "center", zIndex: 12 },
  text: {
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 8,
    borderRadius: 4,
    overflow: "hidden",
    textShadowColor: "#000",
  },
});
