import React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { ArrowLeft } from "lucide-react-native";
import { useI18n } from "../lib/locale-context";
import type { MainScreenProps } from "../navigation/types";
import { makeStyles } from "../theme/ThemeProvider";
import { useLayout } from "../theme/responsive";
import { text } from "../theme/typography";
import { IconButton } from "../components/ui/IconButton";
import { SETTINGS_SECTIONS, SettingsSectionContent, isSettingsSectionId } from "../components/settings/SettingsSectionContent";

/** One settings section on its own page (phones): back arrow + title + the section cards. */
export function SettingsSectionScreen({ route, navigation }: MainScreenProps<"SettingsSection">) {
  const s = useStyles();
  const { t } = useI18n();
  const { insets, pagePad } = useLayout();
  const id = isSettingsSectionId(route.params.section) ? route.params.section : "appearance";
  const meta = SETTINGS_SECTIONS.find((section) => section.id === id);
  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 8, paddingHorizontal: Math.max(pagePad - 8, 8) }]}>
        <IconButton icon={ArrowLeft} label={t("back")} color="#ffffff" onPress={() => navigation.goBack()} />
        <Text numberOfLines={1} style={s.title}>
          {meta ? t(meta.labelKey) : t("settings")}
        </Text>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.fill}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.scroll, { paddingHorizontal: pagePad, paddingBottom: insets.bottom + 32 }]}
        >
          <View style={s.inner}>
            <SettingsSectionContent section={id} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.base },
  fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 8 },
  title: { ...text(22, "semibold", { tracking: -0.02 }), color: t.colors.text, flex: 1 },
  scroll: { flexGrow: 1, paddingTop: 8, alignItems: "center" },
  inner: { width: "100%", maxWidth: 760 },
}));
