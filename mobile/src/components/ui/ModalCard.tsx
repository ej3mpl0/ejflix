import React from "react";
import { Modal, Pressable, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles } from "../../theme/ThemeProvider";
import { Glass } from "./Glass";

/**
 * Centered dialog (`.modal-enter`): black/70 backdrop + glass card with the card radius.
 * Android back / backdrop tap call `onClose` (when given).
 */
export function ModalCard({
  visible,
  onClose,
  width = 520,
  style,
  children,
}: {
  visible: boolean;
  onClose?: () => void;
  /** Max card width (92 % of the window at most). */
  width?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const s = useStyles();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  if (!visible) return null;
  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={reduced ? undefined : FadeIn.duration(200)} exiting={reduced ? undefined : FadeOut.duration(160)} style={[StyleSheet.absoluteFill, s.backdrop]}>
        <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <View pointerEvents="box-none" style={[s.center, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <Animated.View entering={reduced ? undefined : ZoomIn.duration(240).withInitialValues({ transform: [{ scale: 0.98 }] })} style={{ width: Math.min(width, win.width * 0.92), maxHeight: "100%" }}>
          <Glass style={[s.card, style]}>{children}</Glass>
        </Animated.View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  backdrop: { backgroundColor: t.black(0.7) },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  card: {
    borderRadius: t.radii.card,
    borderWidth: 1,
    borderColor: t.white(0.08),
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 24 },
    elevation: 20,
  },
}));
