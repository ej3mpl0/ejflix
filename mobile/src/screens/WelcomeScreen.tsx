import React from "react";
import { ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowRight, Globe, Server, type LucideIcon } from "lucide-react-native";
import { makeStyles, useTheme } from "../theme/ThemeProvider";
import { useLayout } from "../theme/responsive";
import { text } from "../theme/typography";
import { useI18n } from "../lib/locale-context";
import { useSession } from "../lib/session-context";
import { GrainBackdrop } from "../components/ui/GrainBackdrop";
import { Logo } from "../components/ui/Logo";
import { CardSurface } from "../components/ui/CardSurface";
import { PressableScale } from "../components/ui/PressableScale";
import { AuthHeader } from "../components/auth/AuthHeader";
import type { AuthScreenProps } from "../navigation/types";

/** First launch: pick between a Jellyfin server and the online (addons only) mode. */
export function WelcomeScreen({ navigation }: AuthScreenProps<"Welcome">) {
  const s = useStyles();
  const t = useTheme();
  const l = useLayout();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { t: tr } = useI18n();
  const { setGate } = useSession();
  const stacked = l.sizeClass === "compact" || (l.width < 760 && !l.landscape);
  const enter = (delay: number) => (reduced ? undefined : FadeInDown.duration(520).delay(delay).springify().damping(18));

  const option = (Icon: LucideIcon, title: string, hint: string, onPress: () => void, delay: number, primary = false) => (
    <Animated.View entering={enter(delay)} style={stacked ? s.cardWrapStacked : s.cardWrap}>
      <PressableScale accessibilityRole="button" accessibilityLabel={title} onPress={onPress} scaleTo={0.97}>
        <CardSurface style={s.card}>
          <View style={[s.iconDisc, primary ? { backgroundColor: t.colors.accent } : { backgroundColor: t.colors.accentSoft }]}>
            <Icon size={26} color={primary ? t.colors.onAccent : t.colors.accent} strokeWidth={2} />
          </View>
          <View style={{ gap: 6 }}>
            <Text style={s.cardTitle}>{title}</Text>
            <Text style={s.cardHint}>{hint}</Text>
          </View>
          <View style={s.cta}>
            <Text style={s.ctaText}>{tr("getStarted")}</Text>
            <ArrowRight size={15} color={t.colors.accent} strokeWidth={2.4} />
          </View>
        </CardSurface>
      </PressableScale>
    </Animated.View>
  );

  return (
    <View style={s.root}>
      <GrainBackdrop glow={0.16} cy={0.1} />
      <AuthHeader />
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40, paddingHorizontal: Math.max(24, insets.left, insets.right) }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enter(0)} style={{ marginBottom: 12 }}>
          <Logo size="login" />
        </Animated.View>
        <Animated.View entering={enter(60)}>
          <Text style={[s.title, { fontSize: stacked ? 30 : 34, lineHeight: stacked ? 36 : 40 }]}>{tr("welcomeTitle")}</Text>
        </Animated.View>
        <Animated.View entering={enter(120)}>
          <Text style={s.hint}>{tr("welcomeHint")}</Text>
        </Animated.View>
        <View style={[s.options, stacked ? s.optionsStacked : null]}>
          {option(Server, tr("optionServer"), tr("optionServerHint"), () => { setGate("login"); navigation.navigate("Login"); }, 180, true)}
          {option(Globe, tr("optionOnline"), tr("optionOnlineHint"), () => { setGate("create"); navigation.navigate("ProfileEditor", { from: "welcome" }); }, 260)}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.base },
  scroll: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingTop: 16 },
  title: { ...text(34, "semibold", { tracking: -0.025 }), color: t.colors.text, textAlign: "center", marginBottom: 8, maxWidth: 560 },
  hint: { ...text(14), color: t.colors.dim, textAlign: "center", marginBottom: 36, maxWidth: 420 },
  options: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "stretch", gap: 20 },
  optionsStacked: { flexDirection: "column", alignSelf: "stretch", alignItems: "stretch" },
  cardWrap: { width: 320, maxWidth: "100%" },
  cardWrapStacked: { width: "100%", maxWidth: 420, alignSelf: "center" },
  card: { padding: 24, gap: 18, minHeight: 200 },
  iconDisc: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  cardTitle: { ...text(20, "semibold", { tracking: -0.01 }), color: t.colors.text },
  cardHint: { ...text(14, "regular", { lineHeight: 21 }), color: t.colors.muted },
  cta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: "auto" },
  ctaText: { ...text(13, "semibold"), color: t.colors.accent },
}));
