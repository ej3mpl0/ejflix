import React, { memo, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import { Star } from "lucide-react-native";
import type { Channel, EpgNow } from "../../lib/types";
import { channelInitials, formatRange, formatTime, programmeProgress } from "../../lib/iptv";
import { useI18n } from "../../lib/locale-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { PressableScale } from "../ui/PressableScale";
import { ProgressBar } from "../ui/ProgressBar";

/** Height of the two-line text block: keeps every tile exactly as tall as the rest. */
const TEXT_H = 74;

export type ChannelCardProps = {
  channel: Channel;
  epg?: EpgNow;
  /** Tile width (from `layout.grid()`). */
  width: number;
  onPlay: (channel: Channel) => void;
  onFavorite: (channel: Channel, on: boolean) => void;
};

/**
 * Channel tile: logo centred on a 16:9 plate, name, programme on air with its
 * progress (or the group when there is no guide) and a star for Favorites.
 *
 * Every tile has the same height: the plate is a fixed 16:9 box whose content is
 * absolutely positioned (a tall logo cannot stretch it), logos share one bounding
 * box so small and large images look alike, and the text block is two single lines.
 * Unlike the desktop the star is always visible — there is no hover on a touch screen.
 */
function ChannelCardInner({ channel, epg, width, onPlay, onFavorite }: ChannelCardProps) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const [broken, setBroken] = useState(false);
  const plateH = Math.round((width * 9) / 16);
  const now = epg?.now ?? null;
  const next = epg?.next ?? null;
  const progress = now ? programmeProgress(now) : 0;
  const on = channel.favorite;

  useEffect(() => setBroken(false), [channel.logo]);

  return (
    <View style={[s.root, { width }]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${tr("play")} ${channel.name}`}
        onPress={() => onPlay(channel)}
        scaleTo={0.97}
        style={s.card}
      >
        <View style={[s.plate, { height: plateH }]}>
          {channel.logo && !broken ? (
            <Image
              source={{ uri: channel.logo }}
              contentFit="contain"
              transition={200}
              cachePolicy="memory-disk"
              recyclingKey={channel.id}
              onError={() => setBroken(true)}
              style={s.logo}
            />
          ) : (
            <View style={s.initialsBox}>
              <Text style={s.initials}>{channelInitials(channel.name)}</Text>
            </View>
          )}
          {channel.number != null ? (
            <View style={s.number}>
              <Text style={s.numberText}>{channel.number}</Text>
            </View>
          ) : null}
          {channel.kind === "movie" ? (
            <View style={s.vod}>
              <Text style={s.vodText}>VOD</Text>
            </View>
          ) : null}
          {now ? (
            <ProgressBar value={progress / 100} height={3} track={t.white(0.15)} style={s.progress} />
          ) : null}
        </View>
        <View style={s.texts}>
          <Text numberOfLines={1} style={s.name}>
            {channel.name}
          </Text>
          {now ? (
            <Text numberOfLines={1} style={s.sub}>
              <Text style={s.time}>{formatRange(now, locale)}</Text>
              <Text style={s.title}>{` · ${now.title}`}</Text>
            </Text>
          ) : (
            <Text numberOfLines={1} style={s.sub}>
              {channel.group || tr("noGroup")}
            </Text>
          )}
          {next ? (
            <Text numberOfLines={1} style={s.sub}>
              {`${tr("upNext")} ${formatTime(next.start, locale)} · ${next.title}`}
            </Text>
          ) : null}
        </View>
      </PressableScale>
      <PressableScale
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={on ? tr("removeFavorite") : tr("addFavorite")}
        hitSlop={10}
        onPress={() => onFavorite(channel, !on)}
        style={s.star}
      >
        <Star
          size={16}
          strokeWidth={2}
          color={on ? t.colors.star : t.white(0.75)}
          fill={on ? t.colors.star : "transparent"}
        />
      </PressableScale>
    </View>
  );
}

export const ChannelCard = memo(ChannelCardInner);

const useStyles = makeStyles((t) => ({
  root: { position: "relative" },
  card: {
    borderRadius: t.radii.poster,
    backgroundColor: t.colors.surface,
    borderWidth: 1,
    borderColor: t.white(0.06),
    overflow: "hidden",
  },
  plate: { width: "100%", backgroundColor: t.white(0.03), overflow: "hidden" },
  logo: { position: "absolute", left: "16%", right: "16%", top: "22%", bottom: "22%" },
  initialsBox: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 56,
    height: 56,
    marginTop: -28,
    marginLeft: -28,
    borderRadius: 18,
    backgroundColor: t.white(0.08),
    alignItems: "center",
    justifyContent: "center",
  },
  initials: { ...text(20, "bold", { tracking: 0.02 }), color: t.white(0.8) },
  number: {
    position: "absolute",
    top: 8,
    left: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: t.black(0.6),
  },
  numberText: { ...text(11, "semibold", { tabular: true }), color: t.white(0.85) },
  vod: {
    position: "absolute",
    bottom: 8,
    left: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: t.white(0.12),
  },
  vodText: { ...text(9, "bold", { tracking: 0.06, uppercase: true }), color: t.white(0.75) },
  progress: { position: "absolute", left: 0, right: 0, bottom: 0, borderRadius: 0 },
  texts: { height: TEXT_H, paddingHorizontal: 10, paddingVertical: 9, gap: 2 },
  name: { ...text(13, "medium", { lineHeight: 18 }), color: t.colors.text },
  sub: { ...text(11, "regular", { lineHeight: 16 }), color: t.colors.dim },
  time: { fontVariant: ["tabular-nums"], color: t.colors.dim },
  title: { color: t.colors.muted },
  star: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.black(0.55),
  },
}));
