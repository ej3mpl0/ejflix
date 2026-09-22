import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, ArrowRight, Check, Palette, Puzzle } from "lucide-react-native";
import { makeStyles, useTheme } from "../theme/ThemeProvider";
import { text } from "../theme/typography";
import { useI18n } from "../lib/locale-context";
import { useSettings } from "../lib/settings-context";
import { GrainBackdrop } from "../components/ui/GrainBackdrop";
import { CardSurface } from "../components/ui/CardSurface";
import { Pill } from "../components/ui/Pill";
import { AuthHeader } from "../components/auth/AuthHeader";
import { ThemePicker } from "../components/settings/ThemePicker";
import { LanguageSelect } from "../components/settings/LanguageSelect";
import { LanguagePicker } from "../components/settings/LanguagePicker";
import { AddonImport } from "../components/settings/AddonImport";

type Step = "style" | "addons";
const STEPS: Step[] = ["style", "addons"];

/**
 * First-run setup of a profile, once, before Home: its look (theme, app and subtitle
 * language) and bringing the addons it already uses in Stremio, Nuvio or another app.
 * Everything stays editable in Settings, so each step can be skipped.
 */
export function SetupScreen({ onDone }: { onDone: () => void }) {
  const s = useStyles();
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const [step, setStep] = useState<Step>("style");
  const [imported, setImported] = useState(0);
  const index = STEPS.indexOf(step);

  const finish = () => {
    void update({ onboarding: { setupDone: true } });
    onDone();
  };

  const icon = (Icon: typeof Palette) => (
    <View style={s.iconDisc}>
      <Icon size={24} color={th.colors.accent} strokeWidth={2} />
    </View>
  );

  return (
    <View style={s.root}>
      <GrainBackdrop glow={0.12} cy={0} />
      <AuthHeader />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32, paddingHorizontal: Math.max(20, insets.left, insets.right) }]}
      >
        <CardSurface style={s.card}>
          <View style={s.progress} accessibilityLabel={t("setupProgress", { n: index + 1, total: STEPS.length })}>
            {STEPS.map((id, i) => (
              <View key={id} style={[s.bar, { backgroundColor: i <= index ? th.colors.accent : th.white(0.12) }]} />
            ))}
            <Text style={s.count}>
              {index + 1}/{STEPS.length}
            </Text>
          </View>

          {step === "style" ? (
            <>
              {icon(Palette)}
              <Text style={s.title}>{t("setupStyleTitle")}</Text>
              <Text style={s.body}>{t("setupStyleText")}</Text>
              <Text style={s.label}>{t("theme")}</Text>
              <ThemePicker value={settings.appearance.theme} onChange={(theme) => void update({ appearance: { theme } })} />
              <Text style={[s.label, { marginTop: 18 }]}>{t("appLanguage")}</Text>
              <LanguageSelect />
              <Text style={[s.label, { marginTop: 18 }]}>{t("preferredSubtitles")}</Text>
              <LanguagePicker
                kind="subtitle"
                label={t("preferredSubtitles")}
                value={settings.playback.subtitleLanguage}
                onChange={(subtitleLanguage) => void update({ playback: { subtitleLanguage } })}
              />
              <View style={s.actions}>
                <Pill variant="ghost" label={t("setupSkip")} onPress={finish} />
                <Pill variant="primary" icon={ArrowRight} label={t("next")} onPress={() => setStep("addons")} />
              </View>
            </>
          ) : (
            <>
              {icon(Puzzle)}
              <Text style={s.title}>{t("setupAddonsTitle")}</Text>
              <Text style={s.body}>{t("setupAddonsText")}</Text>
              <AddonImport onImported={(n) => setImported((total) => total + n)} />
              <Text style={[s.body, { marginTop: 16, marginBottom: 0 }]}>{t("setupAddonsLater")}</Text>
              <View style={s.actions}>
                <Pill variant="ghost" icon={ArrowLeft} label={t("back")} onPress={() => setStep("style")} />
                <Pill
                  variant="primary"
                  icon={Check}
                  label={imported ? t("setupFinish") : t("setupFinishNoAddons")}
                  onPress={finish}
                />
              </View>
            </>
          )}
        </CardSurface>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.base },
  scroll: { flexGrow: 1, alignItems: "center", paddingTop: 12 },
  card: { width: "100%", maxWidth: 560, padding: 24, borderRadius: 24 },
  progress: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 22 },
  bar: { flex: 1, height: 6, borderRadius: 3 },
  count: { ...text(12, "regular", { tabular: true }), color: t.colors.dim },
  iconDisc: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: t.colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: { ...text(24, "semibold"), color: t.colors.text, marginBottom: 6 },
  body: { ...text(13, "regular", { lineHeight: 20 }), color: t.colors.dim, marginBottom: 20 },
  label: { ...text(13, "medium"), color: t.colors.text, marginBottom: 8 },
  actions: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginTop: 24 },
}));
