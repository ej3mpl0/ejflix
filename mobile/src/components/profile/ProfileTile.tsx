import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import { Lock, Pencil, type LucideIcon } from "lucide-react-native";
import { hslToHex } from "../../theme/color";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { Avatar } from "../ui/Avatar";

/** Hue derived from the user name (desktop `avatarHue`). */
export function avatarHue(name: string): number {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
}

export type ProfileTileProps = {
  name: string;
  /** Local profile avatar (`preset:n` / data URL). */
  avatar?: string | null;
  /** Jellyfin user picture. */
  imageUrl?: string | null;
  /** Jellyfin user without a picture: tinted circle + initial. */
  hue?: number;
  /** Dashed placeholder tile with an icon ("new profile", "other user"). */
  icon?: LucideIcon;
  size: number;
  locked?: boolean;
  /** Edit mode: white ring + pencil overlay. */
  editing?: boolean;
  selected?: boolean;
  disabled?: boolean;
  /** Entering animation delay (ms). */
  delay?: number;
  onPress?: () => void;
  onLongPress?: () => void;
};

/** Round profile tile with its label under it (Who's watching?). */
export function ProfileTile({ name, avatar, imageUrl, hue, icon: Icon, size, locked, editing, selected, disabled, delay = 0, onPress, onLongPress }: ProfileTileProps) {
  const s = useStyles();
  const t = useTheme();
  const reduced = useReducedMotion();
  const [imgFailed, setImgFailed] = useState(false);
  const dashed = !!Icon;
  const ringColor = editing ? t.white(0.6) : selected ? "#ffffff" : dashed ? t.white(0.2) : "transparent";
  const tint = hue != null ? hslToHex(hue, 0.28, 0.22) : t.colors.panel;

  return (
    <Animated.View entering={reduced ? undefined : FadeInDown.duration(420).delay(delay)} style={{ width: size + 24 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityState={{ disabled: !!disabled, selected: !!selected }}
        disabled={disabled}
        onPress={onPress}
        onLongPress={
          onLongPress
            ? () => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
                onLongPress();
              }
            : undefined
        }
        delayLongPress={380}
        style={({ pressed }) => [s.tile, pressed ? { transform: [{ scale: 0.96 }] } : null, disabled ? { opacity: 0.6 } : null]}
      >
        <View style={[s.ring, { width: size + 8, height: size + 8, borderRadius: (size + 8) / 2, borderColor: ringColor, borderStyle: dashed ? "dashed" : "solid" }]}>
          {dashed && Icon ? (
            <View style={[s.dashedInner, { width: size, height: size, borderRadius: size / 2 }]}>
              <Icon size={Math.round(size * 0.32)} color={t.colors.muted} strokeWidth={1.8} />
            </View>
          ) : avatar != null ? (
            <Avatar src={avatar} name={name} size={size} />
          ) : (
            <View style={[s.userCircle, { width: size, height: size, borderRadius: size / 2, backgroundColor: tint }]}>
              <Text style={[s.initial, { fontSize: Math.round(size * 0.36) }]}>{(name[0] || "?").toUpperCase()}</Text>
              {imageUrl && !imgFailed ? (
                <Image source={{ uri: imageUrl }} contentFit="cover" transition={200} onError={() => setImgFailed(true)} style={StyleSheet.absoluteFill} />
              ) : null}
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: size / 2, borderWidth: 1, borderColor: t.white(0.12) }]} />
            </View>
          )}
          {editing && !dashed ? (
            <View style={[StyleSheet.absoluteFill, s.pencil, { borderRadius: (size + 8) / 2 }]}>
              <Pencil size={26} color="#ffffff" strokeWidth={2} />
            </View>
          ) : locked ? (
            <View style={s.lock}>
              <Lock size={12} color="#ffffff" strokeWidth={2.4} />
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[s.label, selected ? { color: "#ffffff" } : null]}>
          {name}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  tile: { alignItems: "center", gap: 10, paddingVertical: 4 },
  ring: { borderWidth: 2, alignItems: "center", justifyContent: "center" },
  dashedInner: { alignItems: "center", justifyContent: "center" },
  userCircle: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  initial: { fontFamily: t.fonts.semibold, color: t.white(0.9), includeFontPadding: false },
  pencil: { alignItems: "center", justifyContent: "center", backgroundColor: t.black(0.55) },
  lock: { position: "absolute", right: 2, bottom: 2, width: 28, height: 28, borderRadius: 14, backgroundColor: t.black(0.7), alignItems: "center", justifyContent: "center" },
  label: { ...text(15), color: t.colors.muted, textAlign: "center", maxWidth: "100%" },
}));
