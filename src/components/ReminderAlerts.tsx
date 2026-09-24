import { useEffect, useState } from "react";
import { BellRing, Play, X } from "lucide-react";
import type { Reminder } from "../lib/types";
import { api } from "../lib/api";
import { channelInitials, formatTime, reminderKey } from "../lib/iptv";
import { useI18n } from "../lib/locale-context";

/** An announced reminder stays on screen this long unless answered. */
const SHOW_MS = 3 * 60_000;

/**
 * Cards for the reminders Rust announces (`iptv://reminder`, a minute before the start):
 * logo, programme and "Watch now". Both windows mount it; each shows it only while it is
 * the one in front (`enabled`): the main window when nothing plays, the player overlay
 * while watching.
 */
export function ReminderAlerts({ enabled, onWatch }: { enabled: boolean; onWatch: (reminder: Reminder) => void }) {
  const { t, locale } = useI18n();
  const [alerts, setAlerts] = useState<Reminder[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timers = new Set<number>();
    const unlisten = api.onIptvReminder((reminder) => {
      const key = reminderKey(reminder.channelId, reminder.start);
      setAlerts((list) => [...list.filter((r) => reminderKey(r.channelId, r.start) !== key), reminder]);
      const handle = window.setTimeout(() => {
        timers.delete(handle);
        setAlerts((list) => list.filter((r) => reminderKey(r.channelId, r.start) !== key));
      }, SHOW_MS);
      timers.add(handle);
    });
    // Answered in the other window (main or player overlay): gone here too.
    const unlistenDismissed = api.onIptvReminderDismissed((key) =>
      setAlerts((list) => list.filter((r) => reminderKey(r.channelId, r.start) !== key)),
    );
    return () => {
      void unlisten.then((fn) => fn());
      void unlistenDismissed.then((fn) => fn());
      timers.forEach((handle) => window.clearTimeout(handle));
    };
  }, []);

  // "Starts in a minute" turns into "Already started" on its own.
  useEffect(() => {
    if (!alerts.length) return;
    const handle = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(handle);
  }, [alerts.length]);

  if (!enabled || !alerts.length) return null;

  const dismiss = (reminder: Reminder) => {
    setAlerts((list) => list.filter((r) => r !== reminder));
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
