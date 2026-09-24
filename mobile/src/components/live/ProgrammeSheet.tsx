import React from "react";
import { ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { Bell, BellOff, History, Tv } from "lucide-react-native";
import type { Channel, Programme } from "../../lib/types";
import { canCatchup, channelInitials, formatTime, formatWhen } from "../../lib/iptv";
import { useI18n } from "../../lib/locale-context";
import { makeStyles } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { Pill } from "../ui/Pill";
import { Sheet } from "../ui/Sheet";

export type ProgrammeSheetProps = {
  open: { channel: Channel; programme: Programme } | null;
  reminded: boolean;
  onToggleReminder: (channel: Channel, programme: Programme, on: boolean) => void;
  onPlayLive: (channel: Channel) => void;
  onCatchup: (channel: Channel, programme: Programme) => void;
  onClose: () => void;
};

/**
 * A programme of the guide (desktop `ProgrammeDialog`): what and when, plus a reminder
 * when it has not started, the archive when it aired on a channel with catch-up, and
 * the live channel always.
 */
export function ProgrammeSheet({ open, reminded, onToggleReminder, onPlayLive, onCatchup, onClose }: ProgrammeSheetProps) {
  const s = useStyles();
  const { t, locale } = useI18n();
  const channel = open?.channel ?? null;
  const programme = open?.programme ?? null;
  const now = Date.now() / 1000;
  const upcoming = programme ? programme.start > now : false;
  const aired = programme ? programme.stop <= now : false;
  const archived = channel && programme ? canCatchup(channel, programme) : false;
  const status = upcoming ? t("programmeUpcoming") : aired ? (archived ? t("catchupAvailable") : t("programmeEnded")) : t("liveBadge");

  return (
    <Sheet visible={open !== null} onClose={onClose}>
      {channel && programme ? (
        <View style={s.root}>
          <View style={s.head}>
            <View style={s.logo}>
              {channel.logo ? (
                <Image source={{ uri: channel.logo }} contentFit="contain" style={s.logoImage} />
              ) : (
                <Text style={s.initials}>{channelInitials(channel.name)}</Text>
              )}
            </View>
            <View style={s.headText}>
              <Text numberOfLines={1} style={s.channel}>
                {channel.name}
              </Text>
              <Text style={s.status}>{status}</Text>
            </View>
          </View>
          <Text style={s.title}>{programme.title}</Text>
          <Text style={s.when}>
            {formatWhen(programme.start, locale)} – {formatTime(programme.stop, locale)}
            {programme.category ? ` · ${programme.category}` : ""}
          </Text>
          {programme.desc ? (
            <ScrollView style={s.descBox} nestedScrollEnabled>
              <Text style={s.desc}>{programme.desc}</Text>
            </ScrollView>
          ) : null}
          <View style={s.actions}>
            {upcoming ? (
              <Pill
                pill
                variant={reminded ? "tonal" : "primary"}
                icon={reminded ? BellOff : Bell}
                label={reminded ? t("reminderCancel") : t("remindMe")}
                onPress={() => onToggleReminder(channel, programme, !reminded)}
              />
            ) : null}
            {aired && archived ? (
              <Pill pill variant="primary" icon={History} label={t("catchupWatch")} onPress={() => onCatchup(channel, programme)} />
            ) : null}
            <Pill
              pill
              variant={upcoming || (aired && archived) ? "tonal" : "primary"}
              icon={Tv}
              label={t("watchLive")}
              onPress={() => onPlayLive(channel)}
            />
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  root: { paddingHorizontal: 20, paddingBottom: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  logo: {
    width: 56,
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
  headText: { flex: 1, minWidth: 0 },
  channel: { ...text(13, "medium"), color: t.colors.muted },
  status: { ...text(11, "semibold", { tracking: 0.08, uppercase: true }), color: t.colors.dim, marginTop: 2 },
  title: { ...text(20, "semibold", { lineHeight: 25 }), color: t.colors.text },
  when: { ...text(13, "regular", { tabular: true }), color: t.colors.dim, marginTop: 6 },
  descBox: { maxHeight: 180, marginTop: 14 },
  desc: { ...text(14, "regular", { lineHeight: 21 }), color: t.colors.muted },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 20 },
}));
