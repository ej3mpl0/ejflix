import { useEffect, useState, useSyncExternalStore } from "react";
import { BellRing, Play, X } from "lucide-react";
import type { Reminder } from "../lib/types";
import { api } from "../lib/api";
import { channelInitials, formatTime, reminderKey } from "../lib/iptv";
import { useI18n } from "../lib/locale-context";

/** An announced reminder stays on screen this long unless answered. */
const SHOW_MS = 3 * 60_000;

/**
 * The cards of this window, kept outside React: the player overlay remounts on every
 * channel change and next episode, and a card still waiting must survive that.
 */
let pending: Reminder[] = [];
let listening = false;
const listeners = new Set<() => void>();

function setPending(next: Reminder[]) {
  pending = next;
  for (const listener of listeners) listener();
}

function drop(key: string) {
  setPending(pending.filter((r) => reminderKey(r.channelId, r.start) !== key));
}

function listen() {
  if (listening) return;
  listening = true;
  void api.onIptvReminder((reminder) => {
    const key = reminderKey(reminder.channelId, reminder.start);
    setPending([...pending.filter((r) => reminderKey(r.channelId, r.start) !== key), reminder]);
    window.setTimeout(() => drop(key), SHOW_MS);
  });
  // Answered in the other window (main or player overlay): gone here too.
  void api.onIptvReminderDismissed(drop);
}

function subscribe(listener: () => void) {
  listen();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Cards for the reminders Rust announces (`iptv://reminder`, a minute before the start):
 * logo, programme and "Watch now". Both windows mount it; each shows it only while it is
 * the one in front (`enabled`): the main window when nothing plays, the player overlay
 * while watching.
 */
export function ReminderAlerts({ enabled, onWatch }: { enabled: boolean; onWatch: (reminder: Reminder) => void }) {
  const { t, locale } = useI18n();
  const alerts = useSyncExternalStore(subscribe, () => pending);
  const [now, setNow] = useState(() => Date.now());

  // A new card must not read a stale "now" (the clock only ticks while cards are up).
  useEffect(() => {
    setNow(Date.now());
  }, [alerts]);

  // "Starts in a minute" turns into "Already started" on its own.
  useEffect(() => {
    if (!alerts.length) return;
    const handle = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(handle);
  }, [alerts.length]);

  if (!enabled || !alerts.length) return null;

  const dismiss = (reminder: Reminder) => {
    drop(reminderKey(reminder.channelId, reminder.start));
    void api.dismissIptvReminder(reminderKey(reminder.channelId, reminder.start));
  };

  return (
    <div
      role="alert"
      className="pointer-events-none fixed top-20 left-1/2 z-[85] flex w-[min(460px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2"
    >
      {alerts.map((reminder) => (
        <div
          key={reminderKey(reminder.channelId, reminder.start)}
          className="toast-enter pointer-events-auto flex items-center gap-3 rounded-2xl bg-panel/95 p-3 pr-2 text-text shadow-[0_16px_40px_rgb(0_0_0_/_0.5),0_0_0_1px_rgb(255_255_255_/_0.1)] backdrop-blur-md"
        >
          <span className="grid h-12 w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/6 p-1.5">
            {reminder.logo ? (
              <img src={reminder.logo} alt="" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-[13px] font-bold text-white/70">{channelInitials(reminder.channelName)}</span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-accent uppercase">
              <BellRing size={12} aria-hidden />
              {reminder.start * 1000 > now ? t("reminderSoon") : t("reminderNow")}
            </p>
            <p className="truncate text-[14px] font-semibold">{reminder.title}</p>
            <p className="truncate text-[12px] text-dim">
              {reminder.channelName} · <span className="tabular">{formatTime(reminder.start, locale)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              dismiss(reminder);
              onWatch(reminder);
            }}
            className="btn-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill bg-accent px-3.5 text-[13px] font-semibold text-on-accent hover:bg-accent-hover"
          >
            <Play size={14} fill="currentColor" />
            {t("watchNow")}
          </button>
          <button
            type="button"
            aria-label={t("close")}
            onClick={() => dismiss(reminder)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-dim hover:bg-white/10 hover:text-text"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
