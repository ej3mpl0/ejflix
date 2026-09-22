import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../../theme/ThemeProvider";
import { brandText } from "../../theme/typography";
import type { BrandGradient } from "../../theme/tokens";

/** CSS `linear-gradient(<angle>)` → expo-linear-gradient start/end points. */
export function gradientPoints(angle: number): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  return { start: { x: 0.5 - dx / 2, y: 0.5 - dy / 2 }, end: { x: 0.5 + dx / 2, y: 0.5 + dy / 2 } };
}

/** Wordmark: "EJFLIX" in Bebas Neue masked over the theme brand gradient. */
export function Logo({
  size = "nav",
  px,
  gradient,
  style,
}: {
  size?: "nav" | "login";
  /** Explicit font size (overrides `size`). */
  px?: number;
  /** Override the theme gradient (theme picker swatches). */
  gradient?: BrandGradient;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const fontSize = px ?? (size === "nav" ? 24 : 40);
  const brand = gradient ?? t.colors.brand;
  const { start, end } = gradientPoints(brand.angle);
  const textStyle = brandText(fontSize);
  const first = brand.stops[0] ?? "#ffffff";
  const stops: [string, string, ...string[]] = brand.stops.length > 1 ? (brand.stops as [string, string, ...string[]]) : [first, first];
  return (
    <View style={[{ alignSelf: "flex-start" }, style]} accessibilityRole="header" accessibilityLabel="ejFlix">
      <MaskedView maskElement={<Text style={[textStyle, { color: "#000" }]}>EJFLIX</Text>}>
        <LinearGradient colors={stops} start={start} end={end}>
          <Text style={[textStyle, { opacity: 0 }]}>EJFLIX</Text>
        </LinearGradient>
      </MaskedView>
    </View>
  );
}
