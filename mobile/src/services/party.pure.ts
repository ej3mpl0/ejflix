/**
 * Watch party, the pure half (port of `src-tauri/src/party.rs` and `src/lib/party.ts`):
 * party codes, the Phoenix messages Supabase Realtime speaks, the presence list and the
 * sync arithmetic a guest uses to follow the host. No I/O here, so it is all tested.
 */

// ---- codes ----

/** No 0/O nor 1/I/L: the code is read aloud and typed by hand. */
export const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LEN = 12;

/** What the person typed or pasted, as a code: case, spaces and dashes do not matter. */
export function normalizeCode(input: string): string | null {
  const code = input.replace(/[\s\-·.]/g, "").toUpperCase();
  if (code.length !== CODE_LEN) return null;
  return [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

/** `ABCD-EFGH-JKMN`. */
export function formatCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

export function topicOf(code: string): string {
  return `realtime:ejflix-party-${code.toLowerCase()}`;
}

// ---- Phoenix protocol (vsn 1.0.0: one JSON object per frame) ----

export type PhxMessage = {
  topic: string;
  event: string;
  payload: unknown;
  ref: string | null;
  join_ref: string | null;
};

type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

export function encodePhx(message: PhxMessage): string {
  return JSON.stringify(message);
}

export function decodePhx(text: string): PhxMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const o = obj(value);
  if (!o || typeof o.topic !== "string" || typeof o.event !== "string") return null;
  return {
    topic: o.topic,
    event: o.event,
    payload: o.payload ?? null,
    ref: typeof o.ref === "string" ? o.ref : null,
    join_ref: typeof o.join_ref === "string" ? o.join_ref : null,
  };
}

export function joinMessage(topic: string, member: string, ref: string, isPrivate = false, token: string | null = null): PhxMessage {
  const payload: Json = {
    config: {
      broadcast: { self: false, ack: false },
      presence: { key: member, enabled: true },
      postgres_changes: [],
      private: isPrivate,
    },
  };
  if (token) payload.access_token = token;
  return { topic, event: "phx_join", payload, ref, join_ref: ref };
}

export function broadcastMessage(topic: string, event: string, from: string, data: unknown, ref: string, joinRef: string): PhxMessage {
  return { topic, event: "broadcast", payload: { type: "broadcast", event, payload: { from, data } }, ref, join_ref: joinRef };
}

export function trackMessage(topic: string, meta: Json, ref: string, joinRef: string): PhxMessage {
  return { topic, event: "presence", payload: { type: "presence", event: "track", payload: meta }, ref, join_ref: joinRef };
}

export function heartbeatMessage(ref: string): PhxMessage {
  return { topic: "phoenix", event: "heartbeat", payload: {}, ref, join_ref: null };
}

export function leaveMessage(topic: string, ref: string, joinRef: string): PhxMessage {
  return { topic, event: "phx_leave", payload: {}, ref, join_ref: joinRef };
}

/** `ok` / the server's reason, for a `phx_reply`; null for anything else. */
export function replyOf(message: PhxMessage): { ok: true } | { ok: false; reason: string } | null {
  if (message.event !== "phx_reply") return null;
  const payload = obj(message.payload);
  const status = typeof payload?.status === "string" ? payload.status : "";
  if (status === "ok") return { ok: true };
  const response = obj(payload?.response);
  const reason =
    (typeof response?.reason === "string" && response.reason) ||
    (typeof response?.message === "string" && response.message) ||
    (response ? JSON.stringify(response) : status);
  return { ok: false, reason };
}

/** Event, sender and data of a received broadcast (null for anything malformed). */
export function broadcastOf(payload: unknown): { event: string; from: string; data: unknown } | null {
  const o = obj(payload);
  const body = obj(o?.payload);
  const event = o?.event;
  const from = body?.from;
  if (typeof event !== "string" || typeof from !== "string") return null;
  if (event.length > 32 || !from || from.length > 64) return null;
  return { event, from, data: body?.data ?? null };
}

export type JoinFailure = "try-private" | "needs-account" | "denied" | "other";

export function classifyJoinError(reason: string, isPrivate: boolean, signedIn: boolean): JoinFailure {
  const lower = reason.toLowerCase();
  const privateOnly = lower.includes("privateonly") || lower.includes("private channel") || lower.includes("only allows private");
  if (privateOnly && !isPrivate) return signedIn ? "try-private" : "needs-account";
  if (lower.includes("unauthorized") || lower.includes("permission") || lower.includes("forbidden")) {
    return isPrivate || signedIn ? "denied" : "needs-account";
  }
  return "other";
}

/** Reconnect delay: 1, 2, 4... up to 30 s, plus up to a second of jitter. */
export function backoffMs(attempt: number, jitter: number): number {
  const base = Math.min(30, 2 ** Math.min(5, Math.max(0, attempt - 1)));
  return base * 1000 + Math.round(Math.max(0, Math.min(1, jitter)) * 1000);
}

// ---- presence ----

export type PartyMember = { id: string; name: string; avatar: string | null; host: boolean };

/** Per presence key, the member and the `phx_ref` of each of its connections. */
export type Presence = Map<string, { member: PartyMember; refs: Set<string> }>;

function memberOf(key: string, meta: Json): PartyMember {
  const text = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string).trim() : "");
  const name = text("name").slice(0, 40);
  const avatar = text("avatar");
  return {
    id: key.slice(0, 64),
    name: name || "?",
    avatar: avatar.startsWith("preset:") && avatar.length <= 12 ? avatar : null,
    host: meta.host === true,
  };
}

