import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import {
  HEARTBEAT_MS,
  bestOffset,
  clockSample,
  decideCorrection,
  describeForParty,
  livePosition,
  partyApi,
  type ClockSample,
  type PartyControl,
  type PartyStatus,
  type PartySync,
} from "../lib/party";
import type { Movie, PlayerState } from "../lib/types";

/** A jump this far from where the clock says the host should be is a seek to announce. */
const JUMP_SECONDS = 2;
const PING_EARLY_MS = [0, 1500, 3500];
const PING_EVERY_MS = 30_000;

export type PartySyncApi = {
  /** This player is the party's clock. */
  host: boolean;
  /** This player follows the host (it plays the party's title as a guest). */
  guest: boolean;
  /** Guest without permission to pause / seek: local controls must not act. */
  locked: boolean;
  /** Guest with permission: ask the host to do it for everyone. */
  request: (control: PartyControl) => void;
};

/**
 * Keeps the overlay's player in step with the party. The host announces its title and
 * reports where it is every few seconds (and right away on pause, play, seek or speed);
 * a guest estimates the host's clock with pings and corrects pause, speed and position.
 */
export function usePartySync({
  enabled,
  movie,
  state,
  party,
  onNotice,
}: {
  enabled: boolean;
  movie: Movie;
  state: PlayerState;
  party: PartyStatus | null;
  /** A short message on the video ("Ana paused"). */
  onNotice: (event: "paused" | "resumed" | "seeked", name: string) => void;
}): PartySyncApi {
  const live = party?.active === true && party.phase === "live";
  const host = enabled && party?.active === true && party.host;
  const guest =
    enabled && party?.active === true && !party.host && Boolean(movie.partyKey) && movie.partyKey === party.title?.key;
  const stateRef = useRef(state);
  const receivedAt = useRef(Date.now());
  const partyRef = useRef(party);
  partyRef.current = party;
  const onNoticeRef = useRef(onNotice);
  onNoticeRef.current = onNotice;
  /** Host: key of the title it announced. */
  const announced = useRef<string | null>(null);
  /** Guest: the host's last report, the clock offset and when it last seeked. */
  const remote = useRef<PartySync | null>(null);
  const samples = useRef<ClockSample[]>([]);
  const lastSeek = useRef(0);
  const lastSyncSent = useRef(0);
  const hostOpen = useRef(false);
  /** Guest: when it last asked the host to act (reports already on the way predate it). */
  const lastRequest = useRef(0);

  // Every state event: remember when it came, and (host) spot a seek in the time line.
  const previous = useRef<{ time: number; paused: boolean; speed: number; at: number } | null>(null);
  useEffect(() => {
    const now = Date.now();
    const before = previous.current;
    stateRef.current = state;
    receivedAt.current = now;
    previous.current = { time: state.time, paused: state.paused, speed: state.speed, at: now };
    if (!host || !before || state.duration <= 0) return;
    const expected = livePosition(before.time, before.paused, before.speed, before.at, now);
    const jumped = Math.abs(state.time - expected) > JUMP_SECONDS;
    if (jumped || before.paused !== state.paused || before.speed !== state.speed) sendSync(jumped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /** Host: where it is, by its clock. Seeks may come in a burst (scrubbing): at most one a second. */
  const sendSync = (throttle = false) => {
    const key = announced.current;
    const s = stateRef.current;
    if (!key || s.duration <= 0) return;
    const now = Date.now();
    if (throttle && now - lastSyncSent.current < 1000) return;
    lastSyncSent.current = now;
    const sync: PartySync = {
      key,
      pos: livePosition(s.time, s.paused, s.speed, receivedAt.current, now),
      paused: s.paused,
      rate: s.speed,
      at: now,
      open: partyRef.current?.open ?? false,
    };
    void partyApi.send("sync", sync).catch(() => undefined);
  };
  const sendSyncRef = useRef(sendSync);
  sendSyncRef.current = sendSync;

  // Host: announce the title (again for a new party or the next episode).
  useEffect(() => {
    announced.current = null;
    if (!host) return;
    let alive = true;
    describeForParty(movie)
      .then((title) => {
        if (!alive) return;
        announced.current = title.key;
        void partyApi.setTitle(title).catch(() => undefined);
        sendSyncRef.current();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [host, party?.code, movie]);

  // Host: the heartbeat, and a fresh report when the permission changes.
  useEffect(() => {
    if (!host || !live) return;
    sendSyncRef.current();
    const handle = window.setInterval(() => sendSyncRef.current(), HEARTBEAT_MS);
    return () => window.clearInterval(handle);
  }, [host, live, party?.open]);

  /** Guest: pause, speed and position to match the host's last report. */
  const correct = () => {
    const sync = remote.current;
    const s = stateRef.current;
    if (!sync || s.duration <= 0) return;
    const now = Date.now();
    const local = {
      time: livePosition(s.time, s.paused, s.speed, receivedAt.current, now),
      paused: s.paused,
      speed: s.speed,
      duration: s.duration,
    };
    const fix = decideCorrection(local, sync, now + bestOffset(samples.current), now, lastSeek.current);
    if (fix.pause != null) void partyApi.setPause(fix.pause).catch(() => undefined);
    if (fix.rate != null) void api.playerSetSpeed(fix.rate).catch(() => undefined);
    if (fix.seek != null) {
      lastSeek.current = now;
      void api.playerSeek(fix.seek, false).catch(() => undefined);
    }
  };
  const correctRef = useRef(correct);
  correctRef.current = correct;

  // Guest: once the file is up, catch up with what the host last said.
  const ready = state.duration > 0;
  useEffect(() => {
    if (guest && ready) correctRef.current();
  }, [guest, ready]);

  // Guest: ask where the host is, and measure the clock gap a few times, then now and then.
  useEffect(() => {
    if (!guest || !live) return;
    remote.current = null;
    void partyApi.send("sync_req", null).catch(() => undefined);
    const ping = () => void partyApi.send("ping", { t0: Date.now() }).catch(() => undefined);
    const timers = PING_EARLY_MS.map((ms) => window.setTimeout(ping, ms));
    const handle = window.setInterval(ping, PING_EVERY_MS);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearInterval(handle);
    };
  }, [guest, live, movie.partyKey]);

  const nameOf = (id: string) => partyRef.current?.members.find((m) => m.id === id)?.name ?? "";

  useEffect(() => {
    if (!host && !guest) return;
    const unlisten = partyApi.onMessage((message) => {
      const data = (message.data ?? {}) as Record<string, unknown>;
      if (host) {
        if (message.event === "sync_req") sendSyncRef.current(true);
        else if (message.event === "ping" && typeof data.t0 === "number") {
          void partyApi.send("pong", { t0: data.t0, th: Date.now(), to: message.from }).catch(() => undefined);
        } else if (message.event === "control" && partyRef.current?.open) {
          const pos = typeof data.pos === "number" && Number.isFinite(data.pos) ? Math.max(0, data.pos) : null;
          const name = nameOf(message.from);
          if (data.action === "pause" || data.action === "play") {
            const paused = data.action === "pause";
            if (stateRef.current.paused !== paused) {
              void partyApi.setPause(paused).catch(() => undefined);
              onNoticeRef.current(paused ? "paused" : "resumed", name);
            }
          } else if (data.action === "seek" && pos != null) {
            void api.playerSeek(pos, false).catch(() => undefined);
            onNoticeRef.current("seeked", name);
          }
        }
        return;
      }
      // Guest from here on: only the host's word counts.
      if (!message.fromHost) return;
      if (message.event === "pong" && data.to === partyRef.current?.selfId) {
        if (typeof data.t0 === "number" && typeof data.th === "number") {
          samples.current = [...samples.current, clockSample(data.t0, data.th, Date.now())].slice(-8);
        }
      } else if (message.event === "sync") {
        const sync = data as unknown as PartySync;
        if (sync.key !== movie.partyKey || typeof sync.pos !== "number" || typeof sync.at !== "number") return;
        const before = remote.current;
        remote.current = {
          key: sync.key,
          pos: sync.pos,
          paused: Boolean(sync.paused),
          rate: typeof sync.rate === "number" && sync.rate > 0 ? sync.rate : 1,
          at: sync.at,
          open: Boolean(sync.open),
        };
        hostOpen.current = remote.current.open;
        if (before && before.paused !== remote.current.paused && Date.now() - lastRequest.current > 3000) {
          const hostName = partyRef.current?.members.find((m) => m.host)?.name ?? "";
          onNoticeRef.current(remote.current.paused ? "paused" : "resumed", hostName);
        }
        if (Date.now() - lastRequest.current > 1500) correctRef.current();
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, guest, movie.partyKey]);

  const request = (control: PartyControl) => {
    if (!guest) return;
    void partyApi.send("control", control).catch(() => undefined);
    // Our own move is not a drift to undo while the host's report catches up.
    lastRequest.current = Date.now();
    lastSeek.current = Date.now();
  };

  return { host, guest, locked: guest && !hostOpen.current, request };
}
