import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, type RefreshControlProps } from "react-native";
import { Image } from "expo-image";
import { Bell, History } from "lucide-react-native";
import type { Channel, Programme } from "../../lib/types";
import { api } from "../../lib/api";
import { canCatchup, channelInitials, formatTime, reminderKey } from "../../lib/iptv";
import { useI18n } from "../../lib/locale-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { ProgrammeSheet } from "./ProgrammeSheet";

const HOUR_W = 240;
const SPAN_HOURS = 6;
/** How far back the guide goes when a listed channel has catch-up. */
const CATCHUP_HOURS = 24;
const ROW_H = 58;
const NAME_W = 120;
const MAX_CHANNELS = 40;

/**
 * Programme guide: the listed channels (those with a guide) against a six-hour timeline
 * that starts half an hour ago, with a line on "now". With a catch-up channel listed it
 * also reaches a day back (opened on "now"). The whole grid scrolls sideways together;
 * a tap on a channel or on the programme on air plays the channel, any other programme
 * opens its sheet (reminder, catch-up).
 */
export function EpgGuide({
  channels,
  onPlay,
  reminders,
  onToggleReminder,
  onCatchup,
  loading = false,
  skeleton,
  refreshControl,
  header,
  footer,
  contentPadding,
}: {
  channels: Channel[];
  onPlay: (channel: Channel) => void;
  /** `reminderKey`s of the programmes with a reminder. */
  reminders: Set<string>;
  onToggleReminder: (channel: Channel, programme: Programme, on: boolean) => void;
  onCatchup: (channel: Channel, programme: Programme) => void;
  /** The channel list itself is loading: `skeleton` instead of "no guide". */
  loading?: boolean;
  skeleton?: React.ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  contentPadding: { horizontal: number; bottom: number };
}) {
  const s = useStyles();
  const th = useTheme();
  const { t, locale } = useI18n();
  const withGuide = useMemo(() => channels.filter((c) => c.epg).slice(0, MAX_CHANNELS), [channels]);
  const [guide, setGuide] = useState<Record<string, Programme[]>>({});
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [open, setOpen] = useState<{ channel: Channel; programme: Programme } | null>(null);
  const hasCatchup = withGuide.some((c) => (c.catchupDays ?? 0) > 0);
  const liveOrigin = useMemo(() => Math.floor((Date.now() / 1000 - 1800) / 1800) * 1800, []);
  const origin = hasCatchup ? liveOrigin - CATCHUP_HOURS * 3600 : liveOrigin;
  const end = liveOrigin + SPAN_HOURS * 3600;
  const x = (seconds: number) => ((seconds - origin) / 3600) * HOUR_W;
  const scroller = useRef<ScrollView>(null);
  /** The catch-up state the horizontal scroll was last placed for. */
  const placed = useRef(false);

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => clearInterval(handle);
  }, []);

  useEffect(() => {
    let alive = true;
    const missing = withGuide.filter((c) => !guide[c.id]);
    void (async () => {
      for (let i = 0; i < missing.length; i += 6) {
        const batch = missing.slice(i, i + 6);
        const results = await Promise.all(batch.map((c) => api.iptvEpgChannel(c.id).catch(() => [] as Programme[])));
        if (!alive) return;
        setGuide((current) => {
          const next = { ...current };
          batch.forEach((c, k) => (next[c.id] = results[k]));
          return next;
        });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withGuide]);

  const hours = Array.from({ length: Math.round((end - origin) / 1800) }, (_, i) => origin + i * 1800);
  const width = NAME_W + ((end - origin) / 3600) * HOUR_W;

  return (
    <>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
        contentContainerStyle={{ paddingBottom: contentPadding.bottom }}
      >
        {header}
        {withGuide.length ? (
          <ScrollView
            ref={scroller}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: contentPadding.horizontal }}
            // Opens on "now": the catch-up day sits to the left (`contentOffset` is iOS only).
            onContentSizeChange={() => {
              if (placed.current === hasCatchup) return;
              placed.current = hasCatchup;
              scroller.current?.scrollTo({ x: ((liveOrigin - origin) / 3600) * HOUR_W, animated: false });
            }}
          >
            <View style={[s.grid, { width }]}>
              <View style={s.ruler}>
                <View style={{ width: NAME_W }} />
                {hours.map((h) => (
                  <Text key={h} style={[s.hour, { left: NAME_W + x(h) }]}>
                    {formatTime(h, locale)}
                  </Text>
                ))}
              </View>
              {withGuide.map((channel) => {
                const programmes = (guide[channel.id] ?? []).filter((p) => p.stop > origin && p.start < end);
                return (
                  <View key={channel.id} style={s.row}>
                    <Pressable accessibilityRole="button" accessibilityLabel={channel.name} onPress={() => onPlay(channel)} style={s.name}>
                      <View style={s.logo}>
                        {channel.logo ? (
                          <Image source={{ uri: channel.logo }} contentFit="contain" style={{ width: "100%", height: "100%" }} />
                        ) : (
                          <Text style={s.initials}>{channelInitials(channel.name)}</Text>
                        )}
                      </View>
                      <Text numberOfLines={2} style={s.channelName}>
                        {channel.name}
                      </Text>
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      {guide[channel.id] && !programmes.length ? (
                        <Text style={[s.noData, { left: x(liveOrigin) + 10 }]}>{t("guideNoData")}</Text>
                      ) : null}
                      {programmes.map((p) => {
                        const left = Math.max(0, x(p.start));
                        const w = Math.max(4, x(Math.min(p.stop, end)) - left - 2);
                        const live = p.start <= now && now < p.stop;
                        const past = p.stop <= now;
                        const archived = past && canCatchup(channel, p);
                        const reminded = reminders.has(reminderKey(channel.id, p.start));
                        return (
                          <Pressable
                            key={`${p.start}:${p.title}`}
                            accessibilityRole="button"
                            accessibilityLabel={`${formatTime(p.start, locale)} ${p.title}${archived ? `, ${t("catchupAvailable")}` : ""}`}
                            onPress={() => (live ? onPlay(channel) : setOpen({ channel, programme: p }))}
                            style={[
                              s.programme,
                              { left: left + 1, width: w },
                              live ? s.programmeLive : past && !archived ? s.programmePast : null,
                            ]}
                          >
                            <View style={s.titleRow}>
                              {archived ? <History size={11} color={th.colors.accent} strokeWidth={2.2} /> : null}
                              {reminded ? <Bell size={11} color={th.colors.accent} fill={th.colors.accent} strokeWidth={2.2} /> : null}
                              <Text numberOfLines={1} style={s.programmeTitle}>
                                {p.title}
                              </Text>
                            </View>
                            <Text numberOfLines={1} style={s.programmeTime}>
                              {formatTime(p.start, locale)} – {formatTime(p.stop, locale)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
              {now > origin && now < end ? (
                <View pointerEvents="none" style={[s.nowLine, { left: NAME_W + x(now), backgroundColor: th.colors.accent }]} />
              ) : null}
            </View>
          </ScrollView>
        ) : loading ? (
          <View style={{ paddingHorizontal: contentPadding.horizontal }}>{skeleton}</View>
        ) : (
          <Text style={[s.empty, { marginHorizontal: contentPadding.horizontal }]}>{t("guideEmpty")}</Text>
        )}
        {footer}
      </ScrollView>
      <ProgrammeSheet
        open={open}
        reminded={open ? reminders.has(reminderKey(open.channel.id, open.programme.start)) : false}
        onToggleReminder={onToggleReminder}
        onPlayLive={(channel) => {
          setOpen(null);
          onPlay(channel);
        }}
        onCatchup={(channel, programme) => {
          setOpen(null);
          onCatchup(channel, programme);
        }}
        onClose={() => setOpen(null)}
      />
    </>
  );
}

const useStyles = makeStyles((t) => ({
  grid: { borderRadius: 20, backgroundColor: t.colors.surface, overflow: "hidden" },
  ruler: { height: 34, flexDirection: "row", borderBottomWidth: 1, borderBottomColor: t.white(0.08) },
  hour: { position: "absolute", top: 0, height: 34, lineHeight: 34, paddingLeft: 8, ...text(11, "regular", { tabular: true }), color: t.colors.dim },
  row: { height: ROW_H, flexDirection: "row", borderBottomWidth: 1, borderBottomColor: t.white(0.05) },
  name: { width: NAME_W, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, borderRightWidth: 1, borderRightColor: t.white(0.08) },
  logo: { width: 36, height: 28, borderRadius: 6, backgroundColor: t.white(0.06), alignItems: "center", justifyContent: "center", overflow: "hidden", padding: 2 },
  initials: { ...text(10, "bold"), color: t.white(0.7) },
  channelName: { ...text(11, "medium"), color: t.colors.text, flex: 1 },
  noData: { ...text(12), color: t.colors.dim, position: "absolute", top: 20 },
  programme: { position: "absolute", top: 6, bottom: 6, borderRadius: 10, paddingHorizontal: 8, justifyContent: "center", backgroundColor: t.white(0.06) },
  programmeLive: { backgroundColor: t.colors.accentSoft, borderWidth: 1, borderColor: t.colors.accent },
  programmePast: { opacity: 0.55 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  programmeTitle: { ...text(12, "medium"), color: t.colors.text, flexShrink: 1 },
  programmeTime: { ...text(10, "regular", { tabular: true }), color: t.colors.dim },
  nowLine: { position: "absolute", top: 0, bottom: 0, width: 2 },
  empty: { ...text(14), color: t.colors.muted, textAlign: "center", paddingVertical: 40, backgroundColor: t.colors.surface, borderRadius: 20 },
}));
