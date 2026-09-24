import { useEffect, useRef } from "react";

/**
 * What an empty state or the command palette wants done once Settings shows a section:
 * start adding an IPTV list, or jump to the addon import. Handled once by that section,
 * whether it mounts afterwards or is already on screen.
 */
export type SettingsIntent = "iptv-add" | "addons-import";

const EVENT = "ejflix:settings-intent";
/** A section that has not shown up by then is not coming: the intent is dropped. */
const EXPIRY_MS = 2000;
let pending: SettingsIntent | null = null;
let expiry: number | undefined;

export function requestSettingsIntent(intent: SettingsIntent): void {
  pending = intent;
  window.clearTimeout(expiry);
  expiry = window.setTimeout(clearSettingsIntent, EXPIRY_MS);
  window.dispatchEvent(new Event(EVENT));
}

/** Forgets an intent nobody took (the user went elsewhere), so a later visit is a plain one. */
export function clearSettingsIntent(): void {
  pending = null;
  window.clearTimeout(expiry);
}

/** Runs `handler` when `intent` is (or was just) requested. */
export function useSettingsIntent(intent: SettingsIntent, handler: () => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const take = () => {
      if (pending !== intent) return;
      clearSettingsIntent();
      // After the section's first paint, so the target exists.
      requestAnimationFrame(() => ref.current());
    };
    take();
    window.addEventListener(EVENT, take);
    return () => window.removeEventListener(EVENT, take);
  }, [intent]);
}
