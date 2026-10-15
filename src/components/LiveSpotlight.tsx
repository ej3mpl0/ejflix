import { useState } from "react";
import { Grid2x2Check, Grid2x2Plus, Play, Star } from "lucide-react";
import type { Channel, EpgNow } from "../lib/types";
import { channelInitials, formatRange, programmeProgress } from "../lib/iptv";
import { useI18n } from "../lib/locale-context";
import { cn } from "../lib/format";
import { Pill } from "./Pill";

/**
 * The channel in focus at the top of Live TV: what it is showing now, how far along it is
 * and how long is left, with Play right there. The red dot says it is on air.
 */
export function LiveSpotlight({
  channel,
  epg,
  sourceName,
  onPlay,
  onFavorite,
  multiview,
}: {
  channel: Channel;
  epg?: EpgNow;
  sourceName?: string;
  onPlay: (channel: Channel) => void;
  onFavorite: (channel: Channel, on: boolean) => void;
  multiview?: { active: boolean; onToggle: (channel: Channel) => void };
}) {
  const { t, locale } = useI18n();
  const [broken, setBroken] = useState(false);
  const now = epg?.now ?? null;
  const next = epg?.next ?? null;
  const left = now ? Math.max(0, Math.round((now.stop - Date.now() / 1000) / 60)) : 0;
  const logo =
    channel.logo && !broken ? (
      <img src={channel.logo} alt="" onError={() => setBroken(true)} className="max-h-full max-w-full object-contain" />
    ) : (
      <span className="font-display text-[15px] font-extrabold">{channelInitials(channel.name)}</span>
    );

  return (
    <section className="mb-8 grid items-center gap-8 md:grid-cols-[minmax(0,560px)_minmax(0,1fr)]" aria-label={channel.name}>
      <button
        type="button"
        onClick={() => onPlay(channel)}
        aria-label={`${t("watchLive")} ${channel.name}`}
        className="group relative aspect-video w-full overflow-hidden rounded-card bg-[radial-gradient(120%_100%_at_50%_0%,rgb(255_255_255_/_0.08),transparent_70%),var(--color-surface)]"
      >
        <span className="absolute inset-0 m-auto grid h-[46%] w-[54%] place-items-center">
          {channel.logo && !broken ? (
            <img
              src={channel.logo}
              alt=""
              onError={() => setBroken(true)}
              className="max-h-full max-w-full object-contain drop-shadow-[0_6px_18px_rgb(0_0_0_/_0.55)]"
            />
          ) : (
            <span className="font-display text-[56px] font-extrabold text-white/80">{channelInitials(channel.name)}</span>
          )}
        </span>
        <span className="absolute top-3.5 left-3.5 inline-flex h-7 items-center gap-2 rounded-pill bg-black/70 px-3 text-[13px] font-semibold">
          <span className="h-[7px] w-[7px] rounded-full bg-live shadow-[0_0_0_4px_var(--color-live-soft)]" />
          {t("liveBadge")}
        </span>
        <span className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="btn-play grid h-14 w-14 place-items-center rounded-full bg-accent text-on-accent">
            <Play size={24} fill="currentColor" />
          </span>
        </span>
      </button>

      <div className="min-w-0">
        <div className="flex items-center gap-3 text-[14px] text-muted">
          <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-accent p-1.5 text-on-accent">
            {logo}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-text">{channel.name}</span>
            <span className="block truncate">
              {[channel.number != null ? t("channelNumber", { n: channel.number }) : null, channel.group || null, sourceName || null]
                .filter(Boolean)
                .join(", ")}
            </span>
          </span>
        </div>
        <h2 className="mt-4 mb-2 truncate text-[30px] font-bold tracking-[-0.015em]">
          {now?.title ?? channel.name}
        </h2>
        {now ? (
          <div className="flex flex-wrap items-center gap-3 text-[14px] text-muted tabular">
            <span>{formatRange(now, locale)}</span>
            <span className="relative h-[3px] w-[180px] rounded-full bg-line">
              <span className="absolute inset-y-0 left-0 rounded-full bg-live" style={{ width: `${programmeProgress(now)}%` }} />
            </span>
            <span>{t("minutesLeft", { n: left })}</span>
          </div>
        ) : (
          <p className="text-[14px] text-muted">{t("noGuideInfo")}</p>
        )}
        {now?.desc ? (
          <p className="mt-3 line-clamp-3 max-w-[56ch] text-[15px] leading-[1.55] text-text/74">{now.desc}</p>
        ) : null}
        {next ? (
          <p className="mt-2 truncate text-[13.5px] text-dim">
            {t("nextProgramme")}: <span className="text-muted">{next.title}</span>
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <Pill variant="primary" icon={<Play size={16} fill="currentColor" />} className="btn-play" onClick={() => onPlay(channel)}>
            {t("watchLive")}
          </Pill>
          {multiview && channel.kind === "live" ? (
            <Pill
              variant="tonal"
              icon={multiview.active ? <Grid2x2Check size={16} /> : <Grid2x2Plus size={16} />}
              aria-pressed={multiview.active}
              onClick={() => multiview.onToggle(channel)}
            >
              {multiview.active ? t("multiviewRemove") : t("multiviewAdd")}
            </Pill>
          ) : null}
          <button
            type="button"
            onClick={() => onFavorite(channel, !channel.favorite)}
            aria-pressed={channel.favorite}
            aria-label={channel.favorite ? t("removeFavorite") : t("addFavorite")}
            title={channel.favorite ? t("removeFavorite") : t("addFavorite")}
            className="btn-press grid h-11 w-11 place-items-center rounded-full bg-white/12 hover:bg-white/18"
          >
            <Star size={17} className={cn(channel.favorite && "fill-star text-star")} />
          </button>
        </div>
      </div>
    </section>
  );
}
