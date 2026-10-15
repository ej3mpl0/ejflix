import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Globe, Play, RotateCcw } from "lucide-react";
import type { Movie } from "../lib/types";
import { useI18n } from "../lib/locale-context";
import { cn, episodeCode } from "../lib/format";
import { DAYS_BACK, markCalendarSeen, useCalendar, type CalendarEntry } from "../lib/calendar";
import { WatchedBadge } from "../components/WatchedBadge";
import { Pill } from "../components/Pill";
import { Shimmer } from "../components/Shimmer";

function dayStart(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Monday 00:00 of the week `offset` weeks from this one. */
function weekStart(offset: number): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  const fromMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - fromMonday + offset * 7);
  return date.getTime();
}

function EntryCard({
  entry,
  fresh,
  aired,
  onOpen,
  onPlay,
}: {
  entry: CalendarEntry;
  fresh: boolean;
  aired: boolean;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const episode = entry.episode;
  const code = episodeCode(episode, t("episodeCode"));
  const image = episode.thumbUrl ?? episode.backdropUrl ?? episode.posterUrl;

  return (
    <div className="group/ep relative overflow-hidden rounded-xl bg-base" data-item-id={episode.id}>
      <button
        type="button"
        onClick={() => onOpen(episode)}
        className="block w-full text-left"
        aria-label={`${episode.seriesName ?? ""} ${code} ${episode.name}`.trim()}
      >
        <span className="relative block aspect-video w-full overflow-hidden bg-panel">
          {image ? <img src={image} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
          {fresh ? (
            <span className="pointer-events-none absolute top-1.5 left-1.5 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-on-accent shadow-[0_2px_8px_rgb(0_0_0_/_0.5)]">
              {t("newBadge")}
            </span>
          ) : null}
          {episode.external ? (
            <span className="pointer-events-none absolute right-1.5 bottom-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white/80 backdrop-blur-sm" title={t("online")}>
              <Globe size={13} />
            </span>
          ) : (
            <WatchedBadge movie={episode} className="absolute top-1.5 right-1.5" />
          )}
        </span>
        <span className="block px-2.5 pt-2 pb-2.5">
          <span className="block truncate text-[13.5px] font-semibold text-text">{episode.seriesName ?? episode.name}</span>
          <span className="block truncate text-[12px] text-muted">{code || episode.name}</span>
        </span>
      </button>
      {aired ? (
        <button
          type="button"
          onClick={() => onPlay(episode)}
          aria-label={`${t("play")} ${code} ${episode.name}`}
          className="btn-play btn-press absolute top-[calc(28%)] left-1/2 grid h-10 w-10 -translate-x-1/2 place-items-center rounded-full bg-accent text-on-accent opacity-0 transition-opacity duration-150 group-hover/ep:opacity-100 focus-visible:opacity-100"
        >
          <Play size={17} fill="currentColor" className="translate-x-px" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The episodes of the series the user follows as a real week, Monday to Sunday: today
 * carries the dot of the j, past days dim, and what aired since the last visit says New.
 * Opening it is what "seen" means for the new-episode badges on Home.
 */
export function CalendarPage({
  userId,
  hasServer,
  onOpen,
  onPlay,
}: {
  userId: string;
  hasServer: boolean;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
}) {
  const { t, locale } = useI18n();
  const { entries, loading, seen, isNew, reload } = useCalendar(hasServer, userId);
  /** When the calendar had last been seen before this visit: the badges count from there. */
  const [since, setSince] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (seen == null || since != null) return;
    setSince(seen);
    markCalendarSeen();
  }, [seen, since]);

  const start = weekStart(offset);
  const today = dayStart(Date.now());
  const days = useMemo(() => {
    const list: { day: number; items: CalendarEntry[] }[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      list.push({ day: date.getTime(), items: [] });
    }
    for (const entry of entries ?? []) {
      const slot = list.find((d) => d.day === dayStart(entry.airs));
      if (slot) slot.items.push(entry);
    }
    return list;
  }, [entries, start]);

  // The calendar only knows DAYS_BACK days back and two months ahead.
  const minOffset = -Math.ceil(DAYS_BACK / 7);
  const maxOffset = 8;
  const title =
    offset === 0 ? t("weekThis") : offset === -1 ? t("weekLast") : offset === 1 ? t("weekNext") : t("weekOf");
  const fmt = (ms: number, withMonth: boolean) =>
    new Intl.DateTimeFormat(locale, withMonth ? { day: "numeric", month: "long" } : { day: "numeric" }).format(ms);
  const end = days[6].day;
  const sameMonth = new Date(start).getMonth() === new Date(end).getMonth();
  const range = t("weekRange", { from: fmt(start, !sameMonth), to: fmt(end, true) });
  const empty = !loading && days.every((d) => !d.items.length);

  return (
    <div className="page-enter px-page pt-28 pb-16">
      <div className="mb-7 flex flex-wrap items-center gap-3.5">
        <h1 className="mr-1 text-[40px] leading-none font-extrabold tracking-[-0.025em]">{title}</h1>
        <button
          type="button"
          onClick={() => setOffset((n) => Math.max(minOffset, n - 1))}
          disabled={offset <= minOffset}
          aria-label={t("weekPrevious")}
          className="btn-press grid h-10 w-10 place-items-center rounded-full bg-surface hover:bg-panel disabled:opacity-40"
        >
          <ChevronLeft size={19} />
        </button>
        <button
          type="button"
          onClick={() => setOffset((n) => Math.min(maxOffset, n + 1))}
          disabled={offset >= maxOffset}
          aria-label={t("weekFollowing")}
          className="btn-press grid h-10 w-10 place-items-center rounded-full bg-surface hover:bg-panel disabled:opacity-40"
        >
          <ChevronRight size={19} />
        </button>
        <span className="text-[14px] text-muted">{range}</span>
        <span className="ml-auto flex items-center gap-2">
          {offset !== 0 ? (
            <Pill variant="tonal" size="sm" onClick={() => setOffset(0)}>
              {t("today")}
            </Pill>
          ) : null}
          <Pill variant="ghost" size="sm" icon={<RotateCcw size={15} />} onClick={reload} disabled={loading}>
            {t("refresh")}
          </Pill>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-7">
        {days.map(({ day, items }) => {
          const isToday = day === today;
          const past = day < today;
          const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(day).replace(".", "");
          return (
            <section
              key={day}
              aria-label={new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(day)}
              className={cn(
                "flex min-h-[420px] flex-col gap-2.5 rounded-card p-2.5 pt-3.5",
                isToday ? "bg-panel" : "bg-surface",
                past && "opacity-60",
              )}
            >
              <h2 className="flex items-baseline gap-2 px-1.5">
                <span className="relative text-[26px] leading-none font-bold tabular">
                  {isToday ? (
                    <span aria-hidden className="absolute -top-2 left-1/2 h-[7px] w-[7px] -translate-x-1/2 rounded-full bg-live" />
                  ) : null}
                  {new Date(day).getDate()}
                </span>
                <span className="font-sans text-[13px] font-medium text-muted first-letter:uppercase">
                  {weekday}
                  {isToday ? `, ${t("today").toLowerCase()}` : ""}
                </span>
              </h2>
              {loading ? (
                <Shimmer className="aspect-video rounded-xl" />
              ) : items.length ? (
                items.map((entry) => (
                  <EntryCard
                    key={entry.episode.id}
                    entry={entry}
                    fresh={isNew(entry, since)}
                    aired={entry.airs <= Date.now()}
                    onOpen={onOpen}
                    onPlay={onPlay}
                  />
                ))
              ) : (
                <p className="px-1.5 text-[13px] text-dim">{past ? t("calendarNothingNew") : t("calendarNoPremieres")}</p>
              )}
            </section>
          );
        })}
      </div>
      {empty ? <p className="mt-6 text-center text-[13.5px] text-muted">{t("calendarEmptyHint")}</p> : null}
    </div>
  );
}
