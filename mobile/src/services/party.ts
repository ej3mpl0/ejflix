/**
 * Watch party on the phone, as a guest (port of `src-tauri/src/party.rs`): one Supabase
 * Realtime websocket (Broadcast + Presence), heartbeat, reconnect with backoff, and a
 * small store the screens subscribe to. React Native has no CSP, so the socket lives
 * in JS here. The phone has no ejFlix account, so only public channels are joined.
 */
import {
  backoffMs,
  broadcastMessage,
  broadcastOf,
  classifyJoinError,
  decodePhx,
  encodePhx,
  formatCode,
  heartbeatMessage,
  joinMessage,
  leaveMessage,
  normalizeCode,
  parseTitle,
  presenceDiff,
  presenceHost,
  presenceList,
  presenceSync,
  replyOf,
  topicOf,
  trackMessage,
  type PartyMember,
  type PartyTitle,
  type PhxMessage,
  type Presence,
} from "./party.pure";
import { uuid } from "./util";

/** Same public project as the desktop app (row level security protects every table). */
const SUPABASE_URL = "https://echxltnuadslbqksjwda.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjaHhsdG51YWRzbGJxa3Nqd2RhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1NjQ3NTUsImV4cCI6MjEwNTE0MDc1NX0.E0QcA_F8srRTtoB-HT8S4Q8F8MvXoXUJS6QX2hBSCS8";

const HEARTBEAT_MS = 25_000;
const JOIN_TIMEOUT_MS = 12_000;
const HOST_WAIT_MS = 10_000;
const HOST_GRACE_MS = 45_000;
const PRESENCE_SETTLE_MS = 3000;
const FIRST_JOIN_TRIES = 3;
const MAX_DATA_BYTES = 8 * 1024;
/** What the screens may send (the rest is the party's own plumbing). */
const APP_EVENTS = ["sync", "sync_req", "control", "chat", "react", "ping", "pong"];

export type PartyStatus = {
  active: boolean;
  phase: "idle" | "connecting" | "live" | "reconnecting" | "ended";
  code: string;
  host: boolean;
  selfId: string;
  members: PartyMember[];
  title: PartyTitle | null;
  hostAway: boolean;
  /** `party:*` code of why it ended or could not start. */
  error: string | null;
};

export type PartyMessage = { event: string; from: string; fromHost: boolean; data: unknown };

const IDLE: PartyStatus = {
  active: false,
  phase: "idle",
  code: "",
  host: false,
  selfId: "",
  members: [],
  title: null,
  hostAway: false,
  error: null,
};

let status: PartyStatus = IDLE;
const statusListeners = new Set<() => void>();
const messageListeners = new Set<(message: PartyMessage) => void>();
let current: PartySession | null = null;

function setStatus(owner: PartySession, change: Partial<PartyStatus>) {
  if (current !== owner) return;
  status = { ...status, ...change };
  for (const listener of statusListeners) listener();
}

