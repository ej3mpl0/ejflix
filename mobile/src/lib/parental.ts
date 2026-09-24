import { useEffect, useState } from "react";
import { api } from "./api";
import type { MessageKey } from "./i18n";
import type { ParentalLevel, ParentalStatus } from "./types";

/** Age limits offered for a profile, strictest first; 18 means no limit. */
export const PARENTAL_LEVELS: ParentalLevel[] = [0, 7, 12, 16, 18];

export function parentalLevelKey(level: ParentalLevel): MessageKey {
  switch (level) {
    case 0:
      return "parentalLevelAll";
    case 7:
      return "parentalLevel7";
    case 12:
      return "parentalLevel12";
    case 16:
      return "parentalLevel16";
    default:
      return "parentalLevelNone";
  }
}

function text(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The title is above the open profile's age limit (details or playback refused). */
export function isParentalBlocked(err: unknown): boolean {
  return text(err) === "parental_blocked";
}

/** The service asks for the parental PIN before this action (or the one given was wrong). */
export function needsParentalPin(err: unknown): boolean {
  return ["parental_pin_required", "parental_pin_wrong", "parental_locked"].includes(text(err));
}

/** Message of a parental PIN error, or null when the error is something else. */
export function parentalErrorKey(err: unknown): MessageKey | null {
  switch (text(err)) {
    case "parental_pin_wrong":
      return "parentalPinWrong";
    case "parental_locked":
      return "parentalPinLocked";
    case "parental_pin_required":
      return "parentalPinRequired";
    default:
      return null;
  }
}

/** Restriction of the open profile, kept current when Settings changes it. */
export function useParental(): ParentalStatus | null {
  const [status, setStatus] = useState<ParentalStatus | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .parentalStatus()
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch(() => undefined);
    const unlisten = api.onParentalChanged((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
      void unlisten.then((fn) => fn());
    };
  }, []);
  return status;
}
