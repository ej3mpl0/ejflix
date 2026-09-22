import React, { useState } from "react";
import { View } from "react-native";
import { runOnJS, useAnimatedReaction, useSharedValue, type SharedValue } from "react-native-reanimated";
import { sessionAvatar } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";
import { useSession } from "../../lib/session-context";
import { makeStyles } from "../../theme/ThemeProvider";
import { useLayout } from "../../theme/responsive";
import { Avatar } from "../ui/Avatar";
import { Glass } from "../ui/Glass";
import { Logo } from "../ui/Logo";
import { PressableScale } from "../ui/PressableScale";
import { AccountSheet } from "./AccountSheet";

/** Height of the brand row (the safe-area inset is added on top of it). */
export const HEADER_ROW_HEIGHT = 56;

/** Past this offset the bottom hairline brightens (desktop `scrolled`). */
const SCROLLED_AT = 24;

export type GlassHeaderProps = {
  /** Page scroll offset; the hairline brightens once the page moved. */
  scrollY?: SharedValue<number>;
  /** Rendered inside the glass under the brand row (the scope chips). */
  children?: React.ReactNode;
};

/**
 * Fixed top bar of the Home tab (port of the desktop `GlassHeader`): frosted surface
 * with the wordmark on the left, the profile avatar on the right and an optional row
 * of scope chips underneath. The bottom hairline brightens as soon as the page scrolls.
 */
export function GlassHeader({ scrollY, children }: GlassHeaderProps) {
  const s = useStyles();
  const { t } = useI18n();
  const { session } = useSession();
  const { insets, pagePad } = useLayout();
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const own = useSharedValue(0);
  const scroll = scrollY ?? own;

  useAnimatedReaction(
    () => scroll.value > SCROLLED_AT,
    (next, previous) => {
      if (next !== previous) runOnJS(setScrolled)(next);
    },
    [scroll],
  );

  if (!session) return null;

  return (
    <>
      <Glass hairline hairlineOpacity={scrolled ? 0.9 : 0.35} style={[s.root, { paddingTop: insets.top }]}>
        <View style={[s.row, { paddingLeft: pagePad, paddingRight: Math.max(pagePad - 6, 8) }]}>
          <Logo size="nav" />
          <View style={s.spacer} />
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t("account")}
            onPress={() => setMenu(true)}
            style={s.avatarHit}
          >
            <Avatar src={sessionAvatar(session)} name={session.userName} size={32} />
          </PressableScale>
        </View>
        {children}
      </Glass>
      <AccountSheet visible={menu} onClose={() => setMenu(false)} />
    </>
  );
}

const useStyles = makeStyles(() => ({
  root: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
  row: { height: HEADER_ROW_HEIGHT, flexDirection: "row", alignItems: "center" },
  spacer: { flex: 1 },
  avatarHit: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
}));
