import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { SubBackground } from "../../lib/types";
import { cueTextAt, type Cue } from "../../lib/subtitles";

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
  bottom,
}: {
  cues: Cue[];
  time: number;
  delay: number;
  scale: number;
  color: string;
  background: SubBackground;
  /** Distance from the bottom edge (higher while the controls are on screen). */
  bottom: number;
}) {
  const line = cueTextAt(cues, time - delay);
  if (!line) return null;
  const box = background === "box";
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom }]}>
      <Text
        style={[
          styles.text,
          {
            color,
            fontSize: Math.round(22 * scale),
            lineHeight: Math.round(29 * scale),
            backgroundColor: box ? "rgba(0,0,0,0.7)" : "transparent",
            textShadowRadius: box ? 0 : background === "shadow" ? 6 : 3,
            textShadowOffset: background === "shadow" ? { width: 2, height: 2 } : { width: 0, height: 0 },
          },
        ]}
      >
        {line}
      </Text>
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
