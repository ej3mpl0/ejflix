import { useSyncExternalStore } from "react";
import { CHAT_MAX, PARTY_REACTIONS, partyApi } from "./party";

/**
 * Chat and reactions of the watch party, kept per window outside React: the overlay's
 * player remounts on every episode and the conversation must survive it.
 */

export type ChatLine = { id: number; from: string; name: string; text: string; mine: boolean; at: number };
export type FloatingReaction = { id: number; emoji: string; name: string; x: number };

type Snapshot = { lines: ChatLine[]; reactions: FloatingReaction[]; unread: number };

const MAX_LINES = 60;
const REACTION_MS = 2600;

let snapshot: Snapshot = { lines: [], reactions: [], unread: 0 };
let seq = 0;
let started = false;
let reading = false;
const listeners = new Set<() => void>();

function set(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function addLine(line: Omit<ChatLine, "id" | "at">) {
  seq += 1;
  const lines = [...snapshot.lines, { ...line, id: seq, at: Date.now() }].slice(-MAX_LINES);
  set({ lines, unread: line.mine || reading ? snapshot.unread : snapshot.unread + 1 });
}

function addReaction(emoji: string, name: string) {
  seq += 1;
  const id = seq;
  // Spread along the right side so a burst does not stack on one spot.
  const x = 8 + ((id * 37) % 22);
  set({ reactions: [...snapshot.reactions, { id, emoji, name, x }].slice(-24) });
  window.setTimeout(() => set({ reactions: snapshot.reactions.filter((r) => r.id !== id) }), REACTION_MS);
}

/** Text a peer sent, trimmed to what the panel shows (the data is untrusted). */
function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function start() {
  if (started) return;
  started = true;
  void partyApi.onMessage((message) => {
    const data = (message.data ?? {}) as Record<string, unknown>;
    const name = cleanText(data.name, 40) || "?";
    if (message.event === "chat") {
      const text = cleanText(data.text, CHAT_MAX);
      if (text) addLine({ from: message.from, name, text, mine: false });
    } else if (message.event === "react") {
      const emoji = typeof data.emoji === "string" ? data.emoji : "";
      if ((PARTY_REACTIONS as readonly string[]).includes(emoji)) addReaction(emoji, name);
    }
  });
  // A new party starts with an empty conversation.
  void partyApi.onStatus((status) => {
    if (!status.active && (snapshot.lines.length || snapshot.unread)) set({ lines: [], unread: 0 });
  });
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePartyChat(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** The chat is on screen: nothing is unread while it is. */
export function setChatReading(on: boolean) {
  reading = on;
  if (on && snapshot.unread) set({ unread: 0 });
}

export async function sendChat(text: string, name: string): Promise<void> {
  const clean = cleanText(text, CHAT_MAX);
  if (!clean) return;
  await partyApi.send("chat", { text: clean, name });
  addLine({ from: "", name, text: clean, mine: true });
}

export async function sendReaction(emoji: string, name: string): Promise<void> {
  await partyApi.send("react", { emoji, name });
  addReaction(emoji, name);
}
