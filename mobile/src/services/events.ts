import type { Movie, ParentalStatus, PlayerState, Settings, UpdateProgress } from "../lib/types";
import type { MessageKey } from "../lib/i18n";

/** What went wrong, so the UI can offer the right way out. */
export type PlayerErrorCode = "decoder" | "network" | "unknown";

export type PlayerError = {
  /** Ready-made sentence, used when the UI has nothing better to say. */
  message: string;
  /** Raw engine text, shown small under the message. */
  detail: string;
  code: PlayerErrorCode;
  /** Stream URL when it can be handed to another app. */
  url: string | null;
  /** The failing Jellyfin playback was already a server transcode. */
  transcoding?: boolean;
  /** Translated sentence for a known failure (the UI prefers it over `message`). */
  key?: MessageKey;
};

/** Playback failure the UI can translate: `message` stays for logs, `key` is shown. */
export class PlaybackError extends Error {
  constructor(
    readonly key: MessageKey,
    message: string,
  ) {
    super(message);
    this.name = "PlaybackError";
  }
}

/** Events that replaced the Tauri `listen()` channels of the desktop app. */
export type EventMap = {
  "player://state": PlayerState;
  "player://open": Movie;
  "player://next": Movie;
  "player://exit": void;
  "player://close": void;
  "player://hotkey": string;
  /** Engine failure; the UI turns this into a card with a way out. */
  "player://error": PlayerError;
  "iptv://changed": void;
  /** The reminder list of the profile changed. */
  "iptv://reminders": void;
  "settings://changed": Settings;
  "update://progress": UpdateProgress;
  "parental://changed": ParentalStatus;
  /** The offline downloads list (or one transfer's progress) changed. */
  "downloads://changed": void;
};

type Handler<K extends keyof EventMap> = (payload: EventMap[K]) => void;
type AnyHandler = (payload: unknown) => void;

const handlers = new Map<keyof EventMap, Set<AnyHandler>>();

export function on<K extends keyof EventMap>(name: K, handler: Handler<K>): () => void {
  let set = handlers.get(name);
  if (!set) {
    set = new Set();
    handlers.set(name, set);
  }
  const wrapped = handler as unknown as AnyHandler;
  set.add(wrapped);
  return () => {
    set?.delete(wrapped);
  };
}

export function emit<K extends keyof EventMap>(
  name: K,
  ...args: EventMap[K] extends void ? [] : [EventMap[K]]
): void {
  const set = handlers.get(name);
  if (!set) return;
  const payload = args[0] as unknown;
  for (const handler of Array.from(set)) {
    try {
      handler(payload);
    } catch (error) {
      console.warn(`[events] handler for ${name} threw`, error);
    }
  }
}

/** Tauri-style subscription: resolves to the unlisten function. */
export function listen<K extends keyof EventMap>(name: K, handler: Handler<K>): Promise<() => void> {
  return Promise.resolve(on(name, handler));
}
