/**
 * Xtream Codes helpers and URL utilities (port of the Xtream section of
 * `src-tauri/src/iptv.rs`). Pure: no platform imports.
 */
import type { XtreamAccount } from "../../lib/types";
import { percentEncode } from "../addons.pure";
import { MAX_CHANNELS, cleanName, utf8Lossy, type IptvChannel } from "./m3u";

type Json = unknown;

function isObject(v: Json): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > 4096) throw new Error("URL no válida");
  if (/[\p{Cc}\s]/u.test(trimmed)) throw new Error("URL no válida");
  const url = trimmed.includes("://") ? trimmed : `http://${trimmed}`;
  if (!url.startsWith("http://") && !url.startsWith("https://")) throw new Error("Solo se permiten URLs http o https");
  return url;
}

export function percentDecode(s: string): string {
  const bytes: number[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "%" && i + 2 < s.length) {
      const hex = s.slice(i + 1, i + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 3;
        continue;
      }
      bytes.push(0x25);
      i += 1;
    } else if (c === "+") {
      bytes.push(0x20);
      i += 1;
    } else {
      const cp = s.codePointAt(i) ?? 0;
      const ch = String.fromCodePoint(cp);
      for (const b of utf8(ch)) bytes.push(b);
      i += ch.length;
    }
  }
  return utf8Lossy(bytes);
}

function utf8(ch: string): number[] {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x80) return [cp];
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)];
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
}

export type ParsedXtreamUrl = { base: string; username: string | null; password: string | null };

/**
 * Accepts `http://host:port`, `host:port` or a full `get.php?username=…&password=…`
 * playlist link and returns the server base plus the credentials it carried.
 */
export function parseXtreamUrl(raw: string): ParsedXtreamUrl {
  const url = normalizeHttpUrl(raw);
  const sep = url.indexOf("://");
  if (sep < 0) throw new Error("URL no válida");
  const scheme = url.slice(0, sep);
  const rest = url.slice(sep + 3);
  const slash = rest.indexOf("/");
  const authority = slash >= 0 ? rest.slice(0, slash) : rest;
  const tail = slash >= 0 ? rest.slice(slash) : "";
  if (authority === "") throw new Error("Falta el servidor");
  const base = `${scheme}://${authority}`;
  const q = tail.indexOf("?");
  const query = q >= 0 ? tail.slice(q + 1) : "";
  let username: string | null = null;
  let password: string | null = null;
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const k = pair.slice(0, eq);
    const v = pair.slice(eq + 1);
    if (k === "username") username = percentDecode(v);
    else if (k === "password") password = percentDecode(v);
  }
  return { base, username: username || null, password: password || null };
}

export function hostOf(url: string): string | null {
  const rest = url.split("://")[1];
  if (rest === undefined) return null;
  const hostPart = rest.split(/[/?#]/)[0] ?? "";
  const afterAt = hostPart.split("@").pop() ?? "";
  const host = afterAt.split(":")[0] ?? "";
  return host === "" ? null : host;
}

export function xtreamApiUrl(base: string, username: string, password: string, action: string | null): string {
  let url = `${base}/player_api.php?username=${percentEncode(username)}&password=${percentEncode(password)}`;
  if (action) url += `&action=${action}`;
  return url;
}

export function xtreamXmltvUrl(base: string, username: string, password: string): string {
  return `${base}/xmltv.php?username=${percentEncode(username)}&password=${percentEncode(password)}`;
}

/** `{base}/live/{u}/{p}/{id}.{output}` or `{base}/movie/{u}/{p}/{id}.{container|mp4}`. */
export function xtreamStreamUrl(
  base: string,
  username: string,
  password: string,
  output: string,
  channel: Pick<IptvChannel, "kind" | "streamId" | "container">,
): string {
  const movie = channel.kind === "movie";
  const folder = movie ? "movie" : "live";
  const ext = movie ? (channel.container === "" ? "mp4" : channel.container) : output;
  return `${base}/${folder}/${percentEncode(username)}/${percentEncode(password)}/${channel.streamId}.${ext}`;
}

/** `json_text`: trimmed non-empty string, or the text of a number / bool. */
export function jsonText(v: Json, key: string): string | null {
  if (!isObject(v)) return null;
  const raw = v[key];
  if (typeof raw === "string") {
    const s = raw.trim();
    return s === "" ? null : s;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "boolean") return raw ? "true" : "false";
  return null;
}

/** `json_u64`: non-negative integer out of a number or a numeric string. */
export function jsonU64(v: Json, key: string): number | null {
  if (!isObject(v)) return null;
  const raw = v[key];
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return Math.max(0, Math.trunc(raw));
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (/^\+?[0-9]+$/.test(s)) {
      const n = Number(s);
      return Number.isSafeInteger(n) ? n : null;
    }
    if (s === "" || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
    const f = Number(s);
    return Number.isFinite(f) ? Math.max(0, Math.trunc(f)) : null;
  }
  return null;
}

export function parseAccount(value: Json): XtreamAccount {
  const info = isObject(value) && isObject(value.user_info) ? value.user_info : null;
  if (!info) throw new Error("El servidor no respondió como Xtream Codes");
  const rawAuth = info.auth;
  let auth = false;
  if (typeof rawAuth === "number") auth = rawAuth === 1;
  else if (typeof rawAuth === "string") auth = rawAuth === "1" || rawAuth.toLowerCase() === "true";
  else if (typeof rawAuth === "boolean") auth = rawAuth;
  const status = jsonText(info, "status") ?? "";
  if (!auth) {
    switch (status.toLowerCase()) {
      case "expired":
        throw new Error("La cuenta ha caducado");
      case "banned":
        throw new Error("La cuenta está bloqueada");
      case "disabled":
        throw new Error("La cuenta está desactivada");
      default:
        throw new Error("Usuario o contraseña incorrectos");
    }
  }
  const exp = jsonU64(info, "exp_date");
  const trial = jsonText(info, "is_trial");
  return {
    status: status === "" ? "Active" : status,
    expiresMs: exp != null && exp > 0 ? exp * 1000 : null,
    maxConnections: jsonU64(info, "max_connections"),
    activeConnections: jsonU64(info, "active_cons"),
    trial: trial !== null && (trial === "1" || trial.toLowerCase() === "true"),
  };
}

export function xtreamChannels(sourceId: string, categories: Json, streams: Json, kind: string): IptvChannel[] {
  const names = new Map<string, string>();
  if (Array.isArray(categories)) {
    for (const c of categories) {
      const id = jsonText(c, "category_id");
      const name = jsonText(c, "category_name");
      if (id !== null && name !== null) names.set(id, name);
    }
  }
  const prefix = kind === "movie" ? "v" : "s";
  const out: IptvChannel[] = [];
  if (!Array.isArray(streams)) return out;
  for (const s of streams) {
    const streamId = jsonText(s, "stream_id");
    const name = jsonText(s, "name");
    if (streamId === null || name === null) continue;
    const categoryId = jsonText(s, "category_id");
    const group = (categoryId !== null ? names.get(categoryId) : undefined) ?? "";
    const icon = jsonText(s, "stream_icon");
    out.push({
      id: `${sourceId}:${prefix}${streamId}`,
      sourceId,
      name: cleanName(name),
      logo: icon !== null && icon.startsWith("http") ? icon : null,
      group,
      kind,
      number: jsonU64(s, "num"),
      tvgId: jsonText(s, "epg_channel_id") ?? "",
      url: "",
      streamId,
      container: jsonText(s, "container_extension") ?? "",
      userAgent: null,
      referrer: null,
    });
    if (out.length >= MAX_CHANNELS) break;
  }
  return out;
}
