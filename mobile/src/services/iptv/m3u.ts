/**
 * Extended M3U parser (port of `parse_m3u` / `parse_extinf` in `src-tauri/src/iptv.rs`).
 * Pure: no platform imports.
 */
import { m3uCatchup, type CatchupInfo } from "./catchup";

export const MAX_CHANNELS = 60_000;

/** Channel as kept in the catalog (the view in `lib/types` drops the URLs). */
export type IptvChannel = {
  /** `<sourceId>:<stable key>` (the key survives playlist refreshes). */
  id: string;
  sourceId: string;
  name: string;
  logo: string | null;
  group: string;
  /** "live" | "movie" */
  kind: string;
  number: number | null;
  tvgId: string;
  /** Direct URL (M3U entries). Xtream streams are built from `streamId` when played. */
  url: string;
  streamId: string;
  /** Xtream VOD container ("mp4", "mkv"); empty for live streams. */
  container: string;
  userAgent: string | null;
  referrer: string | null;
} & Partial<CatchupInfo>;

export type ParsedPlaylist = {
  channels: IptvChannel[];
  /** Guide named in the `#EXTM3U` header (`url-tvg` / `x-tvg-url`). */
  epgUrl: string | null;
};

const U32_MAX = 4_294_967_295;

/** `String::from_utf8_lossy`: invalid sequences become U+FFFD. */
export function utf8Lossy(bytes: ArrayLike<number>): string {
  const parts: string[] = [];
  let run = "";
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i];
    if (b < 0x80) {
      run += String.fromCharCode(b);
      i++;
      if (run.length >= 4096) {
        parts.push(run);
        run = "";
      }
      continue;
    }
    let need: number;
    let cp: number;
    let min: number;
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
      cp = b & 0x1f;
      min = 0x80;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      cp = b & 0x0f;
      min = 0x800;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      cp = b & 0x07;
      min = 0x10000;
    } else {
      run += "�";
      i++;
      continue;
    }
    let ok = i + need < n;
    if (ok) {
      for (let k = 1; k <= need; k++) {
        const c = bytes[i + k];
        if ((c & 0xc0) !== 0x80) {
          ok = false;
          break;
        }
        cp = (cp << 6) | (c & 0x3f);
      }
    }
    if (!ok || cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      run += "�";
      i++;
      continue;
    }
    run += String.fromCodePoint(cp);
    i += need + 1;
  }
  parts.push(run);
  return parts.join("");
}

/** Decodes a complete UTF-8 buffer (native `TextDecoder` when the runtime has one). */
export function decodeUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") {
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      /* fall through */
    }
  }
  return utf8Lossy(bytes);
}

/**
 * Streaming UTF-8 decoder: a multi-byte sequence split across chunks is held back
 * until its continuation bytes arrive, so every `push` returns complete characters.
 */
export class Utf8Stream {
  private carry: Uint8Array | null = null;

  constructor(private readonly manual = false) {}

  private decode(bytes: Uint8Array): string {
    return this.manual ? utf8Lossy(bytes) : decodeUtf8(bytes);
  }

  push(chunk: Uint8Array): string {
    let data = chunk;
    if (this.carry && this.carry.length) {
      data = new Uint8Array(this.carry.length + chunk.length);
      data.set(this.carry, 0);
      data.set(chunk, this.carry.length);
    }
    this.carry = null;
    let cut = data.length;
    for (let k = 1; k <= 3 && k <= data.length; k++) {
      const b = data[data.length - k];
      if ((b & 0xc0) === 0x80) continue; // continuation byte: keep looking for the lead
      const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
      if (need > k) cut = data.length - k;
      break;
    }
    if (cut < data.length) this.carry = data.slice(cut);
    return cut === 0 ? "" : this.decode(cut === data.length ? data : data.subarray(0, cut));
  }

  /** Flushes an incomplete trailing sequence (as U+FFFD). */
  finish(): string {
    const rest = this.carry;
    this.carry = null;
    return rest && rest.length ? this.decode(rest) : "";
  }
}