function metasOf(entry: unknown): { ref: string; meta: Json }[] {
  const metas = obj(entry)?.metas;
  if (!Array.isArray(metas)) return [];
  return metas.flatMap((m) => {
    const meta = obj(m);
    return meta ? [{ ref: typeof meta.phx_ref === "string" ? meta.phx_ref : "", meta }] : [];
  });
}

function joinInto(presence: Presence, entries: unknown) {
  const o = obj(entries);
  if (!o) return;
  for (const [key, entry] of Object.entries(o)) {
    for (const { ref, meta } of metasOf(entry)) {
      const slot = presence.get(key) ?? { member: memberOf(key, meta), refs: new Set<string>() };
      // The newest connection speaks for the member.
      slot.member = memberOf(key, meta);
      slot.refs.add(ref);
      presence.set(key, slot);
    }
  }
}

/** `presence_state`: the whole list, right after a join. */
export function presenceSync(state: unknown): Presence {
  const presence: Presence = new Map();
  joinInto(presence, state);
  return presence;
}

/** `presence_diff`: who came and who went (a reconnecting member is briefly there twice). */
export function presenceDiff(presence: Presence, diff: unknown): Presence {
  const next: Presence = new Map([...presence].map(([k, v]) => [k, { member: v.member, refs: new Set(v.refs) }]));
  const d = obj(diff);
  joinInto(next, d?.joins);
  const leaves = obj(d?.leaves);
  for (const [key, entry] of Object.entries(leaves ?? {})) {
    const slot = next.get(key);
    if (!slot) continue;
    for (const { ref } of metasOf(entry)) slot.refs.delete(ref);
    if (!slot.refs.size) next.delete(key);
  }
  return next;
}

export function presenceHost(presence: Presence): string | null {
  for (const { member } of presence.values()) if (member.host) return member.id;
  return null;
}

