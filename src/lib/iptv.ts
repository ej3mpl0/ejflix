import type { Channel, EpgNow, Movie, Programme, Reminder } from "./types";
import { emptyMovie } from "./addons";

/** Id prefix of live channels inside the app (never a Jellyfin id). */
const PREFIX = "live:";

/** Channel → player item. The channel identity travels in `movie.live`. */
export function channelToMovie(channel: Channel, sourceName: string): Movie {
  const base = emptyMovie(`${PREFIX}${channel.id}`, "LiveTv", channel.name);
  return {
    ...base,
    posterUrl: channel.logo,
    logoUrl: channel.logo,
    genres: channel.group ? [channel.group] : [],
    favorite: channel.favorite,
    live: {
      channelId: channel.id,
      sourceId: channel.sourceId,
      sourceName,
      group: channel.group,
      number: channel.number,
      logo: channel.logo,
      kind: channel.kind,
    },
  };
}

/** 0–100 of the programme already aired. */
export function programmeProgress(programme: Programme, nowMs = Date.now()): number {
  const length = programme.stop - programme.start;
  if (length <= 0) return 0;
  const done = nowMs / 1000 - programme.start;
  return Math.max(0, Math.min(100, (done / length) * 100));
}

/** "20:30" in the viewer's clock. */
export function formatTime(unixSeconds: number, locale: string): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString(locale === "en" ? "en-GB" : "es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRange(programme: Programme, locale: string): string {
  return `${formatTime(programme.start, locale)} – ${formatTime(programme.stop, locale)}`;
}

/** Minutes left of the current programme (at least 1). */
export function minutesLeft(programme: Programme, nowMs = Date.now()): number {
  return Math.max(1, Math.round((programme.stop - nowMs / 1000) / 60));
}

/** "hace 5 min" / "5 min ago" style label for the playlist refresh time. */
export function formatAgo(updatedMs: number, locale: string): string {
  if (!updatedMs) return "";
  const minutes = Math.max(0, Math.round((Date.now() - updatedMs) / 60_000));
  const rtf = new Intl.RelativeTimeFormat(locale === "en" ? "en" : "es", { numeric: "auto" });
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}

/** Second line of a channel card: the programme on air, else the group. */
export function channelSubtitle(channel: Channel, epg: EpgNow | undefined): string {
  return epg?.now?.title ?? channel.group;
}

/** Initials for channels without a logo ("La 1 HD" → "L1"). */
export function channelInitials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

// ---- reminders, catch-up and multi-view ----

/** Identity of a reminder (a channel has one programme starting at a given second). */
export function reminderKey(channelId: string, start: number): string {
  return `${channelId}@${start}`;
}

export function reminderOf(channel: Channel, programme: Programme): Reminder {
  return {
    channelId: channel.id,
    sourceId: channel.sourceId,
    channelName: channel.name,
    logo: channel.logo,
    group: channel.group,
    number: channel.number,
    title: programme.title,
    start: programme.start,
    stop: programme.stop,
  };
}

/** The channel of a reminder, enough to tune it (`channelToMovie`). */
export function reminderChannel(reminder: Reminder): Channel {
  return {
    id: reminder.channelId,
    sourceId: reminder.sourceId,
    name: reminder.channelName,
    logo: reminder.logo,
    group: reminder.group,
    kind: "live",
    number: reminder.number,
    tvgId: "",
    favorite: false,
    epg: true,
  };
}

/** A finished programme still inside the channel's archive window. */
export function canCatchup(channel: Channel, programme: Programme, nowMs = Date.now()): boolean {
  const days = channel.catchupDays ?? 0;
  const now = nowMs / 1000;
  return days > 0 && programme.stop <= now && programme.start >= now - days * 86_400;
}

/** A past programme played from the archive: same channel identity, programme as title. */
export function catchupToMovie(channel: Channel, sourceName: string, programme: Programme): Movie {
  const movie = channelToMovie(channel, sourceName);
  return {
    ...movie,
    id: `${movie.id}@${programme.start}`,
    name: programme.title,
    overview: programme.desc ?? movie.overview,
    live: { ...movie.live!, catchup: { start: programme.start, stop: programme.stop, title: programme.title } },
  };
}

/** Most channels in one multi-view mosaic. */
export const MULTIVIEW_MAX = 4;

/** Multi-view item: the first channel carries the list of every cell. */
export function multiviewToMovie(channels: Channel[], sourceName: string): Movie {
  const movie = channelToMovie(channels[0], sourceName);
  return {
    ...movie,
    id: `live:multiview:${channels.map((c) => c.id).join("|")}`,
    name: channels.map((c) => c.name).join(" · "),
    live: {
      ...movie.live!,
      multiview: channels.map((c) => ({ channelId: c.id, name: c.name, logo: c.logo })),
    },
  };
}

/** "hoy 20:30" / "mañana 08:00" / "vie 21 20:00": when a programme starts. */
export function formatWhen(unixSeconds: number, locale: string, nowMs = Date.now()): string {
  const date = new Date(unixSeconds * 1000);
  const today = new Date(nowMs);
  const dayDiff = Math.round(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  );
  const time = formatTime(unixSeconds, locale);
  const en = locale === "en";
  if (dayDiff === 0) return `${en ? "today" : "hoy"} ${time}`;
  if (dayDiff === 1) return `${en ? "tomorrow" : "mañana"} ${time}`;
  if (dayDiff === -1) return `${en ? "yesterday" : "ayer"} ${time}`;
  const day = date.toLocaleDateString(en ? "en-GB" : "es-ES", { weekday: "short", day: "numeric" });
  return `${day} ${time}`;
}
