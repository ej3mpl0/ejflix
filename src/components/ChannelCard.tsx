import { useState } from "react";
import { Grid2x2Check, Grid2x2Plus, History, Play, Star } from "lucide-react";
import type { Channel, EpgNow } from "../lib/types";
import { cn } from "../lib/format";
import { channelInitials, formatRange, formatTime, programmeProgress } from "../lib/iptv";
import { useI18n } from "../lib/locale-context";

/**
 * Channel tile: logo on a dark 16:9 plate, name, programme on air with its progress
 * (or the group when there is no guide) and a star to keep it in Favorites.
 *
 * Every tile has the same height: the plate is a fixed 16:9 box whose content is
 * absolutely positioned (a tall logo cannot stretch it), logos share one bounding box
 * so small and large images look alike, and the text block is two single lines.
 */
export function ChannelCard({
  channel,
  epg,
  onPlay,
  onFavorite,
  multiview,
  delay = 0,
}: {
  channel: Channel;
  epg?: EpgNow;
  onPlay: (channel: Channel) => void;
  onFavorite: (channel: Channel, on: boolean) => void;
  /** "Add to multi-view" toggle (live channels only). */
  multiview?: { active: boolean; onToggle: (channel: Channel) => void };
  delay?: number;
}) {
  const { t, locale } = useI18n();
  const [broken, setBroken] = useState(false);
  const now = epg?.now ?? null;
  const next = epg?.next ?? null;
  const progress = now ? programmeProgress(now) : 0;
  const line = "block overflow-hidden text-ellipsis whitespace-nowrap";

  return (
    <div className="group relative" style={{ animationDelay: `${delay}ms` }} data-item-id={`live:${channel.id}`}>
      <button
        type="button"
        onClick={() => onPlay(channel)}
        className="card-depth block w-full overflow-hidden rounded-poster bg-surface text-left transition-colors duration-150 hover:bg-panel"
        aria-label={`${t("play")} ${channel.name}`}
      >
        <div className="relative aspect-video w-full overflow-hidden bg-[radial-gradient(120%_100%_at_50%_0%,rgb(255_255_255_/_0.07),transparent_70%)]">
          {channel.logo && !broken ? (
            <img
              src={channel.logo}
              alt=""
              loading="lazy"
              onError={() => setBroken(true)}
              className="absolute inset-0 m-auto h-[56%] w-[68%] rounded-md object-contain drop-shadow-[0_4px_12px_rgb(0_0_0_/_0.5)]"
            />
          ) : (
            <span className="absolute inset-0 m-auto grid h-14 w-14 place-items-center rounded-2xl bg-white/8 text-[20px] font-bold tracking-wide text-white/80">
              {channelInitials(channel.name)}
            </span>
          )}
          {channel.number != null ? (
            <span className="absolute top-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white/85 tabular backdrop-blur-sm">
              {channel.number}
            </span>
          ) : null}
          {channel.kind === "movie" ? (
            <span className="absolute bottom-2 left-2 rounded-[4px] bg-white/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white/70 uppercase">
              VOD
            </span>
          ) : (channel.catchupDays ?? 0) > 0 ? (
            <span
              className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-[4px] bg-white/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white/70 uppercase"
              title={t("catchupDays", { n: channel.catchupDays ?? 0 })}
            >
              <History size={10} aria-hidden />
              {t("catchup")}
            </span>
          ) : null}
          <span className="btn-play absolute top-1/2 left-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-black opacity-0 shadow-[0_6px_20px_rgb(0_0_0_/_0.45)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
            <Play size={18} fill="currentColor" className="translate-x-px" />
          </span>
          {now ? (
            <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/15">
              <div className="h-full bg-accent transition-[width] duration-700" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </div>
        <div className="h-[72px] px-3 py-2.5">
          <span className={cn(line, "text-[13px] leading-[18px] font-medium text-text group-hover:text-white")} title={channel.name}>
            {channel.name}
          </span>
          {now ? (
            <span className={cn(line, "text-[11px] leading-[16px] text-dim")} title={now.title}>
              <span className="tabular">{formatRange(now, locale)}</span>
              <span> · </span>
              <span className="text-muted">{now.title}</span>
            </span>
          ) : (
            <span className={cn(line, "text-[11px] leading-[16px] text-dim")}>{channel.group || t("noGroup")}</span>
          )}
          {next ? (
            <span className={cn(line, "text-[11px] leading-[16px] text-dim")} title={next.title}>
              {t("upNext")} <span className="tabular">{formatTime(next.start, locale)}</span> · {next.title}
            </span>
          ) : null}
        </div>
      </button>
      <button
        type="button"
        onClick={() => onFavorite(channel, !channel.favorite)}
        aria-label={channel.favorite ? t("removeFavorite") : t("addFavorite")}
        aria-pressed={channel.favorite}
        title={channel.favorite ? t("removeFavorite") : t("addFavorite")}
        className={cn(
          // Not `icon-hit`: that class sets position: relative and would pull the star out of the card.
          "absolute top-2 right-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm transition-opacity duration-150 hover:bg-black/75 hover:text-white",
          channel.favorite ? "text-star opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <Star size={15} fill={channel.favorite ? "currentColor" : "none"} />
      </button>
      {multiview && channel.kind === "live" ? (
        <button
          type="button"
          onClick={() => multiview.onToggle(channel)}
          aria-label={multiview.active ? t("multiviewRemove") : t("multiviewAdd")}
          aria-pressed={multiview.active}
          title={multiview.active ? t("multiviewRemove") : t("multiviewAdd")}
          className={cn(
            "absolute top-2 right-11 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm transition-opacity duration-150 hover:bg-black/75 hover:text-white",
            multiview.active ? "text-accent opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          {multiview.active ? <Grid2x2Check size={15} /> : <Grid2x2Plus size={15} />}
        </button>
      ) : null}
    </div>
  );
}