/** The host first, then everyone else by name. */
export function presenceList(presence: Presence): PartyMember[] {
  return [...presence.values()]
    .map((v) => v.member)
    .sort((a, b) => Number(b.host) - Number(a.host) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

// ---- what the host plays, and where ----

export type PartyTitle = {
  key: string;
  kind: "movie" | "series" | "unsupported";
  name: string;
  seriesName: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
  ids: { imdb?: string; tmdb?: string; tvdb?: string };
  addon: {
    type: "movie" | "series";
    metaId: string;
    videoId: string;
    prefer: { addonUrl: string; bingeGroup: string | null } | null;
  } | null;
};

/** A host title from the wire (untrusted): the fields this app reads, checked. */
export function parseTitle(value: unknown): PartyTitle | null {
  const o = obj(value);
  if (!o || typeof o.key !== "string" || typeof o.name !== "string") return null;
  const kind = o.kind === "movie" || o.kind === "series" ? o.kind : "unsupported";
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const ids: PartyTitle["ids"] = {};
  const rawIds = obj(o.ids) ?? {};
  for (const k of ["imdb", "tmdb", "tvdb"] as const) {
    const v = str(rawIds[k]);
    if (v && v.length <= 32) ids[k] = v;
  }
  const a = obj(o.addon);
  const prefer = obj(a?.prefer);
  const addon =
    a && (a.type === "movie" || a.type === "series") && str(a.metaId) && str(a.videoId)
      ? {
          type: a.type as "movie" | "series",
          metaId: a.metaId as string,
          videoId: a.videoId as string,
          prefer:
            prefer && typeof prefer.addonUrl === "string"
              ? { addonUrl: prefer.addonUrl, bingeGroup: str(prefer.bingeGroup) }
              : null,
        }
      : null;
  return {
    key: o.key,
    kind,
    name: o.name.slice(0, 200),
    seriesName: str(o.seriesName),
    year: num(o.year),
    season: num(o.season),
    episode: num(o.episode),
    ids,
    addon,
  };
}

export function titleLabel(title: PartyTitle): string {
  if (title.kind === "series" && title.season != null && title.episode != null) {
    return `${title.seriesName ?? title.name} · S${title.season}:E${title.episode}`;
  }
  return title.year ? `${title.name} (${title.year})` : title.name;
}

/** The library item whose provider ids match the host's (IMDb, TMDb or TVDb). */
export function matchesIds(providerIds: Record<string, string>, ids: PartyTitle["ids"]): boolean {
  return Object.entries(providerIds).some(([k, v]) => {
    const key = k.toLowerCase() as keyof PartyTitle["ids"];
    return (key === "imdb" || key === "tmdb" || key === "tvdb") && ids[key] != null && ids[key] === v;
  });
}

// ---- sync arithmetic (same numbers as the desktop guest) ----

export type PartySync = { key: string; pos: number; paused: boolean; rate: number; at: number; open: boolean };

export function parseSync(value: unknown): PartySync | null {
  const o = obj(value);
  if (!o || typeof o.key !== "string" || typeof o.pos !== "number" || typeof o.at !== "number") return null;
  if (!Number.isFinite(o.pos) || !Number.isFinite(o.at)) return null;
  const rate = typeof o.rate === "number" && o.rate > 0 && o.rate <= 4 ? o.rate : 1;
  return { key: o.key, pos: Math.max(0, o.pos), paused: o.paused === true, rate, at: o.at, open: o.open === true };
}

export const DRIFT_PLAYING = 1.5;
export const DRIFT_PAUSED = 0.4;
export const SEEK_COOLDOWN_MS = 4000;
const MAX_PROJECTION_S = 15;

export function expectedPosition(sync: Pick<PartySync, "pos" | "paused" | "rate" | "at">, hostNow: number): number {
  if (sync.paused) return sync.pos;
  const elapsed = Math.min(Math.max(0, (hostNow - sync.at) / 1000), MAX_PROJECTION_S);
  return sync.pos + elapsed * sync.rate;
}

export type Correction = { seek: number | null; pause: boolean | null; rate: number | null };

export function decideCorrection(
  local: { time: number; paused: boolean; speed: number; duration: number },
  remote: PartySync,
  hostNow: number,
  now: number,
  lastSeekAt: number,
): Correction {
  const pause = remote.paused !== local.paused ? remote.paused : null;
  const rate = Math.abs(remote.rate - local.speed) > 0.01 ? remote.rate : null;
  let target = expectedPosition(remote, hostNow);
  if (local.duration > 0) target = Math.min(target, Math.max(0, local.duration - 1));
  target = Math.max(0, target);
  const gap = Math.abs(local.time - target);
  const threshold = remote.paused ? DRIFT_PAUSED : DRIFT_PLAYING;
  const cooling = now - lastSeekAt < SEEK_COOLDOWN_MS;
  return { seek: gap > threshold && !cooling ? target : null, pause, rate };
}

export type ClockSample = { offset: number; rtt: number };

export function clockSample(sentAt: number, hostAt: number, receivedAt: number): ClockSample {
  const rtt = Math.max(0, receivedAt - sentAt);
  return { offset: hostAt + rtt / 2 - receivedAt, rtt };
}

export function bestOffset(samples: ClockSample[]): number {
  if (!samples.length) return 0;
  return samples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset;
}

export function livePosition(time: number, paused: boolean, speed: number, receivedAt: number, now: number): number {
  if (paused) return time;
  return time + Math.max(0, Math.min(5, (now - receivedAt) / 1000)) * speed;
}
