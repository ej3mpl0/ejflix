import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Globe, Play, RotateCcw } from "lucide-react";
import type { Movie } from "../lib/types";
import { useI18n } from "../lib/locale-context";
import { episodeCode } from "../lib/format";
import { DAYS_BACK, markCalendarSeen, useCalendar, type CalendarEntry } from "../lib/calendar";
import { SegmentedControl } from "../components/settings/SegmentedControl";
import { EpisodeListSkeleton } from "../components/Skeletons";
import { EmptyState } from "../components/EmptyState";
import { WatchedBadge } from "../components/WatchedBadge";
import { Pill } from "../components/Pill";

type Tab = "upcoming" | "recent";

const DAY_MS = 86_400_000;

function dayStart(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function EntryRow({
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
  const days = Math.round((dayStart(entry.airs) - dayStart(Date.now())) / DAY_MS);

  return (
    <div className="group/ep relative flex w-full items-center gap-4 rounded-xl p-2 transition-colors duration-150 hover:bg-white/5" data-item-id={episode.id}>
      <button
        type="button"
        onClick={() => onOpen(episode)}
        className="img-outline relative aspect-video w-[168px] shrink-0 overflow-hidden rounded-poster bg-panel text-left"
        aria-label={`${episode.seriesName ?? ""} ${code} ${episode.name}`.trim()}
      >
        {image ? <img src={image} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
        {fresh ? (
          <span className="pointer-events-none absolute top-1.5 left-1.5 rounded-[4px] bg-accent px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-on-accent uppercase shadow-[0_2px_8px_rgb(0_0_0_/_0.5)]">
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
      </button>
      <button type="button" onClick={() => onOpen(episode)} className="min-w-0 flex-1 py-1 text-left">
        <p className="truncate text-[15px] font-semibold text-white">{episode.seriesName ?? episode.name}</p>
        <p className="truncate text-[13px] text-muted">{[code, episode.name].filter(Boolean).join(" · ")}</p>
        {!aired ? (
          <p className="text-[12px] text-dim tabular">{days <= 1 ? t("airsTomorrow") : t("airsInDays", { n: days })}</p>
        ) : null}
      </button>
      {aired ? (
        <button
          type="button"
          onClick={() => onPlay(episode)}
          aria-label={`${t("play")} ${code} ${episode.name}`}
          className="btn-play btn-press mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/90 text-black opacity-0 transition-opacity duration-150 group-hover/ep:opacity-100 focus-visible:opacity-100"
        >
          <Play size={17} fill="currentColor" className="translate-x-px" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Upcoming and recently aired episodes of the series the user follows, one section per
 * day. Opening it is what "seen" means for the new-episode badges on Home.
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
  const [tab, setTab] = useState<Tab | null>(null);

  useEffect(() => {
    if (seen == null || since != null) return;
    setSince(seen);
    markCalendarSeen();
  }, [seen, since]);

  // Open on what is new, if there is anything; else on what is coming.
  useEffect(() => {
    if (tab != null || entries == null || since == null) return;
    const now = Date.now();
    const upcoming = entries.some((entry) => entry.airs > now);
    const anyNew = entries.some((entry) => isNew(entry, since));
    setTab(anyNew || !upcoming ? "recent" : "upcoming");
  }, [tab, entries, since, isNew]);

  const current: Tab = tab ?? "upcoming";
  const groups = useMemo(() => {
    const now = Date.now();
    const list = (entries ?? []).filter((entry) => (current === "upcoming" ? entry.airs > now : entry.airs <= now));
    if (current === "recent") list.reverse();
    const out: { day: number; items: CalendarEntry[] }[] = [];
    for (const entry of list) {
      const day = dayStart(entry.airs);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(entry);
      else out.push({ day, items: [entry] });
    }
    return out;
  }, [entries, current]);

  const dayLabel = (day: number) => {
    const diff = Math.round((day - dayStart(Date.now())) / DAY_MS);
    if (diff === 0) return t("today");
    if (diff === 1) return t("tomorrow");
    if (diff === -1) return t("yesterday");
    const text = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(day);
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  return (
    <div className="page-enter px-page pt-24 pb-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-[28px] font-semibold tracking-[-0.02em]">
            <CalendarDays size={26} className="text-accent" />
            {t("calendar")}
          </h1>
          <p className="mt-1 text-[13px] text-dim">{t("calendarHint")}</p>
        </div>
        <Pill variant="ghost" pill icon={<RotateCcw size={15} />} onClick={reload} disabled={loading}>
          {t("refresh")}
        </Pill>
      </div>

      <div className="mb-6">
        <SegmentedControl<Tab>
          label={t("calendar")}
          value={current}
          options={[
            { value: "upcoming", label: t("calendarUpcoming") },
            { value: "recent", label: t("calendarRecent", { n: DAYS_BACK }) },
          ]}
          onChange={setTab}
        />
      </div>

      {loading ? (
        <EpisodeListSkeleton />
      ) : groups.length ? (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.day}>
              <h2 className="mb-2 text-[15px] font-semibold text-text/90">{dayLabel(group.day)}</h2>
              <div className="space-y-1">
                {group.items.map((entry) => (
                  <EntryRow
                    key={entry.episode.id}
                    entry={entry}
                    fresh={isNew(entry, since)}
                    aired={current === "recent"}
                    onOpen={onOpen}
                    onPlay={onPlay}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          large
          icon={<CalendarDays size={26} />}
          title={current === "upcoming" ? t("calendarEmptyUpcoming") : t("calendarEmptyRecent")}
          hint={t("calendarEmptyHint")}
        />
      )}
    </div>
  );
}
