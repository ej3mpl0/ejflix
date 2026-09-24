/**
 * Catch-up (archive) URLs and programme reminders: port of the catch-up and reminder
 * sections of `src-tauri/src/iptv.rs`. Pure: no platform imports.
 */
import type { Reminder } from "../../lib/types";
import { percentEncode } from "../addons.pure";
import { LocalizedError } from "../errors";

/** Catch-up fields of a catalog channel (absent when the channel has no archive). */
export type CatchupInfo = {
  /** "xtream" (timeshift URLs), or the M3U `catchup` mode: "default" | "append" | "shift". */
  catchup: string;
  /** M3U `catchup-source` template. */
  catchupSource: string;
  /** Days of archive the server keeps. */
  catchupDays: number;
};

/** What `catchupUrl` needs of a channel. */
export type CatchupChannel = Partial<CatchupInfo> & { kind: string; url: string; streamId: string };

/** Days of archive a channel offers (0 when it has none or is not a live channel). */
export function catchupWindow(channel: Pick<CatchupChannel, "kind" | "catchup" | "catchupDays">): number {
  return channel.kind === "live" && channel.catchup ? (channel.catchupDays ?? 0) : 0;
}

/**
 * `catchup` / `catchup-source` / `catchup-days` of an `#EXTINF` line. Only the modes that
 * need nothing but a URL template are understood; null otherwise.
 */
export function m3uCatchup(attrs: Map<string, string>): CatchupInfo | null {
  const source = attrs.get("catchup-source")?.trim() ?? "";
  const raw = (attrs.get("catchup") ?? attrs.get("catchup-type") ?? "").trim().toLowerCase();
  let mode: string;
  if (raw === "" && source !== "") mode = "default";
  else if ((raw === "default" || raw === "append") && source !== "") mode = raw;
  else if (raw === "shift") mode = "shift";
  else return null;
  let days = 1;
  for (const key of ["catchup-days", "timeshift", "tvg-rec"]) {
    const value = attrs.get(key)?.trim();
    if (value && /^\d+$/.test(value) && Number(value) > 0) {
      days = Number(value);
      break;
    }
  }
  return { catchup: mode, catchupSource: source, catchupDays: Math.min(30, days) };
}

/** Xtream `tv_archive` = 1 plus the days kept in `tv_archive_duration`. */
export function xtreamCatchup(tvArchive: number | null, duration: number | null, kind: string): CatchupInfo | null {
  if (kind !== "live" || tvArchive !== 1) return null;
  return { catchup: "xtream", catchupSource: "", catchupDays: Math.min(30, Math.max(1, duration ?? 1)) };
}

