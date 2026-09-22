import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import type { Channel, Programme } from "../../lib/types";
import { api } from "../../lib/api";
import { channelInitials, formatTime } from "../../lib/iptv";
import { useI18n } from "../../lib/locale-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";

const HOUR_W = 240;
const SPAN_HOURS = 6;
const ROW_H = 58;
const NAME_W = 120;
const MAX_CHANNELS = 40;

/**
 * Programme guide: the listed channels (those with a guide) against a six-hour timeline
 * that starts half an hour ago, with a line on "now". The whole grid scrolls sideways
 * together; a tap on a programme or a channel plays that channel.
 */
export function EpgGuide({
  channels,
  onPlay,
  header,
  footer,
  contentPadding,
}: {
  channels: Channel[];
  onPlay: (channel: Channel) => void;
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
  const origin = useMemo(() => Math.floor((Date.now() / 1000 - 1800) / 1800) * 1800, []);
  const end = origin + SPAN_HOURS * 3600;
  const x = (seconds: number) => ((seconds - origin) / 3600) * HOUR_W;

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

  const hours = Array.from({ length: SPAN_HOURS * 2 }, (_, i) => origin + i * 1800);
  const width = NAME_W + SPAN_HOURS * HOUR_W;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: contentPadding.bottom }}>
      {header}
      {withGuide.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: contentPadding.horizontal }}>
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
                    {guide[channel.id] && !programmes.length ? <Text style={s.noData}>{t("guideNoData")}</Text> : null}
                    {programmes.map((p) => {
                      const left = Math.max(0, x(p.start));
                      const w = Math.max(4, x(Math.min(p.stop, end)) - left - 2);
                      const live = p.start <= now && now < p.stop;
                      return (
                        <Pressable
                          key={`${p.start}:${p.title}`}
                          accessibilityRole="button"
                          accessibilityLabel={`${formatTime(p.start, locale)} ${p.title}`}
                          onPress={() => onPlay(channel)}
                          style={[s.programme, { left: left + 1, width: w }, live ? s.programmeLive : null]}
                        >
                          <Text numberOfLines={1} style={s.programmeTitle}>
                            {p.title}
                          </Text>
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
      ) : (
        <Text style={[s.empty, { marginHorizontal: contentPadding.horizontal }]}>{t("guideEmpty")}</Text>
      )}
      {footer}
    </ScrollView>
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
  noData: { ...text(12), color: t.colors.dim, position: "absolute", left: 10, top: 20 },
  programme: { position: "absolute", top: 6, bottom: 6, borderRadius: 10, paddingHorizontal: 8, justifyContent: "center", backgroundColor: t.white(0.06) },
  programmeLive: { backgroundColor: t.colors.accentSoft, borderWidth: 1, borderColor: t.colors.accent },
  programmeTitle: { ...text(12, "medium"), color: t.colors.text },
  programmeTime: { ...text(10, "regular", { tabular: true }), color: t.colors.dim },
  nowLine: { position: "absolute", top: 0, bottom: 0, width: 2 },
  empty: { ...text(14), color: t.colors.muted, textAlign: "center", paddingVertical: 40, backgroundColor: t.colors.surface, borderRadius: 20 },
}));
