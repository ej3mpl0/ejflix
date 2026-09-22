import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { ArrowLeft } from "lucide-react-native";
import { useI18n } from "../../lib/locale-context";
import { makeStyles } from "../../theme/ThemeProvider";
import { useLayout } from "../../theme/responsive";
import { text } from "../../theme/typography";
import { Glass } from "../ui/Glass";
import { IconButton } from "../ui/IconButton";

const BAR_HEIGHT = 56;
/** The glass and the title fade in over this scroll range (desktop 320 → 400). */
const FADE_FROM = 320;
const FADE_SPAN = 80;
const TITLE_DELAY = 20;

/**
 * Top bar of a details page: the back circle is always visible, while the title and
 * the frosted background fade in once the backdrop has scrolled past.
 */
export function FloatingTitleBar({
  title,
  scrollY,
  onBack,
}: {
  title: string;
  /** Scroll offset of the page (shared value driven by the scroll handler). */
  scrollY: SharedValue<number>;
  onBack: () => void;
}) {
  const s = useStyles();
  const { t } = useI18n();
  const { insets, pagePad } = useLayout();

  const glass = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, (scrollY.value - FADE_FROM) / FADE_SPAN)),
  }));
  const label = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, (scrollY.value - FADE_FROM - TITLE_DELAY) / FADE_SPAN)),
  }));

  return (
    <View pointerEvents="box-none" style={[s.root, { height: BAR_HEIGHT + insets.top, paddingTop: insets.top }]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, glass]}>
        <Glass hairline hairlineOpacity={0.6} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <View style={[s.row, { paddingHorizontal: Math.max(pagePad - 8, 8) }]}>
        <IconButton icon={ArrowLeft} label={t("back")} variant="glass" hit={44} color="#ffffff" onPress={onBack} />
        <Animated.Text numberOfLines={1} style={[s.title, label]}>
          {title}
        </Animated.Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 },
  row: { height: BAR_HEIGHT, flexDirection: "row", alignItems: "center", gap: 10 },
  title: { ...text(16, "semibold", { tracking: -0.01 }), color: t.colors.text, flex: 1 },
}));