/** `2024-03-10 21:30:04` read as if it were UTC (unix seconds), or null. */
function naiveSeconds(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * Xtream server clock minus UTC from `server_info` (`time_now` is local, `timestamp_now`
 * UTC), rounded to a quarter of an hour: timeshift URLs are written in server time.
 */
export function serverOffset(value: unknown): number {
  if (typeof value !== "object" || value === null) return 0;
  const info = (value as Record<string, unknown>).server_info;
  if (typeof info !== "object" || info === null) return 0;
  const record = info as Record<string, unknown>;
  const local = typeof record.time_now === "string" ? naiveSeconds(record.time_now) : null;
  const utc = Number(record.timestamp_now);
  if (local === null || !Number.isFinite(utc) || utc <= 0) return 0;
  const rounded = Math.round((local - utc) / 900) * 900;
  return Math.abs(rounded) > 14 * 3600 ? 0 : rounded;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Letters Y m d H M S of a format replaced with the parts of `ts` (UTC). */
export function formatStamp(format: string, ts: number): string {
  const d = new Date(ts * 1000);
  const parts: Record<string, string> = {
    Y: pad(d.getUTCFullYear(), 4),
    m: pad(d.getUTCMonth() + 1),
    d: pad(d.getUTCDate()),
    H: pad(d.getUTCHours()),
    M: pad(d.getUTCMinutes()),
    S: pad(d.getUTCSeconds()),
  };
  return [...format].map((c) => parts[c] ?? c).join("");
}

/**
 * Fills the placeholders of an M3U `catchup-source` (the Kodi IPTV Simple set:
 * `{utc}`, `${start}`, `{utcend}`, `${end}`, `{lutc}`, `${now}`, `{duration}`,
 * `{offset:N}`, `{Y}`…`{S}`, `{utc:Y-m-d}`…). Unknown ones are left alone.
 */
export function fillCatchup(template: string, start: number, stop: number, now: number): string {
  return template.replace(/(\$?)\{([^{}]*)\}/g, (whole, _dollar: string, token: string) => {
    const colon = token.indexOf(":");
    const name = colon >= 0 ? token.slice(0, colon) : token;
    const arg = colon >= 0 ? token.slice(colon + 1) : null;
    const stamp = (ts: number) => (arg !== null ? formatStamp(arg, ts) : String(ts));
    const divided = (secs: number) => {
      const by = arg !== null && /^\d+$/.test(arg) && Number(arg) > 0 ? Number(arg) : 1;
      return String(Math.floor(Math.max(0, secs) / by));
    };
    switch (name) {
      case "utc":
      case "start":
        return stamp(start);
      case "utcend":
      case "end":
        return stamp(stop);
      case "lutc":
      case "now":
      case "timestamp":
        return stamp(now);
      case "duration":
        return divided(stop - start);
      case "offset":
        return divided(now - start);
      case "Y":
      case "m":
      case "d":
      case "H":
      case "M":
      case "S":
        return formatStamp(name, start);
      default:
        return whole;
    }
  });
}

/**
 * URL of a past programme of a channel with catch-up. `output` is the extension of the
 * Xtream archive ("ts", or "m3u8" where only HLS plays); `offset` the server clock offset.
 */
export function catchupUrl(
  xtream: { base: string; username: string; password: string; output: string } | null,
  channel: CatchupChannel,
  start: number,
  stop: number,
  now: number,
  offset = 0,
): string {
  const days = catchupWindow(channel);
  if (days === 0) throw new LocalizedError("catchupErrNoArchive", "Este canal no permite ver programas anteriores");
  if (stop <= start || start >= now || start + days * 86_400 < now) {
    throw new LocalizedError("catchupErrUnavailable", "Este programa no está disponible en diferido");
  }
  let url: string;
  switch (channel.catchup) {
    case "xtream": {
      if (!xtream || channel.streamId === "" || xtream.password === "") throw new LocalizedError("iptvErrChannelUnavailable", "Canal no disponible");
      const minutes = Math.max(1, Math.ceil((stop - start) / 60));
      url = `${xtream.base}/timeshift/${percentEncode(xtream.username)}/${percentEncode(xtream.password)}/${minutes}/${formatStamp("Y-m-d:H-M", start + offset)}/${channel.streamId}.${xtream.output}`;
      break;
    }
    case "default":
      url = fillCatchup(channel.catchupSource ?? "", start, stop, now);
      break;
    case "append":
      url = channel.url + fillCatchup(channel.catchupSource ?? "", start, stop, now);
      break;
    case "shift":
      url = `${channel.url}${channel.url.includes("?") ? "&" : "?"}utc=${start}&lutc=${now}`;
      break;
    default:
      throw new LocalizedError("catchupErrNoArchive", "Este canal no permite ver programas anteriores");
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new LocalizedError("playErrHttpOnly", "Solo se pueden reproducir canales http o https");
  }
  return url;
}

// ---- reminders ----

/** How long before the start a reminder goes off. */
export const REMINDER_LEAD = 60;
/** A reminder whose programme started longer ago than this is dropped. */
export const REMINDER_GRACE = 300;
export const MAX_REMINDERS = 100;

/** Reminders still worth keeping, soonest first. */
export function pruneReminders(list: Reminder[], now: number): Reminder[] {
  return list.filter((r) => r.start + REMINDER_GRACE > now).sort((a, b) => a.start - b.start);
}

/** Adds (or replaces) the reminder of a programme that has not started yet. */
export function addReminder(list: Reminder[], reminder: Reminder, now: number): Reminder[] {
  if (reminder.start <= now) throw new LocalizedError("reminderErrStarted", "El programa ya ha empezado");
  const rest = pruneReminders(list, now).filter((r) => !(r.channelId === reminder.channelId && r.start === reminder.start));
  if (rest.length >= MAX_REMINDERS) throw new LocalizedError("reminderErrTooMany", "Hay demasiados recordatorios");
  return pruneReminders([...rest, { ...reminder, title: reminder.title.slice(0, 200), notified: false }], now);
}

export function dropReminder(list: Reminder[], channelId: string, start: number, now: number): Reminder[] {
  return pruneReminders(list, now).filter((r) => !(r.channelId === channelId && r.start === start));
}

/** Splits off the reminders that go off now; they come back marked as announced. */
export function dueReminders(list: Reminder[], now: number): { list: Reminder[]; due: Reminder[] } {
  const due: Reminder[] = [];
  const next = pruneReminders(list, now).map((r) => {
    if (r.notified || r.start > now + REMINDER_LEAD) return r;
    const marked = { ...r, notified: true };
    due.push(marked);
    return marked;
  });
  return { list: next, due };
}
