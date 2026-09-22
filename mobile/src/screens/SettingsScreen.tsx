import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ChevronRight } from "lucide-react-native";
import { useI18n } from "../lib/locale-context";
import { useSession } from "../lib/session-context";
import type { MainStackParamList } from "../navigation/types";
import { makeStyles, useTheme } from "../theme/ThemeProvider";
import { useLayout } from "../theme/responsive";
import { text } from "../theme/typography";
import { CardSurface } from "../components/ui/CardSurface";
import { TAB_BAR_HEIGHT } from "../components/ui/Toast";
import { SETTINGS_SECTIONS, SettingsSectionContent, isSettingsSectionId, type SettingsSectionId } from "../components/settings/SettingsSectionContent";

type Params = { section?: string } | undefined;

/**
 * Settings tab. Phones list the six sections and push `SettingsSection`; tablets
 * (≥ 768 dp) show a 240 dp nav next to the section content, like the desktop.
 */
export function SettingsScreen() {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { version } = useSession();
  const layout = useLayout();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute();
  const params = route.params as Params;
  const requested = isSettingsSectionId(params?.section) ? params.section : null;
  const [section, setSection] = useState<SettingsSectionId>(requested ?? "appearance");
  const { wide, pagePad, insets } = layout;
  const bottomPad = TAB_BAR_HEIGHT + insets.bottom + 24;

  useEffect(() => {
    if (!requested) return;
    if (wide) setSection(requested);
    else navigation.navigate("SettingsSection", { section: requested });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  const title = <Text style={s.title}>{tr("settings")}</Text>;
  const footer = (
    <Text style={s.footer}>
      ejFlix {version ?? ""}
    </Text>
  );

  if (wide) {
    return (
      <View style={s.root}>
        <View style={[s.wideFrame, { paddingTop: insets.top + 24, paddingHorizontal: pagePad }]}>
          <View style={s.wideInner}>
            {title}
            <View style={s.panes}>
              <ScrollView style={s.nav} contentContainerStyle={{ paddingBottom: bottomPad }} showsVerticalScrollIndicator={false}>
                {SETTINGS_SECTIONS.map(({ id, icon: Icon, labelKey }) => {
                  const active = section === id;
                  return (
                    <Pressable
                      key={id}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: active }}
                      onPress={() => setSection(id)}
                      style={({ pressed }) => [s.navItem, active ? s.navItemActive : null, pressed && !active ? s.navItemPressed : null]}
                    >
                      <Icon size={18} color={active ? t.colors.accent : t.colors.muted} strokeWidth={2} />
                      <Text style={[s.navLabel, active ? s.navLabelActive : null]}>{tr(labelKey)}</Text>
                    </Pressable>
                  );
                })}
                {footer}
              </ScrollView>
              <ScrollView style={s.content} contentContainerStyle={{ paddingBottom: bottomPad }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <SettingsSectionContent section={section} />
              </ScrollView>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 20, paddingHorizontal: pagePad, paddingBottom: bottomPad }]} showsVerticalScrollIndicator={false}>
        {title}
        <CardSurface style={s.list}>
          {SETTINGS_SECTIONS.map(({ id, icon: Icon, labelKey, hintKey }, i) => (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={tr(labelKey)}
              onPress={() => navigation.navigate("SettingsSection", { section: id })}
              style={({ pressed }) => [s.item, i > 0 ? s.itemDivider : null, pressed ? s.itemPressed : null]}
            >
              <View style={s.itemDisc}>
                <Icon size={19} color={t.colors.accent} strokeWidth={2} />
              </View>
              <View style={s.itemText}>
                <Text style={s.itemLabel}>{tr(labelKey)}</Text>
                <Text numberOfLines={1} style={s.itemHint}>
                  {tr(hintKey)}
                </Text>
              </View>
              <ChevronRight size={18} color={t.colors.dim} strokeWidth={2} />
            </Pressable>
          ))}
        </CardSurface>
        {footer}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.base },
  scroll: { flexGrow: 1 },
  title: { ...text(28, "semibold", { tracking: -0.02 }), color: t.colors.text, marginBottom: 20 },
  footer: { ...text(12, "regular", { tabular: true }), color: t.colors.dim, textAlign: "center", marginTop: 28 },
  // Phone list
  list: { paddingHorizontal: 8, paddingVertical: 4 },
  item: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 64, paddingVertical: 10, paddingHorizontal: 8, borderRadius: t.radii.btn },
  itemDivider: { borderTopWidth: 1, borderTopColor: t.white(0.06), borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  itemPressed: { backgroundColor: t.white(0.05) },
  itemDisc: { width: 40, height: 40, borderRadius: 12, backgroundColor: t.colors.accentSoft, alignItems: "center", justifyContent: "center" },
  itemText: { flex: 1, minWidth: 0 },
  itemLabel: { ...text(15, "medium"), color: t.colors.text },
  itemHint: { ...text(12), color: t.colors.dim, marginTop: 2 },
  // Tablet panes
  wideFrame: { flex: 1, alignItems: "center" },
  wideInner: { flex: 1, width: "100%", maxWidth: 1100 },
  panes: { flex: 1, flexDirection: "row", gap: 32 },
  nav: { width: 240, flexGrow: 0, flexShrink: 0 },
  navItem: { flexDirection: "row", alignItems: "center", gap: 12, height: 44, paddingHorizontal: 12, borderRadius: t.radii.btn, marginBottom: 4 },
  navItemActive: { backgroundColor: t.colors.accentSoft },
  navItemPressed: { backgroundColor: t.white(0.06) },
  navLabel: { ...text(14), color: t.colors.muted },
  navLabelActive: { color: t.colors.accent, fontFamily: t.fonts.semibold },
  content: { flex: 1, minWidth: 0 },
}));
