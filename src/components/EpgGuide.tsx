import { useEffect, useMemo, useRef, useState } from "react";
import type { Channel, Programme } from "../lib/types";
import { api } from "../lib/api";
import { channelInitials, formatTime } from "../lib/iptv";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";

const HOUR_PX = 280;
const SPAN_HOURS = 6;
const ROW_H = 60;
const NAME_W = 190;
const MAX_CHANNELS = 60;

/**
 * Programme guide: the channels on screen (those with a guide) against a six-hour
 * timeline that starts half an hour ago, with a line on "now". A click on a programme
 * or a channel plays that channel.
 */
export function EpgGuide({ channels, onPlay }: { channels: Channel[]; onPlay: (channel: Channel) => void }) {
  const { t, locale } = useI18n();
  const withGuide = useMemo(() => channels.filter((c) => c.epg).slice(0, MAX_CHANNELS), [channels]);
  const [guide, setGuide] = useState<Record<string, Programme[]>>({});
  const [now, setNow] = useState(() => Date.now() / 1000);
  const scroller = useRef<HTMLDivElement>(null);
  // Timeline origin: the last half hour boundary before "now - 30 min".
  const origin = useMemo(() => Math.floor((Date.now() / 1000 - 1800) / 1800) * 1800, []);
  const end = origin + SPAN_HOURS * 3600;
  const x = (seconds: number) => ((seconds - origin) / 3600) * HOUR_PX;

  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => window.clearInterval(handle);
  }, []);

  // Fetch the guide of each channel once, a few at a time.
  useEffect(() => {
    let alive = true;
    const missing = withGuide.filter((c) => !guide[c.id]);
    void (async () => {
      for (let i = 0; i < missing.length; i += 6) {
        const batch = missing.slice(i, i + 6);
        const results = await Promise.all(batch.map((c) => api.iptvEpgChannel(c.id).catch(() => [] as Programme[])));
        if (!alive) return;
        setGuide((current) => {
          const next = { ...current };
          batch.forEach((c, k) => (next[c.id] = results[k]));
          return next;
        });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withGuide]);

  if (!withGuide.length) {
    return <p className="rounded-card bg-surface px-6 py-10 text-center text-[14px] text-muted">{t("guideEmpty")}</p>;
  }

  const hours = Array.from({ length: SPAN_HOURS * 2 }, (_, i) => origin + i * 1800);

  return (
    <div ref={scroller} className="overflow-x-auto rounded-card bg-surface">
      <div className="relative" style={{ width: NAME_W + SPAN_HOURS * HOUR_PX }}>
        {/* Time ruler */}
        <div className="sticky top-0 z-20 flex h-9 border-b border-white/8 bg-surface">
          <div className="sticky left-0 z-10 shrink-0 bg-surface" style={{ width: NAME_W }} />
          <div className="relative flex-1">
            {hours.map((h) => (
              <span
                key={h}
                className="absolute top-0 flex h-full items-center border-l border-white/8 pl-2 text-[11px] text-dim tabular"
                style={{ left: x(h) }}
              >
                {formatTime(h, locale)}
              </span>
            ))}
          </div>
        </div>
        {/* "Now" line */}
        {now > origin && now < end ? (
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-accent"
            style={{ left: NAME_W + x(now) }}
            aria-hidden
          />
        ) : null}
        {withGuide.map((channel) => {
          const programmes = (guide[channel.id] ?? []).filter((p) => p.stop > origin && p.start < end);
          return (
            <div key={channel.id} className="flex border-b border-white/5" style={{ height: ROW_H }}>
              <button
                type="button"
                onClick={() => onPlay(channel)}
                className="sticky left-0 z-10 flex shrink-0 items-center gap-2.5 border-r border-white/8 bg-surface px-3 text-left hover:bg-panel"
                style={{ width: NAME_W }}
                title={channel.name}
              >
                <span className="grid h-9 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-white/6 p-1">
                  {channel.logo ? (
                    <img src={channel.logo} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-[11px] font-bold text-white/70">{channelInitials(channel.name)}</span>
                  )}
                </span>
                <span className="min-w-0 truncate text-[13px] font-medium">{channel.name}</span>
              </button>
              <div className="relative flex-1">
                {guide[channel.id] && !programmes.length ? (
                  <span className="absolute inset-y-0 left-3 flex items-center text-[12px] text-dim">{t("guideNoData")}</span>
                ) : null}
                {programmes.map((p) => {
                  const left = Math.max(0, x(p.start));
                  const width = Math.max(4, x(Math.min(p.stop, end)) - left - 2);
                  const live = p.start <= now && now < p.stop;
                  return (
                    <button
                      key={`${p.start}:${p.title}`}
                      type="button"
                      onClick={() => onPlay(channel)}
                      title={`${formatTime(p.start, locale)}–${formatTime(p.stop, locale)} · ${p.title}${p.desc ? `\n${p.desc}` : ""}`}
                      className={cn(
                        "absolute top-1.5 bottom-1.5 overflow-hidden rounded-lg px-2.5 text-left transition-colors",
                        live ? "bg-accent-soft ring-1 ring-accent/40 hover:bg-accent/25" : "bg-white/6 hover:bg-white/12",
                      )}
                      style={{ left: left + 1, width }}
                    >
                      <span className="block truncate text-[12.5px] font-medium text-text">{p.title}</span>
                      <span className="block truncate text-[11px] text-dim tabular">
                        {formatTime(p.start, locale)} – {formatTime(p.stop, locale)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
