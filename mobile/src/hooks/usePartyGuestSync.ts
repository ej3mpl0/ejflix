import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { usePartyStatus } from "../lib/party-context";
import type { Movie, PlayerState } from "../lib/types";
import { engine } from "../services/player/engine";
import { onPartyMessage, partySend } from "../services/party";
import {
  bestOffset,
  clockSample,
  decideCorrection,
  livePosition,
  parseSync,
  type ClockSample,
  type PartySync,
} from "../services/party.pure";

const PING_EARLY_MS = [0, 1500, 3500];
const PING_EVERY_MS = 30_000;

/**
 * The phone's player as a party guest (desktop `usePartySync`, guest half): it asks the
 * host where it is, measures the clock gap with pings and corrects pause, speed and
 * position; with the host's permission its own pause / seek go to the host.
 */
export function usePartyGuestSync({
  movie,
  state,
  onNotice,
}: {
  movie: Movie;
  state: PlayerState;
  /** The host paused / resumed ("Ana paused"). */
  onNotice: (paused: boolean, name: string) => void;
}): { guest: boolean; locked: boolean; request: (control: { action: "play" | "pause" | "seek"; pos?: number }) => void } {
  const status = usePartyStatus();
  const guest = status.active && Boolean(movie.partyKey) && movie.partyKey === status.title?.key;
  const live = status.phase === "live";
  const stateRef = useRef(state);
  const receivedAt = useRef(Date.now());
  const statusRef = useRef(status);
  statusRef.current = status;
  const onNoticeRef = useRef(onNotice);
  onNoticeRef.current = onNotice;
  const remote = useRef<PartySync | null>(null);
  const samples = useRef<ClockSample[]>([]);
  const lastSeek = useRef(0);
  const lastRequest = useRef(0);

  useEffect(() => {
    stateRef.current = state;
    receivedAt.current = Date.now();
  }, [state]);

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
    if (fix.pause != null) void engine.playerSetPause(fix.pause).catch(() => undefined);
    if (fix.rate != null) void api.playerSetSpeed(fix.rate).catch(() => undefined);
    if (fix.seek != null) {
      lastSeek.current = now;
      void api.playerSeek(fix.seek, false).catch(() => undefined);
    }
  };
  const correctRef = useRef(correct);
  correctRef.current = correct;

  const ready = state.duration > 0;
  useEffect(() => {
    if (guest && ready) correctRef.current();
  }, [guest, ready]);

  useEffect(() => {
    if (!guest || !live) return;
    remote.current = null;
    partySend("sync_req", null);
    const ping = () => partySend("ping", { t0: Date.now() });
    const timers = PING_EARLY_MS.map((ms) => setTimeout(ping, ms));
    const handle = setInterval(ping, PING_EVERY_MS);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(handle);
    };
  }, [guest, live, movie.partyKey]);

  useEffect(() => {
    if (!guest) return;
    return onPartyMessage((message) => {
      if (!message.fromHost) return;
      const data = (message.data ?? {}) as Record<string, unknown>;
      if (message.event === "pong") {
        if (data.to === statusRef.current.selfId && typeof data.t0 === "number" && typeof data.th === "number") {
          samples.current = [...samples.current, clockSample(data.t0, data.th, Date.now())].slice(-8);
        }
        return;
      }
      if (message.event !== "sync") return;
      const sync = parseSync(message.data);
      if (!sync || sync.key !== movie.partyKey) return;
      const before = remote.current;
      remote.current = sync;
      if (before && before.paused !== sync.paused && Date.now() - lastRequest.current > 3000) {
        const host = statusRef.current.members.find((m) => m.host)?.name ?? "";
        onNoticeRef.current(sync.paused, host);
      }
      // Reports already on the way predate our own request: let the host catch up.
      if (Date.now() - lastRequest.current > 1500) correctRef.current();
    });
  }, [guest, movie.partyKey]);

  const request = (control: { action: "play" | "pause" | "seek"; pos?: number }) => {
    if (!guest) return;
    partySend("control", control);
    lastRequest.current = Date.now();
    lastSeek.current = Date.now();
  };

  return { guest, locked: guest && !(remote.current?.open ?? false), request };
}