class PartySession {
  private ws: WebSocket | null = null;
  private refSeq = 0;
  private joinRef = "";
  private joined = false;
  private pendingBeat: string | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];
  private presence: Presence = new Map();
  private attempt = 0;
  private joinedOnce = false;
  private sawHost = false;
  private hostGoneSince: number | null = null;
  private joinedAt = 0;
  private closed = false;
  private readonly topic: string;

  constructor(
    code: string,
    readonly selfId: string,
    private readonly name: string,
    private readonly avatar: string | null,
  ) {
    this.topic = topicOf(code);
  }

  private ref(): string {
    this.refSeq += 1;
    return String(this.refSeq);
  }

  private write(message: PhxMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(encodePhx(message));
      return true;
    } catch {
      return false;
    }
  }

  private clearTimers() {
    this.timers.forEach(clearTimeout);
    this.intervals.forEach(clearInterval);
    this.timers = [];
    this.intervals = [];
  }

  connect() {
    if (this.closed) return;
    this.joined = false;
    this.pendingBeat = null;
    const url = `${SUPABASE_URL.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.dropped();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.joinRef = this.ref();
      this.write(joinMessage(this.topic, this.selfId, this.joinRef));
      this.timers.push(setTimeout(() => !this.joined && this.dropped(), JOIN_TIMEOUT_MS));
    };
    ws.onmessage = (event) => {
      if (typeof event.data === "string") this.handle(event.data);
    };
    ws.onerror = () => this.dropped();
    ws.onclose = () => this.dropped();
  }

  private handle(text: string) {
    const msg = decodePhx(text);
    if (!msg) return;
    if (msg.topic === "phoenix") {
      if (msg.event === "phx_reply" && msg.ref != null && msg.ref === this.pendingBeat) this.pendingBeat = null;
      return;
    }
    if (msg.topic !== this.topic) return;
    if (!this.joined) {
      const reply = replyOf(msg);
      if (reply && msg.ref === this.joinRef) {
        if (reply.ok) this.onJoined();
        else this.refused(reply.reason);
      } else if (msg.event === "phx_close" || msg.event === "phx_error") {
        this.dropped();
      }
      return;
    }
    switch (msg.event) {
      case "presence_state":
        this.presence = presenceSync(msg.payload);
        setStatus(this, { members: presenceList(this.presence) });
        break;
      case "presence_diff":
        this.presence = presenceDiff(this.presence, msg.payload);
        setStatus(this, { members: presenceList(this.presence) });
        break;
      case "broadcast":
        this.onBroadcast(msg.payload);
        break;
      case "phx_close":
      case "phx_error":
        this.dropped();
        break;
      default:
        break;
    }
  }

  private refused(reason: string) {
    const failure = classifyJoinError(reason, false, false);
    if (failure === "other" && this.joinedOnce) {
      this.dropped();
      return;
    }
    this.end(failure === "needs-account" ? "party:needs_account" : failure === "denied" ? "party:denied" : "party:join_failed");
  }

  private onJoined() {
    this.joined = true;
    this.attempt = 0;
    this.joinedOnce = true;
    this.joinedAt = Date.now();
    this.presence = new Map();
    this.clearTimers();
    setStatus(this, { phase: "live", error: null });
    this.write(trackMessage(this.topic, { name: this.name, avatar: this.avatar, host: false }, this.ref(), this.joinRef));
    this.write(broadcastMessage(this.topic, "hello", this.selfId, null, this.ref(), this.joinRef));
    this.intervals.push(
      setInterval(() => {
        if (this.pendingBeat) {
          // The last one never came back: the socket is dead without knowing it.
          this.dropped();
          return;
        }
        this.pendingBeat = this.ref();
        this.write(heartbeatMessage(this.pendingBeat));
      }, HEARTBEAT_MS),
    );
    this.intervals.push(setInterval(() => this.checkHost(), 1000));
  }

  private onBroadcast(payload: unknown) {
    const b = broadcastOf(payload);
    if (!b || b.from === this.selfId) return;
    const host = presenceHost(this.presence);
    // Until presence names the host, take the word of whoever speaks as one.
    const fromHost = host == null || host === b.from;
    if (b.event === "title" && fromHost) {
      setStatus(this, { title: parseTitle(b.data) });
    } else if (b.event === "end" && fromHost) {
      this.end("party:host_ended");
    } else if (APP_EVENTS.includes(b.event)) {
      const message: PartyMessage = { event: b.event, from: b.from, fromHost, data: b.data };
      for (const listener of messageListeners) listener(message);
    }
  }

  /** A code nobody hosts, or a host gone for too long, ends the party. */
  private checkHost() {
    if (presenceHost(this.presence)) {
      this.sawHost = true;
      if (this.hostGoneSince != null) {
        this.hostGoneSince = null;
        setStatus(this, { hostAway: false });
      }
      return;
    }
    const now = Date.now();
    if (now - this.joinedAt < PRESENCE_SETTLE_MS) return;
    if (!this.sawHost) {
      if (now - this.joinedAt > HOST_WAIT_MS) this.end("party:not_found");
      return;
    }
    if (this.hostGoneSince == null) {
      this.hostGoneSince = now;
      setStatus(this, { hostAway: true });
    } else if (now - this.hostGoneSince > HOST_GRACE_MS) {
      this.end("party:host_left");
    }
  }

  private closeSocket() {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }

  private dropped() {
    if (this.closed) return;
    this.clearTimers();
    this.closeSocket();
    this.joined = false;
    this.attempt += 1;
    if (!this.joinedOnce && this.attempt >= FIRST_JOIN_TRIES) {
      this.end("party:offline");
      return;
    }
    setStatus(this, { phase: "reconnecting", members: [] });
    this.timers.push(setTimeout(() => this.connect(), backoffMs(this.attempt, Math.random())));
  }

  send(event: string, data: unknown): boolean {
    if (!this.joined) return false;
    return this.write(broadcastMessage(this.topic, event, this.selfId, data, this.ref(), this.joinRef));
  }

  private end(error: string | null) {
    this.closed = true;
    this.clearTimers();
    this.closeSocket();
    setStatus(this, { active: false, phase: "ended", members: [], hostAway: false, error });
    if (current === this) current = null;
  }

  leave() {
    if (this.joined) this.write(leaveMessage(this.topic, this.ref(), this.joinRef));
    this.closed = true;
    this.clearTimers();
    this.closeSocket();
  }
}

// ---- the store ----

export function getPartyStatus(): PartyStatus {
  return status;
}

export function subscribeParty(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function onPartyMessage(listener: (message: PartyMessage) => void): () => void {
  messageListeners.add(listener);
  return () => messageListeners.delete(listener);
}

/** Joins the party behind `code` (leaving the current one). Throws `party:bad_code`. */
export function partyJoin(code: string, name: string, avatar: string | null): void {
  const normalized = normalizeCode(code);
  if (!normalized) throw new Error("party:bad_code");
  current?.leave();
  const session = new PartySession(normalized, uuid().replace(/-/g, ""), name.trim().slice(0, 40), avatar);
  current = session;
  status = { ...IDLE, active: true, phase: "connecting", code: formatCode(normalized), selfId: session.selfId };
  for (const listener of statusListeners) listener();
  session.connect();
}

export function partyLeave(): void {
  current?.leave();
  current = null;
  status = IDLE;
  for (const listener of statusListeners) listener();
}

export function partySend(event: string, data: unknown): boolean {
  if (!APP_EVENTS.includes(event) || !current) return false;
  if (JSON.stringify(data ?? null).length > MAX_DATA_BYTES) return false;
  return current.send(event, data);
}
