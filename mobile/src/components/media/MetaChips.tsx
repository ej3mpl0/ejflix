import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import type { Movie } from "../../lib/types";
import { formatRuntime } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";
import { makeStyles } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { QualityBadges } from "./QualityBadges";

/** Year · certificate · runtime · seasons · ratings · quality badges · series status. */
export function MetaChips({ movie, seasons, style }: { movie: Movie; seasons?: number; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  const { t } = useI18n();
  const runtime = formatRuntime(movie.runtimeTicks);
  const years =
    movie.kind === "Series" && movie.year
      ? movie.endYear && movie.endYear !== movie.year
        ? `${movie.year}–${movie.endYear}`
        : movie.status === "Continuing"
          ? `${movie.year}–`
          : String(movie.year)
      : movie.year
        ? String(movie.year)
        : null;

  const chip = (key: string, content: React.ReactNode, extra?: StyleProp<ViewStyle>) => (
    <View key={key} style={[s.chip, extra]}>
      {typeof content === "string" ? <Text style={s.chipText}>{content}</Text> : content}
    </View>
  );

  return (
    <View style={[s.row, style]}>
      {years ? chip("years", years) : null}
      {movie.officialRating
        ? chip("rating", <Text style={s.certText}>{movie.officialRating}</Text>, s.cert)
        : null}
      {runtime ? chip("runtime", runtime) : null}
      {seasons ? chip("seasons", seasons === 1 ? `1 ${t("season").toLowerCase()}` : t("seasonsCount", { n: seasons })) : null}
      {movie.communityRating
        ? chip(
            "community",
            <Text style={s.chipText}>
              <Text style={s.star}>★ </Text>
              {movie.communityRating.toFixed(1)}
            </Text>,
          )
        : null}
      {movie.criticRating
        ? chip(
            "critic",
            <Text style={s.chipText}>
              {Math.round(movie.criticRating)}% <Text style={s.dim}>{t("criticsShort")}</Text>
            </Text>,
          )
        : null}
      {movie.kind === "Series" && movie.status
        ? chip("status", <Text style={s.statusText}>{movie.status === "Ended" ? t("ended") : t("continuing")}</Text>)
        : null}
      <QualityBadges badges={movie.badges} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  chip: { height: 28, borderRadius: 6, backgroundColor: t.white(0.08), paddingHorizontal: 8, justifyContent: "center" },
  chipText: { ...text(13, "regular", { tabular: true }), color: t.colors.text },
  cert: { backgroundColor: "transparent", borderWidth: 1, borderColor: t.white(0.2) },
  certText: { ...text(12, "semibold"), color: t.colors.text },
  star: { color: t.colors.star },
  dim: { ...text(11), color: t.colors.dim },
  statusText: { ...text(12), color: t.colors.muted },
}));
