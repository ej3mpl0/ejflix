import type { Channel, EpgNow, Movie, Programme } from "./types";
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

type AgoUnit = "minute" | "hour" | "day";

/**
 * Hermes on Android ships a partial Intl without `RelativeTimeFormat`, so this
 * resolves to `null` there and `formatAgo` writes the label by hand.
 */
function relativeFormatter(locale: string): Intl.RelativeTimeFormat | null {
  try {
    const ctor = (Intl as { RelativeTimeFormat?: typeof Intl.RelativeTimeFormat }).RelativeTimeFormat;
    if (typeof ctor !== "function") return null;
    return new ctor(locale === "en" ? "en" : "es", { numeric: "auto" });
  } catch {
    return null;
  }
}

function agoFallback(value: number, unit: AgoUnit, locale: string): string {
  const short: Record<AgoUnit, string> = { minute: "min", hour: "h", day: "d" };
  if (value <= 0) return locale === "en" ? "just now" : "ahora mismo";
  return locale === "en" ? `${value} ${short[unit]} ago` : `hace ${value} ${short[unit]}`;
}

/** "hace 5 min" / "5 min ago" style label for the playlist refresh time. */
export function formatAgo(updatedMs: number, locale: string): string {
  if (!updatedMs) return "";
  const minutes = Math.max(0, Math.round((Date.now() - updatedMs) / 60_000));
  const hours = Math.round(minutes / 60);
  let value = minutes;
  let unit: AgoUnit = "minute";
  if (minutes >= 60) {
    if (hours < 48) {
      value = hours;
      unit = "hour";
    } else {
      value = Math.round(hours / 24);
      unit = "day";
    }
  }
  const rtf = relativeFormatter(locale);
  return rtf ? rtf.format(-value, unit) : agoFallback(value, unit, locale);
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
