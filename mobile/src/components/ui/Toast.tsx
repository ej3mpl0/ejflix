import React from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOut, LinearTransition, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Toast as ToastType } from "../../lib/types";
import { makeStyles } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";

/** Height of the glass tab bar (without the bottom inset). Toasts sit above it. */
export const TAB_BAR_HEIGHT = 58;

/** Transient messages stacked above the tab bar (`.toast-enter`). */
export function ToastStack({
  toasts,
  offset,
  onDismiss,
}: {
  toasts: ToastType[];
  offset?: number;
  onDismiss?: (id: number) => void;
}) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  if (!toasts.length) return null;
  const bottom = offset ?? insets.bottom + TAB_BAR_HEIGHT + 12;
  return (
    <View pointerEvents="box-none" style={[s.stack, { bottom, left: Math.max(16, insets.left), right: Math.max(16, insets.right) }]}>
      {toasts.map((toast) => (
        <Animated.View
          key={toast.id}
          entering={reduced ? undefined : FadeInDown.duration(240)}
          exiting={reduced ? undefined : FadeOut.duration(180)}
          layout={reduced ? undefined : LinearTransition.duration(200)}
          accessibilityLiveRegion="polite"
          style={s.toast}
        >
          <Text style={s.text}>{toast.message}</Text>
          {toast.action ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => {
                toast.action?.run();
                onDismiss?.(toast.id);
              }}
              style={s.action}
            >
              <Text style={s.actionText}>{toast.action.label}</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  stack: { position: "absolute", zIndex: 80, alignItems: "center", gap: 8 },
  toast: {
    maxWidth: 520,
    alignSelf: "center",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: t.amoled ? "rgba(18, 18, 18, 0.97)" : `${t.colors.panel}f2`,
    borderWidth: 1,
    borderColor: t.white(0.08),
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  text: { ...text(14), color: t.colors.text, flexShrink: 1 },
  action: { paddingHorizontal: 6, paddingVertical: 2 },
  actionText: { ...text(14, "semibold"), color: t.colors.accent },
}));
