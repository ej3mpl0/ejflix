import React, { useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { presetGradient } from "../../lib/avatars";
import { useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";

/** Round avatar: a picture (data URL / remote), a preset gradient (`preset:n`) or the initial on the accent. */
export function Avatar({
  src,
  name,
  size = 32,
  style,
}: {
  src?: string | null;
  name: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  const initial = (name[0] || "E").toUpperCase();
  const preset = src ? presetGradient(src) : null;
  const showImage = !!src && !preset && !failed;
  const fontSize = Math.max(12, Math.round(size * 0.4));

  return (
    <View
      accessibilityLabel={name}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: "hidden",
          backgroundColor: t.colors.accent,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      {preset ? (
        <LinearGradient colors={preset} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      ) : null}
      {showImage ? (
        <Image
          source={{ uri: src as string }}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          onError={() => setFailed(true)}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <Text style={[text(fontSize, "semibold"), { color: preset ? "#ffffff" : t.colors.onAccent }]}>{initial}</Text>
      )}
      {/* `.img-outline`: 1 px inner hairline. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: size / 2, borderWidth: 1, borderColor: t.outline }]} />
    </View>
  );
}
