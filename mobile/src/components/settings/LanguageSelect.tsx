import React from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { useI18n } from "../../lib/locale-context";
import type { Locale } from "../../lib/i18n";

/** "ES | EN" toggle used on the auth screens. */
export function LanguageSelect({ style }: { style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  const t = useTheme();
  const { locale, setLocale, t: tr } = useI18n();
  const option = (code: Locale, label: string) => {
    const active = locale === code;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ checked: active }}
        accessibilityLabel={code === "es" ? tr("langEs") : tr("langEn")}
        onPress={() => setLocale(code)}
        style={s.option}
      >
        <Text style={[s.label, { color: active ? "#ffffff" : t.colors.dim }]}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={tr("language")} style={[s.group, style]}>
      {option("es", "ES")}
      <Text style={s.divider}>|</Text>
      {option("en", "EN")}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  group: { flexDirection: "row", alignItems: "center", borderRadius: 8, backgroundColor: t.white(0.05), paddingHorizontal: 2 },
  option: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  label: { ...text(12, "semibold", { tracking: 0.06 }) },
  divider: { ...text(12), color: t.white(0.2) },
}));
