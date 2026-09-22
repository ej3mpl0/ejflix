import React from "react";
import { Pressable, Text, View } from "react-native";
import { ArrowLeft } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { useI18n } from "../../lib/locale-context";
import { Logo } from "../ui/Logo";
import { LanguageSelect } from "../settings/LanguageSelect";

/** Top bar of the auth screens: logo (or back), language toggle. Height 60 + top inset. */
export function AuthHeader({ onBack, showLanguage = true }: { onBack?: () => void; showLanguage?: boolean }) {
  const s = useStyles();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { t: tr } = useI18n();
  return (
    <View style={[s.bar, { paddingTop: insets.top, paddingLeft: Math.max(16, insets.left), paddingRight: Math.max(16, insets.right) }]}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel={tr("back")} onPress={onBack} hitSlop={8} style={({ pressed }) => [s.back, pressed ? { opacity: 0.6 } : null]}>
          <ArrowLeft size={18} color={t.colors.dim} strokeWidth={2.2} />
          <Text style={s.backText}>{tr("back")}</Text>
        </Pressable>
      ) : (
        <Logo size="nav" />
      )}
      {showLanguage ? <LanguageSelect /> : <View />}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  bar: { height: 60, boxSizing: "content-box", flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 10 },
  back: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingRight: 8 },
  backText: { ...text(14), color: t.colors.dim },
}));