/** Rust `str::parse::<u32>()`: optional `+`, digits only. */
export function parseU32(raw: string): number | null {
  if (!/^\+?[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n <= U32_MAX ? n : null;
}

function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** Collapses whitespace and keeps at most 120 characters. */
export function cleanName(name: string): string {
  const joined = name.split(/\s+/u).filter((w) => w !== "").join(" ");
  return Array.from(joined).slice(0, 120).join("");
}

/** Lowercase letters and digits only: "La 1 HD" → "la1hd". */
export function normalize(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

function sanitizeKey(text: string): string {
  return Array.from(text)
    .filter((c) => !/[\p{Cc}\s]/u.test(c))
    .slice(0, 80)
    .join("");
}

/** `-1 tvg-id="x" group-title="News, US",Channel` → attributes (lowercase keys) and title. */
export function parseExtinf(rest: string): { attrs: Map<string, string>; title: string } {
  const len = rest.length;
  let i = 0;
  const isSpace = (c: string) => c === " " || c === "\t";
  // Duration (or nothing when parsing the #EXTM3U header).
  while (i < len && !isSpace(rest[i]) && rest[i] !== ",") i++;
  const attrs = new Map<string, string>();
  let title = "";
  for (;;) {
    while (i < len && isSpace(rest[i])) i++;
    if (i >= len) {
      title = "";
      break;
    }
    if (rest[i] === ",") {
      title = rest.slice(i + 1).trim();
      break;
    }
    const keyStart = i;
    while (i < len && rest[i] !== "=" && rest[i] !== ",") i++;
    if (i >= len || rest[i] === ",") {
      // Bare text before the comma: treat everything from here as the title.
      title = rest.slice(keyStart).replace(/^,+/, "").trim();
      break;
    }
    const key = asciiLower(rest.slice(keyStart, i).trim());
    i++;
    let value: string;
    if (i < len && rest[i] === '"') {
      i++;
      const start = i;
      while (i < len && rest[i] !== '"') i++;
      value = rest.slice(start, i);
      if (i < len) i++;
    } else {
      const start = i;
      while (i < len && !isSpace(rest[i]) && rest[i] !== ",") i++;
      value = rest.slice(start, i);
    }
    if (key !== "") attrs.set(key, value);
  }
  return { attrs, title };
}

/**
 * Parses an extended M3U playlist. Tolerant: attributes may be unquoted, `#EXTGRP`,
 * `#EXTVLCOPT` and comment lines are understood, anything else is skipped.
 */
export function parseM3u(text: string, sourceId: string): ParsedPlaylist {
  const channels: IptvChannel[] = [];
  let epgUrl: string | null = null;
  let pending: { attrs: Map<string, string>; title: string } | null = null;
  let groupLine: string | null = null;
  let userAgent: string | null = null;
  let referrer: string | null = null;
  const used = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("#EXTM3U")) {
      const { attrs } = parseExtinf(line.slice("#EXTM3U".length));
      const value = attrs.get("url-tvg") ?? attrs.get("x-tvg-url");
      const first = value?.split(",")[0]?.trim() ?? "";
      epgUrl = first.startsWith("http") ? first : null;
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      pending = parseExtinf(line.slice("#EXTINF:".length));
      groupLine = null;
      userAgent = null;
      referrer = null;
      continue;
    }
    if (line.startsWith("#EXTGRP:")) {
      groupLine = line.slice("#EXTGRP:".length).trim();
      continue;
    }
    if (line.startsWith("#EXTVLCOPT:")) {
      const rest = line.slice("#EXTVLCOPT:".length);
      const eq = rest.indexOf("=");
      if (eq >= 0) {
        const key = asciiLower(rest.slice(0, eq).trim());
        const value = rest.slice(eq + 1).trim();
        if (key === "http-user-agent") userAgent = value === "" ? null : value;
        else if (key === "http-referrer") referrer = value === "" ? null : value;
      }
      continue;
    }
    if (line.startsWith("#")) continue;
    // A URL line closes the pending entry.
    const entry = pending;
    pending = null;
    if (!entry) continue;
    if (!(line.startsWith("http://") || line.startsWith("https://"))) continue;
    const { attrs, title } = entry;
    const name = cleanName(title === "" ? (attrs.get("tvg-name") ?? "") : title);
    if (name === "") continue;
    const tvgId = (attrs.get("tvg-id") ?? "").trim();
    // Some lists (iptv-org) put several categories in group-title separated by ";".
    const groupTitle = attrs.get("group-title");
    const groupSource = groupTitle !== undefined && groupTitle.trim() !== "" ? groupTitle : (groupLine ?? "");
    const group = (groupSource.split(";")[0] ?? "").trim();
    const lower = asciiLower(line);
    const kind = lower.includes("/movie/") || lower.includes("/series/") ? "movie" : "live";
    const baseKey = tvgId !== "" ? `i:${sanitizeKey(tvgId)}` : `n:${sanitizeKey(normalize(name))}`;
    let key = baseKey;
    let n = 1;
    while (used.has(key)) {
      n += 1;
      key = `${baseKey}~${n}`;
    }
    used.add(key);
    const logoRaw = attrs.get("tvg-logo")?.trim();
    const chno = attrs.get("tvg-chno");
    channels.push({
      id: `${sourceId}:${key}`,
      sourceId,
      name,
      logo: logoRaw !== undefined && logoRaw.startsWith("http") ? logoRaw : null,
      group,
      kind,
      number: chno !== undefined ? parseU32(chno.trim()) : null,
      tvgId,
      url: line,
      streamId: "",
      container: "",
      userAgent,
      referrer,
      ...m3uCatchup(attrs),
    });
    userAgent = null;
    referrer = null;
    if (channels.length >= MAX_CHANNELS) break;
  }
  return { channels, epgUrl };
}
