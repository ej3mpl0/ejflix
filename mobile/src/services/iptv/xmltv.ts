/**
 * XMLTV guide scanner (port of `parse_xmltv` / `attach_guide` in `src-tauri/src/iptv.rs`),
 * rewritten as a streaming scanner: text is pushed in chunks, complete `<channel>` and
 * `<programme>` elements are consumed and the remainder is carried over. Pure.
 */
import type { Programme } from "../../lib/types";
import { normalize } from "./m3u";

/** Programmes kept around "now": six hours back, two days ahead (mobile window). */
export const EPG_PAST = 6 * 3600;
export const EPG_FUTURE = 2 * 86_400;
export const MAX_DESC = 240;

const CHANNEL_CLOSE = "</channel>";
const PROGRAMME_CLOSE = "</programme>";
/** Longest opening token minus one: a chunk may end in the middle of `<programme`. */
const TAIL_KEEP = "<programme".length - 1;

export type ProgrammeRow = Programme & { xmltvId: string };

/** Value of an attribute inside an opening tag (raw, entities not decoded). */
export function attr(tag: string, name: string): string | null {
  let search = 0;
  for (;;) {
    const at = tag.indexOf(name, search);
    if (at < 0) return null;
    const beforeOk = at > 0 && /[ \t\n\r\f]/.test(tag[at - 1]);
    const after = tag.slice(at + name.length).trimStart();
    if (beforeOk && after.startsWith("=")) {
      const rest = after.slice(1).trimStart();
      const quote = rest[0];
      if (quote === undefined) return null;
      if (quote === '"' || quote === "'") {
        const inner = rest.slice(1);
        const end = inner.indexOf(quote);
        return end >= 0 ? inner.slice(0, end) : null;
      }
    }
    search = at + name.length;
  }
}

export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  let out = "";
  let rest = text;
  for (;;) {
    const i = rest.indexOf("&");
    if (i < 0) break;
    out += rest.slice(0, i);
    rest = rest.slice(i);
    const end = rest.indexOf(";");
    if (end < 0 || end > 10) {
      out += "&";
      rest = rest.slice(1);
      continue;
    }
    const entity = rest.slice(1, end);
    let decoded: string | null = null;
    switch (entity) {
      case "amp":
        decoded = "&";
        break;
      case "lt":
        decoded = "<";
        break;
      case "gt":
        decoded = ">";
        break;
      case "quot":
        decoded = '"';
        break;
      case "apos":
        decoded = "'";
        break;
      case "nbsp":
        decoded = " ";
        break;
      default:
        if (entity.startsWith("#")) {
          const num = entity.slice(1);
          let code: number | null = null;
          if (num.startsWith("x") || num.startsWith("X")) {
            const hex = num.slice(1);
            if (/^[0-9a-fA-F]+$/.test(hex)) code = parseInt(hex, 16);
          } else if (/^[0-9]+$/.test(num)) {
            code = Number(num);
          }
          if (code !== null && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) {
            decoded = String.fromCodePoint(code);
          }
        }
    }
    if (decoded !== null) {
      out += decoded;
      rest = rest.slice(end + 1);
    } else {
      out += "&";
      rest = rest.slice(1);
    }
  }
  return out + rest;
}

function collapse(text: string): string {
  return text.split(/\s+/u).filter((w) => w !== "").join(" ");
}

/** Text of the first `<tag …>…</tag>` element inside `body`, entities decoded. */
export function firstText(body: string, tag: string): string | null {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let search = 0;
  for (;;) {
    const at = body.indexOf(open, search);
    if (at < 0) return null;
    const after = body[at + open.length];
    if (!(after === ">" || after === " " || after === "\t" || after === "\n" || after === "\r")) {
      search = at + open.length;
      continue;
    }
    const gt = body.indexOf(">", at);
    if (gt < 0) return null;
    const start = gt + 1;
    const end = body.indexOf(close, start);
    if (end < 0) return null;
    const text = collapse(decodeEntities(body.slice(start, end).trim()));
    return text === "" ? null : text;
  }
}

export function allTexts(body: string, tag: string): string[] {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const out: string[] = [];
  let search = 0;
  for (;;) {
    const at = body.indexOf(open, search);
    if (at < 0) break;
    const gt = body.indexOf(">", at);
    if (gt < 0) break;
    const start = gt + 1;
    const end = body.indexOf(close, start);
    if (end < 0) break;
    const text = decodeEntities(body.slice(start, end).trim());
    if (text !== "") out.push(text);
    search = end + close.length;
  }
  return out;
}

/** Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm). */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.trunc((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.trunc((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.trunc(yoe / 4) - Math.trunc(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

/** `20240101203000 +0100` → unix seconds (also accepts shorter stamps and no zone). */
export function parseXmltvTime(rawInput: string): number | null {
  const raw = rawInput.trim();
  const sp = raw.indexOf(" ");
  const digits = sp >= 0 ? raw.slice(0, sp) : raw;
  const zone = sp >= 0 ? raw.slice(sp + 1).trim() : null;
  if (digits.length < 8 || !/^[0-9]+$/.test(digits)) return null;
  const num = (from: number, to: number) => (to <= digits.length ? Number(digits.slice(from, to)) : 0);
  const year = num(0, 4);
  const month = num(4, 6);
  const day = num(6, 8);
  const hour = num(8, 10);
  const minute = num(10, 12);
  const second = num(12, 14);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return null;
  let ts = daysFromCivil(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second;
  if (zone !== null && zone.length >= 5) {
    const sign = zone.startsWith("-") ? -1 : 1;
    const body = zone.slice(1);
    if (body.length >= 4 && /^[0-9]+$/.test(body)) {
      const zh = Number(body.slice(0, 2));
      const zm = Number(body.slice(2, 4));
      ts -= sign * (zh * 3600 + zm * 60);
    }
  }
  return ts >= 0 ? ts : null;
}

export type WantedChannels = { ids: Set<string>; names: Set<string> };

/** Lowercased tvg-ids and normalized names of the playlist channels. */
export function wantedFromChannels(channels: { id?: string; name: string; tvgId: string }[]): WantedChannels {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const c of channels) {
    if (c.tvgId !== "") ids.add(c.tvgId.toLowerCase());
    names.add(normalize(c.name));
  }
  return { ids, names };
}

/**
 * Consumes an XMLTV document chunk by chunk. `<channel>` elements register the ids
 * wanted by display name; `<programme>` elements of wanted channels inside the time
 * window become rows to `drain()`. Channels must precede programmes (as the DTD orders them).
 */
export class XmltvScanner {
  private buf = "";
  private readonly keep: Set<string>;
  /** Normalised display name → XMLTV channel id. */
  readonly names = new Map<string, string>();
  /** XMLTV ids (as written in the file) that produced at least one row. */
  readonly idsWithProgrammes = new Set<string>();
  private rows: ProgrammeRow[] = [];
  private readonly windowStart: number;
  private readonly windowEnd: number;
  /** Rows produced so far. */
  count = 0;

  constructor(
    wantedIds: Iterable<string>,
    private readonly wantedNames: Set<string>,
    now: number,
  ) {
    this.keep = new Set(wantedIds);
    this.windowStart = Math.max(0, now - EPG_PAST);
    this.windowEnd = now + EPG_FUTURE;
  }

  push(chunk: string): void {
    if (chunk === "") return;
    const buf = this.buf + chunk;
    let pos = 0;
    for (;;) {
      const c = buf.indexOf("<channel", pos);
      const p = buf.indexOf("<programme", pos);
      if (c < 0 && p < 0) {
        this.buf = buf.slice(Math.max(pos, buf.length - TAIL_KEEP));
        return;
      }
      const isChannel = c >= 0 && (p < 0 || c < p);
      const start = isChannel ? c : p;
      const gt = buf.indexOf(">", start);
      if (gt < 0) {
        this.buf = buf.slice(start);
        return;
      }
      const tagEnd = gt + 1;
      const tag = buf.slice(start, tagEnd);
      if (isChannel) {
        if (!(tag.startsWith("<channel ") || tag.startsWith("<channel\t") || tag.startsWith("<channel\n"))) {
          pos = tagEnd;
          continue;
        }
        const selfClosing = tag.endsWith("/>");
        let end = tagEnd;
        if (!selfClosing) {
          end = buf.indexOf(CHANNEL_CLOSE, tagEnd);
          if (end < 0) {
            this.buf = buf.slice(start);
            return;
          }
        }
        this.channel(tag, buf.slice(tagEnd, end));
        pos = selfClosing ? end : end + CHANNEL_CLOSE.length;
      } else {
        const end = buf.indexOf(PROGRAMME_CLOSE, tagEnd);
        if (end < 0) {
          this.buf = buf.slice(start);
          return;
        }
        this.programme(tag, buf.slice(tagEnd, end));
        pos = end + PROGRAMME_CLOSE.length;
      }
    }
  }

  private channel(tag: string, body: string): void {
    const id = attr(tag, "id");
    if (id === null) return;
    for (const name of allTexts(body, "display-name")) {
      const key = normalize(name);
      if (this.wantedNames.has(key)) {
        this.keep.add(id.toLowerCase());
        if (!this.names.has(key)) this.names.set(key, id);
      }
    }
  }

  private programme(tag: string, body: string): void {
    const channel = attr(tag, "channel");
    if (channel === null || !this.keep.has(channel.toLowerCase())) return;
    const startRaw = attr(tag, "start");
    const stopRaw = attr(tag, "stop");
    const start = startRaw === null ? null : parseXmltvTime(startRaw);
    const stop = stopRaw === null ? null : parseXmltvTime(stopRaw);
    if (start === null || stop === null) return;
    if (stop <= start || stop < this.windowStart || start > this.windowEnd) return;
    const title = firstText(body, "title");
    if (title === null) return;
    const desc = firstText(body, "desc");
    this.rows.push({
      xmltvId: channel,
      start,
      stop,
      title,
      desc: desc === null ? null : Array.from(desc).slice(0, MAX_DESC).join(""),
      category: firstText(body, "category"),
    });
    this.idsWithProgrammes.add(channel);
    this.count += 1;
  }

  /** Rows produced since the previous drain. */
  drain(): ProgrammeRow[] {
    const out = this.rows;
    this.rows = [];
    return out;
  }

  /** Drops the carry-over (an incomplete trailing element is ignored, like the desktop). */
  finish(): void {
    this.buf = "";
  }
}

/**
 * Links playlist channels to guide ids: by `tvg-id` first (case-insensitive), then by
 * display name; only ids that produced programmes count.
 */
export function linkGuide(
  channels: { id: string; name: string; tvgId: string }[],
  names: Map<string, string>,
  idsWithProgrammes: Set<string>,
): Map<string, string> {
  const lowerIds = new Map<string, string>();
  for (const id of idsWithProgrammes) {
    const lower = id.toLowerCase();
    if (!lowerIds.has(lower)) lowerIds.set(lower, id);
  }
  const out = new Map<string, string>();
  for (const channel of channels) {
    let id = channel.tvgId !== "" ? lowerIds.get(channel.tvgId.toLowerCase()) : undefined;
    if (id === undefined) {
      const byName = names.get(normalize(channel.name));
      if (byName !== undefined && idsWithProgrammes.has(byName)) id = byName;
    }
    if (id !== undefined) out.set(channel.id, id);
  }
  return out;
}

/** In-memory grouping with the desktop ordering rules (sorted by start, `(start, title)` deduped). */
export function groupRows(rows: ProgrammeRow[]): Map<string, Programme[]> {
  const out = new Map<string, Programme[]>();
  for (const row of rows) {
    let list = out.get(row.xmltvId);
    if (!list) {
      list = [];
      out.set(row.xmltvId, list);
    }
    list.push({ start: row.start, stop: row.stop, title: row.title, desc: row.desc, category: row.category });
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.start - b.start);
    let w = 0;
    for (let r = 0; r < list.length; r++) {
      if (r > 0 && list[r].start === list[w - 1].start && list[r].title === list[w - 1].title) continue;
      list[w++] = list[r];
    }
    list.length = w;
  }
  return out;
}

/** `attach_guide` over a whole document at once (tests and small guides). */
export function attachGuideText(
  channels: { id: string; name: string; tvgId: string }[],
  xml: string,
  now: number,
): { channelEpg: Map<string, string>; epg: Map<string, Programme[]> } {
  const wanted = wantedFromChannels(channels);
  const scanner = new XmltvScanner(wanted.ids, wanted.names, now);
  scanner.push(xml);
  scanner.finish();
  const rows = scanner.drain();
  const channelEpg = linkGuide(channels, scanner.names, scanner.idsWithProgrammes);
  const used = new Set(channelEpg.values());
  const epg = groupRows(rows.filter((r) => used.has(r.xmltvId)));
  return { channelEpg, epg };
}

/** Desktop `epg_now` over an in-memory list (sorted by start). */
export function epgNowOf(list: Programme[], now: number): { now: Programme | null; next: Programme | null } {
  let position = 0;
  while (position < list.length && list[position].stop <= now) position++;
  const current = position < list.length && list[position].start <= now ? list[position] : null;
  const next = current ? (list[position + 1] ?? null) : (list[position] ?? null);
  return { now: current, next };
}
