/**
 * Subtitle files the app draws itself (expo-video cannot load an external file nor style
 * or delay its own tracks): SRT and WebVTT parsing, decoding and cue lookup. Pure module.
 */

export type Cue = { start: number; end: number; text: string };

/** Windows-1252 code points for 0x80–0x9F (the rest of the byte range equals Latin-1). */
const CP1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

/** True when the bytes are valid UTF-8 (a BOM-less check good enough for subtitle files). */
function isUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    const extra = b < 0x80 ? 0 : (b & 0xe0) === 0xc0 ? 1 : (b & 0xf0) === 0xe0 ? 2 : (b & 0xf8) === 0xf0 ? 3 : -1;
    if (extra < 0) return false;
    for (let k = 1; k <= extra; k += 1) {
      if (i + k >= bytes.length || (bytes[i + k] & 0xc0) !== 0x80) return false;
    }
    i += extra + 1;
  }
  return true;
}

function decodeUtf8(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let code: number;
    if (b < 0x80) {
      code = b;
      i += 1;
    } else if ((b & 0xe0) === 0xc0) {
      code = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if ((b & 0xf0) === 0xe0) {
      code = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else {
      code = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      i += 4;
    }
    out += String.fromCodePoint(code);
  }
  return out;
}

/** UTF-8 when it is valid, else Windows-1252 (common for Spanish SRT releases). */
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const body = start ? bytes.subarray(start) : bytes;
  if (isUtf8(body)) return decodeUtf8(body);
  let out = "";
  for (const b of body) out += String.fromCharCode(CP1252[b] ?? b);
  return out;
}

/** "01:02:03,450" / "02:03.450" → seconds; null when it is not a timestamp. */
function timestamp(value: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/.exec(value.trim());
  if (!match) return null;
  const [, h, m, s, ms] = match;
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
}

/** Tags (<i>, <font …>, {\an8}) removed; line breaks kept. */
function cleanText(value: string): string {
  return value
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** Cues of an SRT or WebVTT file, sorted by start time. */
export function parseSubtitles(content: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = content.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.length > 0);
    const at = lines.findIndex((line) => line.includes("-->"));
    if (at < 0) continue;
    const [left, rightRaw] = lines[at].split("-->");
    const right = (rightRaw ?? "").trim().split(/\s+/)[0] ?? "";
    const start = timestamp(left);
    const end = timestamp(right);
    if (start == null || end == null || end <= start) continue;
    const text = cleanText(lines.slice(at + 1).join("\n"));
    if (text) cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** Text on screen at `seconds` (several overlapping cues are stacked), or "". */
export function cueTextAt(cues: Cue[], seconds: number): string {
  // Binary search for the last cue that started at or before `seconds`.
  let lo = 0;
  let hi = cues.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= seconds) {
      last = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const out: string[] = [];
  // Cues rarely overlap by more than a few; look back a little for long ones.
  for (let i = last; i >= 0 && i >= last - 8; i -= 1) {
    if (cues[i].end > seconds) out.unshift(cues[i].text);
  }
  return out.join("\n");
}
