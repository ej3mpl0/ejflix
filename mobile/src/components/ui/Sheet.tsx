import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView } from "expo-glass-effect";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { LIQUID_GLASS } from "./Glass";
import { text } from "../../theme/typography";

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  /** `bottom` slides up (phones); `right` slides in as a side panel (tablets, player). */
  side?: "bottom" | "right";
  /** Bottom sheet height in dp or as a fraction of the window; `"auto"` fits the content. */
  snap?: number | "auto";
  /** Right panel width (default min(420, 86 %)). */
  width?: number;
  title?: string;
  /** Node placed at the right of the title. */
  headerRight?: React.ReactNode;
  /** Hide the drag handle. */
  handle?: boolean;
  /** Extra padding at the bottom of the content (default = safe inset). */
  padBottom?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * Own sheet: Modal + Reanimated slide + pan-to-dismiss. The Android back button
 * (`onRequestClose`) and a tap on the backdrop close it.
 */
export function Sheet({
  visible,
  onClose,
  side = "bottom",
  snap = "auto",
  width,
  title,
  headerRight,
  handle = true,
  padBottom = true,
  contentStyle,
  children,
}: SheetProps) {
  const s = useStyles();
  const t = useTheme();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const isRight = side === "right";
  const panelW = isRight ? Math.min(width ?? 420, win.width * 0.86) : win.width;
  const maxH = win.height - insets.top - 24;
  const snapH = snap === "auto" ? undefined : snap <= 1 ? Math.round(win.height * snap) : snap;
  const travel = isRight ? panelW : win.height;

  const offset = useSharedValue(travel);
  const drag = useSharedValue(0);
  const fade = useSharedValue(0);
  const dur = reduced ? 0 : t.durations.sheet;

  const unmount = useCallback(() => setMounted(false), []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      drag.value = 0;
      offset.value = travel;
      offset.value = withTiming(0, { duration: dur, easing: EASE });
      fade.value = withTiming(1, { duration: dur });
    } else if (mounted) {
      fade.value = withTiming(0, { duration: Math.max(1, dur * 0.8) });
      offset.value = withTiming(travel, { duration: Math.max(1, dur * 0.8), easing: Easing.in(Easing.quad) }, (done) => {
        if (done) runOnJS(unmount)();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, travel]);

  const close = useCallback(() => onClose(), [onClose]);

  const pan = Gesture.Pan()
    .activeOffsetY(isRight ? [-1000, 1000] : [8, 1000])
    .activeOffsetX(isRight ? [8, 1000] : [-1000, 1000])
    .onUpdate((e) => {
      const d = isRight ? e.translationX : e.translationY;
      drag.value = Math.max(0, d);
    })
    .onEnd((e) => {
      const v = isRight ? e.velocityX : e.velocityY;
      const d = drag.value;
      if (d > travel * 0.25 || v > 900) {
        runOnJS(close)();
      } else {
        drag.value = withTiming(0, { duration: 180, easing: EASE });
      }
    });

  const panelStyle = useAnimatedStyle(() => ({
    transform: isRight ? [{ translateX: offset.value + drag.value }] : [{ translateY: offset.value + drag.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  if (!mounted) return null;

  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={close}>
      <GestureHandlerRootView style={s.fill}>
        <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, backdropStyle]}>
          <Pressable accessibilityLabel="Close" accessibilityRole="button" style={s.fill} onPress={close} />
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[
              s.panel,
              LIQUID_GLASS ? s.liquidPanel : null,
              isRight
                ? [s.right, { width: panelW, paddingTop: insets.top, paddingRight: insets.right }]
                : [s.bottom, { maxHeight: maxH, height: snapH, paddingBottom: padBottom ? Math.max(insets.bottom, 12) : 0 }],
              panelStyle,
            ]}
          >
            {LIQUID_GLASS ? (
              <GlassView
                pointerEvents="none"
                glassEffectStyle="regular"
                colorScheme="dark"
                tintColor={t.black(0.3)}
                style={[StyleSheet.absoluteFill, isRight ? s.rightRadii : s.bottomRadii]}
              />
            ) : null}
            {handle && !isRight ? <View style={s.handle} /> : null}
            {title || headerRight ? (
              <View style={[s.header, isRight ? { paddingTop: 12 } : null]}>
                <Text numberOfLines={1} style={s.title}>
                  {title}
                </Text>
                {headerRight}
              </View>
            ) : null}
            <View style={[s.content, contentStyle]}>{children}</View>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  fill: { flex: 1 },
  // Liquid Glass sheets refract what is behind them, so the backdrop dims less.
  backdrop: { backgroundColor: t.black(LIQUID_GLASS ? 0.4 : 0.7) },
  panel: {
    position: "absolute",
    backgroundColor: t.colors.surface,
    borderColor: t.white(0.06),
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
  liquidPanel: { backgroundColor: "transparent", borderColor: "transparent", shadowOpacity: 0.25 },
  bottomRadii: { borderTopLeftRadius: t.radii.card, borderTopRightRadius: t.radii.card, overflow: "hidden" },
  rightRadii: { borderTopLeftRadius: t.radii.card, borderBottomLeftRadius: t.radii.card, overflow: "hidden" },
  bottom: {
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: t.radii.card,
    borderTopRightRadius: t.radii.card,
    borderTopWidth: 1,
  },
  right: {
    top: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: t.radii.card,
    borderBottomLeftRadius: t.radii.card,
    borderLeftWidth: 1,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: t.white(0.25), marginTop: 10, marginBottom: 6 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 12, minHeight: 48 },
  title: { ...text(17, "semibold", { tracking: -0.01 }), color: t.colors.text, flex: 1 },
  content: { flexShrink: 1 },
}));
