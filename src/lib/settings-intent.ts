import { useEffect, useRef } from "react";

/**
 * What an empty state or the command palette wants done once Settings shows a section:
 * start adding an IPTV list, or jump to the addon import. Handled once by that section,
 * whether it mounts afterwards or is already on screen.
 */
export type SettingsIntent = "iptv-add" | "addons-import";

const EVENT = "ejflix:settings-intent";
let pending: SettingsIntent | null = null;

export function requestSettingsIntent(intent: SettingsIntent): void {
  pending = intent;
  window.dispatchEvent(new Event(EVENT));
}

/** Runs `handler` when `intent` is (or was just) requested. */
export function useSettingsIntent(intent: SettingsIntent, handler: () => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const take = () => {
      if (pending !== intent) return;
      pending = null;
      // After the section's first paint, so the target exists.
      requestAnimationFrame(() => ref.current());
    };
    take();
    window.addEventListener(EVENT, take);
    return () => window.removeEventListener(EVENT, take);
  }, [intent]);
}
