import React from "react";
import { Text, View } from "react-native";
import type { Programme } from "../../lib/types";
import { formatRange, programmeProgress } from "../../lib/iptv";
import { useI18n } from "../../lib/locale-context";
import { makeStyles } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { ProgressBar } from "../ui/ProgressBar";

/** Replaces the timeline while a channel plays: programme on air, what comes next, progress. */
export function LiveStrip({ now, next }: { now: Programme | null; next: Programme | null }) {
  const s = useStyles();
  const { t, locale } = useI18n();
  if (!now) return null;
  return (
    <View style={s.root}>
      <View style={s.row}>
        <Text numberOfLines={1} style={s.now}>
          <Text style={s.title}>{now.title}</Text>
          <Text style={s.range}> · {formatRange(now, locale)}</Text>
        </Text>
        {next ? (
          <Text numberOfLines={1} style={s.next}>
            {t("nextProgramme")}: {next.title}
          </Text>
        ) : null}
      </View>
      <ProgressBar value={programmeProgress(now) / 100} height={3} animated={false} style={s.bar} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { paddingHorizontal: 4, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  now: { ...text(12), color: t.white(0.8), flexShrink: 1 },
  title: { ...text(12, "semibold"), color: t.colors.text },
  range: { color: t.white(0.6) },
  next: { ...text(12), color: t.white(0.6), flexShrink: 1, maxWidth: "45%" },
  bar: { marginTop: 6, backgroundColor: t.white(0.15) },
}));
