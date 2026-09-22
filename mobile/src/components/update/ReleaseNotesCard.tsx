import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { makeStyles } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { useI18n } from "../../lib/locale-context";

/** What's new in this version (bullet list with accent dots), from the i18n `noteN` keys. */
export function ReleaseNotesCard({ style, size = 15 }: { style?: StyleProp<ViewStyle>; size?: number }) {
  const s = useStyles();
  const { t } = useI18n();
  const notes = [t("note8"), t("note7"), t("note6"), t("note5"), t("note4"), t("note3"), t("note2"), t("note1")];
  return (
    <View style={[s.list, style]}>
      {notes.map((note) => (
        <View key={note} style={s.row}>
          <View style={s.dot} />
          <Text style={[s.text, text(size, "regular", { lineHeight: Math.round(size * 1.6) })]}>{note}</Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  list: { gap: 10 },
  row: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.colors.accent, marginTop: 9 },
  text: { flex: 1, color: t.colors.muted },
}));
