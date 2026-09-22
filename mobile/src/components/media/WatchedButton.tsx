import React from "react";
import { Text, type StyleProp, type ViewStyle } from "react-native";
import { CircleCheck, Eye } from "lucide-react-native";
import type { Movie } from "../../lib/types";
import { useI18n } from "../../lib/locale-context";
import { useUserData } from "../../lib/userdata-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { IconSwap } from "../ui/IconSwap";
import { PressableScale } from "../ui/PressableScale";

/** Mark as watched / unwatched. For seasons and series, watched = nothing left to play. */
export function WatchedButton({
  movie,
  variant = "action",
  scope = "item",
  pill = false,
  size = "lg",
  style,
}: {
  movie: Movie;
  variant?: "action" | "icon";
  scope?: "item" | "season";
  pill?: boolean;
  /** `sm` 36 dp (season header), `md` 44 dp, `lg` 48 dp. */
  size?: "sm" | "md" | "lg";
  style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { flags, setPlayed, pending } = useUserData();
  const state = flags(movie);
  const watched = state.played || state.unplayedCount === 0;
  const busy = pending(movie.id);
  const label =
    scope === "season"
      ? watched
        ? tr("markSeasonUnwatched")
        : tr("markSeasonWatched")
      : watched
        ? tr("markUnwatched")
        : tr("markWatched");
  const toggle = () => void setPlayed(movie, !watched);
  const fg = watched ? t.colors.accent : t.colors.text;

  if (variant === "icon") {
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: watched, disabled: busy }}
        disabled={busy}
        onPress={toggle}
        hitSlop={6}
        style={[s.icon, busy ? { opacity: 0.6 } : null, style]}
      >
        <CircleCheck size={16} color={watched ? t.colors.accent : "#ffffff"} strokeWidth={2} />
      </PressableScale>
    );
  }

  const h = size === "sm" ? 36 : size === "md" ? 44 : 48;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: watched, disabled: busy }}
      disabled={busy}
      onPress={toggle}
      style={[
        s.action,
        { height: h, borderRadius: pill ? t.radii.pill : t.radii.btn, paddingLeft: size === "sm" ? 12 : 18, paddingRight: size === "sm" ? 14 : 22 },
        busy ? { opacity: 0.6 } : null,
        style,
      ]}
    >
      <IconSwap on={watched} iconOn={CircleCheck} iconOff={Eye} size={size === "sm" ? 16 : 18} color={t.colors.text} colorOn={t.colors.accent} strokeWidth={2.2} />
      <Text numberOfLines={1} style={[size === "sm" ? s.labelSm : s.label, { color: fg }]}>
        {scope === "season" ? label : watched ? tr("watched") : tr("markWatched")}
      </Text>
    </PressableScale>
  );
}

const useStyles = makeStyles((t) => ({
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.black(0.6),
    borderWidth: 1,
    borderColor: t.white(0.12),
    alignItems: "center",
    justifyContent: "center",
  },
  action: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: t.white(0.12), alignSelf: "flex-start" },
  label: { ...text(15, "semibold") },
  labelSm: { ...text(13, "semibold") },
}));
