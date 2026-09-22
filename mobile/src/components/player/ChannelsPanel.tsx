import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { Star } from "lucide-react-native";
import type { Channel, EpgNow, LiveRef } from "../../lib/types";
import { api } from "../../lib/api";
import { channelInitials, programmeProgress } from "../../lib/iptv";
import { useI18n } from "../../lib/locale-context";
import { makeStyles } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { Chip } from "../ui/Chip";
import { ProgressBar } from "../ui/ProgressBar";
import { Sheet } from "../ui/Sheet";
import { Shimmer } from "../ui/Shimmer";

type Tab = "group" | "favorites";
const ROW_H = 64;

/**
 * Side panel while a channel plays: the channels of the same group (or the favorites)
 * with what is on air, to switch without leaving the video.
 */
export function ChannelsPanel({
  visible,
  live,
  channels,
  width,
  onPlay,
  onClose,
}: {
  visible: boolean;
  live: LiveRef;
  /** Channels of the current group, already loaded by the player for zapping. */
  channels: Channel[];
  width: number;
  onPlay: (channel: Channel) => void;
  onClose: () => void;
}) {
  const s = useStyles();
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("group");
  const [favorites, setFavorites] = useState<Channel[] | null>(null);
  const [epg, setEpg] = useState<Record<string, EpgNow>>({});
  const list = tab === "group" ? channels : favorites ?? [];

  useEffect(() => {
    if (!visible || tab !== "favorites" || favorites) return;
    let alive = true;
    api
      .iptvChannels({ favorites: true, limit: 500 })
      .then((page) => {
        if (alive) setFavorites(page.items);
      })
      .catch(() => {
        if (alive) setFavorites([]);
      });
    return () => {
      alive = false;
    };
  }, [visible, tab, favorites]);

  const ids = useMemo(() => list.filter((c) => c.epg).map((c) => c.id), [list]);
  const idsKey = ids.join(",");
  useEffect(() => {
    if (!visible || !ids.length) return;
    let alive = true;
    api
      .iptvEpgNow(ids)
      .then((map) => {
        if (alive) setEpg((previous) => ({ ...previous, ...map }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, idsKey]);

  const currentIndex = list.findIndex((c) => c.id === live.channelId);

  return (
    <Sheet visible={visible} onClose={onClose} side="right" width={width} title={live.group || live.sourceName || t("liveTv")} contentStyle={s.content}>
      <Text style={s.kicker}>{t("channels")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        <Chip label={live.group || t("allChannels")} selected={tab === "group"} onPress={() => setTab("group")} />
        <Chip label={t("favorites")} icon={Star} selected={tab === "favorites"} onPress={() => setTab("favorites")} />
      </ScrollView>
      {tab === "favorites" && favorites == null ? (
        <View style={s.skeleton}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} style={s.skeletonRow}>
              <Shimmer width={84} height={48} radius={6} delay={i * 80} />
              <View style={{ flex: 1, gap: 8, paddingVertical: 4 }}>
                <Shimmer width="75%" height={14} radius={4} />
                <Shimmer width="33%" height={12} radius={4} />
              </View>
            </View>
          ))}
        </View>
      ) : tab === "favorites" && favorites && !favorites.length ? (
        <Text style={s.empty}>{t("noFavoriteChannels")}</Text>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(channel) => channel.id}
          style={s.list}
          contentContainerStyle={s.listContent}
          initialScrollIndex={currentIndex > 0 ? currentIndex : undefined}
          getItemLayout={(_, index) => ({ length: ROW_H, offset: ROW_H * index, index })}
          onScrollToIndexFailed={() => undefined}
          renderItem={({ item: channel }) => {
            const current = channel.id === live.channelId;
            const now = epg[channel.id]?.now ?? null;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                onPress={() => (current ? onClose() : onPlay(channel))}
                style={({ pressed }) => [s.row, current ? s.rowCurrent : null, pressed ? s.rowPressed : null]}
              >
                {current ? <View style={s.rail} /> : null}
                <View style={s.logo}>
                  {channel.logo ? (
                    <Image source={{ uri: channel.logo }} contentFit="contain" style={s.logoImg} />
                  ) : (
                    <Text style={s.initials}>{channelInitials(channel.name)}</Text>
                  )}
                </View>
                <View style={s.textCol}>
                  <Text numberOfLines={1} style={[s.name, current ? s.nameCurrent : null]}>
                    {channel.number != null ? <Text style={s.number}>{channel.number}  </Text> : null}
                    {channel.name}
                  </Text>
                  <Text numberOfLines={1} style={s.sub}>
                    {now ? now.title : channel.group || t("noGroup")}
                  </Text>
                  {now ? <ProgressBar value={programmeProgress(now) / 100} height={2} animated={false} style={s.progress} /> : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  content: { flex: 1 },
  kicker: { ...text(11, "semibold", { tracking: 0.08, uppercase: true }), color: t.colors.dim, paddingHorizontal: 20, marginTop: -6, marginBottom: 8 },
  chips: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  skeleton: { paddingHorizontal: 12 },
  skeletonRow: { flexDirection: "row", gap: 12, padding: 8 },
  empty: { ...text(13), color: t.colors.dim, textAlign: "center", paddingVertical: 24 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingBottom: 16 },
  row: { height: ROW_H, flexDirection: "row", alignItems: "center", gap: 12, padding: 8, borderRadius: 10 },
  rowCurrent: { backgroundColor: t.white(0.08) },
  rowPressed: { backgroundColor: t.white(0.06) },
  rail: { position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, backgroundColor: t.colors.accent },
  logo: { width: 84, height: 48, borderRadius: 6, backgroundColor: t.white(0.06), alignItems: "center", justifyContent: "center", padding: 6, overflow: "hidden" },
  logoImg: { width: "100%", height: "100%" },
  initials: { ...text(13, "bold"), color: t.white(0.7) },
  textCol: { flex: 1, minWidth: 0 },
  name: { ...text(13), color: t.colors.text },
  nameCurrent: { ...text(13, "semibold"), color: t.colors.text },
  number: { ...text(13, "regular", { tabular: true }), color: t.colors.dim },
  sub: { ...text(11), color: t.colors.dim },
  progress: { marginTop: 4, backgroundColor: t.white(0.15) },
}));
