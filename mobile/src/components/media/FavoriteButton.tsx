import React from "react";
import { Text, type StyleProp, type ViewStyle } from "react-native";
import { Check, Heart, Plus } from "lucide-react-native";
import type { Movie } from "../../lib/types";
import { useI18n } from "../../lib/locale-context";
import { useUserData } from "../../lib/userdata-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { IconSwap } from "../ui/IconSwap";
import { PressableScale } from "../ui/PressableScale";

/**
 * "My list" toggle (Jellyfin favorite). `action` = labelled tonal button for heroes
 * and detail pages; `icon` = round heart for card corners and episode rows.
 */
export function FavoriteButton({
  movie,
  variant = "action",
  pill = false,
  size = "lg",
  style,
}: {
  movie: Movie;
  variant?: "action" | "icon";
  /** Fully rounded (hero / details); otherwise the button radius. */
  pill?: boolean;
  /** Height of the action variant: `md` 44 dp, `lg` 48 dp. */
  size?: "md" | "lg";
  style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { flags, setFavorite, pending } = useUserData();
  const favorite = flags(movie).favorite;
  const busy = pending(movie.id);
  const label = favorite ? tr("removeFromList") : tr("addToList");
  const toggle = () => void setFavorite(movie, !favorite);

  if (variant === "icon") {
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: favorite, disabled: busy }}
        disabled={busy}
        onPress={toggle}
        hitSlop={6}
        style={[s.icon, busy ? { opacity: 0.6 } : null, style]}
      >
        <Heart size={16} color={favorite ? t.colors.accent : "#ffffff"} fill={favorite ? t.colors.accent : "none"} strokeWidth={2} />
      </PressableScale>
    );
  }

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: favorite, disabled: busy }}
      disabled={busy}
      onPress={toggle}
      style={[
        s.action,
        { height: size === "lg" ? 48 : 44, borderRadius: pill ? t.radii.pill : t.radii.btn },
        busy ? { opacity: 0.6 } : null,
        style,
      ]}
    >
      <IconSwap on={favorite} iconOn={Check} iconOff={Plus} size={18} color={t.colors.text} strokeWidth={2.2} />
      <Text numberOfLines={1} style={s.label}>
        {favorite ? tr("inList") : tr("myList")}
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
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 18,
    paddingRight: 22,
    backgroundColor: t.white(0.12),
    alignSelf: "flex-start",
  },
  label: { ...text(15, "semibold"), color: t.colors.text },
}));
