import React, { useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import { Image } from "expo-image";
import Animated, { FadeInUp, FadeOut, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BellRing, Play, X } from "lucide-react-native";
import type { Reminder } from "../../lib/types";
import { api } from "../../lib/api";
import { haptic } from "../../lib/haptics";
import { channelInitials, channelToMovie, formatTime, reminderChannel, reminderKey } from "../../lib/iptv";
import { useI18n } from "../../lib/locale-context";
import { openPlayer } from "../../navigation/navigationRef";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { IconButton } from "../ui/IconButton";
import { Pill } from "../ui/Pill";

/** How often the reminders of the profile are checked while the app is open. */
const CHECK_MS = 15_000;
/** An announced reminder stays on screen this long unless answered. */
const SHOW_MS = 3 * 60_000;

/**
 * Programme reminders, announced in the app a minute before the start (there are no
 * system notifications on mobile): a card at the top with the channel, the programme
 * and "Watch now", above every screen including the player.
 */
export function ReminderAlerts() {
  const s = useStyles();
  const th = useTheme();
  const { t, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [alerts, setAlerts] = useState<Reminder[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    let alive = true;
    const check = () => {
      api
        .iptvDueReminders()
        .then((due) => {
          if (!alive || !due.length) return;
          haptic("warning");
          setNow(Date.now());
          const keys = new Set(due.map((r) => reminderKey(r.channelId, r.start)));
          setAlerts((list) => [...list.filter((r) => !keys.has(reminderKey(r.channelId, r.start))), ...due]);
          const handle = setTimeout(() => {
            pending.delete(handle);
            setAlerts((list) => list.filter((r) => !keys.has(reminderKey(r.channelId, r.start))));
          }, SHOW_MS);
          pending.add(handle);
        })
        .catch(() => undefined);
    };
    check();
    const handle = setInterval(check, CHECK_MS);
    // Timers pause in the background: check as soon as the app is back.
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") check();
    });
    return () => {
      alive = false;
      clearInterval(handle);
      sub.remove();
      pending.forEach((h) => clearTimeout(h));
      pending.clear();
    };
  }, []);

  // "Starts in a minute" turns into "Already started" on its own.
  useEffect(() => {
    if (!alerts.length) return;
    const handle = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(handle);
  }, [alerts.length]);

  if (!alerts.length) return null;

  const dismiss = (reminder: Reminder) => setAlerts((list) => list.filter((r) => r !== reminder));

  return (
    <View pointerEvents="box-none" style={[s.stack, { top: insets.top + 12, left: Math.max(12, insets.left), right: Math.max(12, insets.right) }]}>
      {alerts.map((reminder) => (
        <Animated.View
          key={reminderKey(reminder.channelId, reminder.start)}
          entering={reduced ? undefined : FadeInUp.duration(260)}
          exiting={reduced ? undefined : FadeOut.duration(180)}
          accessibilityRole="alert"
          style={s.card}
        >
          <View style={s.logo}>
            {reminder.logo ? (
              <Image source={{ uri: reminder.logo }} contentFit="contain" style={s.logoImage} />
            ) : (
              <Text style={s.initials}>{channelInitials(reminder.channelName)}</Text>
            )}
          </View>
          <View style={s.body}>
            <View style={s.kickerRow}>
              <BellRing size={12} color={th.colors.accent} strokeWidth={2.2} />
              <Text style={s.kicker}>{reminder.start * 1000 > now ? t("reminderSoon") : t("reminderNow")}</Text>
            </View>
            <Text numberOfLines={1} style={s.title}>
              {reminder.title}
            </Text>
            <Text numberOfLines={1} style={s.meta}>
              {reminder.channelName} · {formatTime(reminder.start, locale)}
            </Text>
          </View>
          <Pill
            pill
            size="sm"
            variant="primary"
            icon={Play}
            label={t("watchNow")}
            onPress={() => {
              dismiss(reminder);
              openPlayer(channelToMovie(reminderChannel(reminder), ""));
            }}
          />
          <IconButton icon={X} label={t("close")} size={16} hit={36} onPress={() => dismiss(reminder)} />
        </Animated.View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  stack: { position: "absolute", zIndex: 90, gap: 8, alignItems: "center" },
  card: {
    width: "100%",
    maxWidth: 520,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 4,
    borderRadius: 18,
    backgroundColor: t.amoled ? "rgba(18, 18, 18, 0.97)" : `${t.colors.panel}f2`,
    borderWidth: 1,
    borderColor: t.white(0.1),
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  logo: {
    width: 52,
    height: 40,
    borderRadius: 8,
    backgroundColor: t.white(0.06),
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    padding: 4,
  },
  logoImage: { width: "100%", height: "100%" },
  initials: { ...text(12, "bold"), color: t.white(0.7) },
  body: { flex: 1, minWidth: 0 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  kicker: { ...text(10, "semibold", { tracking: 0.06, uppercase: true }), color: t.colors.accent },
  title: { ...text(14, "semibold"), color: t.colors.text, marginTop: 1 },
  meta: { ...text(12), color: t.colors.dim },
}));
