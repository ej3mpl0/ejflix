import React, { useEffect } from "react";
import { Text, View } from "react-native";
import { SkipForward, X } from "lucide-react-native";
import Svg, { Circle } from "react-native-svg";
import Animated, {
  Easing,
  SlideInRight,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SKIP_PROMPT_SECONDS } from "../../hooks/useSkipPrompt";
import { useI18n } from "../../lib/locale-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { IconButton } from "../ui/IconButton";
import { PressableScale } from "../ui/PressableScale";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const RING = 36;
const R = 16;
const STROKE = 3;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * "Skip intro" prompt: white pill with the label and an accent ring that empties around
 * the icon over `SKIP_PROMPT_SECONDS`, plus a separate dismiss button. Mount with a `key`
 * that changes on every show so the enter animation and the ring restart.
 */
export function SkipButton({
  label,
  onSkip,
  onDismiss,
  right,
  bottom,
}: {
  label: string;
  onSkip: () => void;
  onDismiss: () => void;
  right: number;
  bottom: number;
}) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const reduced = useReducedMotion();
  const offset = useSharedValue(0);

  useEffect(() => {
    offset.value = 0;
    offset.value = withTiming(CIRCUMFERENCE, { duration: SKIP_PROMPT_SECONDS * 1000, easing: Easing.linear });
  }, [offset]);

  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: offset.value }));

  return (
    <Animated.View
      entering={reduced ? undefined : SlideInRight.duration(320)}
      style={[s.root, { right, bottom }]}
    >
      <PressableScale accessibilityRole="button" accessibilityLabel={label} onPress={onSkip} style={s.pill}>
        <View style={s.ring}>
          <Svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} style={{ transform: [{ rotate: "-90deg" }] }}>
            <Circle cx={RING / 2} cy={RING / 2} r={R} stroke="rgba(0,0,0,0.1)" strokeWidth={STROKE} fill="none" />
            <AnimatedCircle
              cx={RING / 2}
              cy={RING / 2}
              r={R}
              stroke={t.colors.accent}
              strokeWidth={STROKE}
              fill="none"
              strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
              animatedProps={ringProps}
            />
          </Svg>
          <View style={s.disc}>
            <SkipForward size={15} color="#000000" fill="#000000" style={{ transform: [{ translateX: 1 }] }} />
          </View>
        </View>
        <Text numberOfLines={1} style={s.label}>
          {label}
        </Text>
      </PressableScale>
      <IconButton icon={X} label={tr("close")} onPress={onDismiss} size={16} hit={40} variant="glass" color={t.white(0.8)} />
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { position: "absolute", zIndex: 30, flexDirection: "row", alignItems: "center", gap: 8 },
  pill: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: 6,
    paddingRight: 22,
    borderRadius: t.radii.pill,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderWidth: 1,
    borderColor: t.white(0.4),
    shadowColor: "#000",
    shadowOpacity: 0.55,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  ring: { width: RING, height: RING, alignItems: "center", justifyContent: "center" },
  disc: { position: "absolute", width: 28, height: 28, borderRadius: 14, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" },
  label: { ...text(15, "semibold"), color: "#000000", maxWidth: 220 },
}));
