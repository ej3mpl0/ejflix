import React from "react";
import { Text, View } from "react-native";
import type { Movie } from "../../lib/types";
import { useI18n } from "../../lib/locale-context";
import { makeStyles } from "../../theme/ThemeProvider";
import { useLayout } from "../../theme/responsive";
import { text } from "../../theme/typography";

/** Crew, studios and the technical line-up of the file. */
export function ProductionInfo({ movie }: { movie: Movie }) {
  const s = useStyles();
  const { t } = useI18n();
  const { wide } = useLayout();
  const rows: { label: string; value: string }[] = [
    { label: t("genres"), value: movie.genres.join(", ") },
    { label: t("director"), value: movie.directors.join(", ") },
    { label: t("writers"), value: movie.writers.join(", ") },
    { label: t("studios"), value: movie.studios.join(", ") },
    { label: t("video"), value: movie.videoLabel ?? "" },
    { label: t("audio"), value: movie.audioLabel ?? "" },
    { label: t("subtitles"), value: movie.subtitleLabels.join(", ") },
  ].filter((row) => row.value);
  if (!rows.length) return null;

  return (
    <View>
      <Text style={s.heading}>{t("production")}</Text>
      <View style={[s.grid, wide ? s.gridWide : null]}>
        {rows.map((row) => (
          <View key={row.label} style={[s.row, wide ? { width: "48%" } : null]}>
            <Text style={s.label}>{row.label}</Text>
            <Text style={s.value}>{row.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  heading: { ...text(18, "semibold", { tracking: -0.01 }), color: t.colors.text, marginBottom: 14 },
  grid: { gap: 12 },
  gridWide: { flexDirection: "row", flexWrap: "wrap", columnGap: 24 },
  row: { flexDirection: "row", gap: 12 },
  label: { ...text(13), color: t.colors.dim, width: 96, flexShrink: 0 },
  value: { ...text(13, "regular", { lineHeight: 19 }), color: t.colors.text, flex: 1 },
}));
