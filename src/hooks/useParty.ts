import { useEffect, useState } from "react";
import { partyApi, type PartyStatus } from "../lib/party";

/** The watch party as Rust sees it, live (each window keeps its own copy). */
export function useParty(): PartyStatus | null {
  const [status, setStatus] = useState<PartyStatus | null>(null);
  useEffect(() => {
    let alive = true;
    // An event that lands before the first read is newer than it: keep the event.
    let heard = false;
    const unlisten = partyApi.onStatus((next) => {
      heard = true;
      if (alive) setStatus(next);
    });
    partyApi
      .status()
      .then((current) => {
        if (alive && !heard) setStatus(current);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, []);
  return status;
}

/** My own name in the party (as the others see it). */
export function partySelfName(status: PartyStatus | null): string {
  return status?.members.find((m) => m.id === status.selfId)?.name ?? "";
}
