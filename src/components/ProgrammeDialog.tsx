import { Bell, BellOff, History, Play, Tv, X } from "lucide-react";
import type { Channel, Programme } from "../lib/types";
import { canCatchup, channelInitials, formatTime, formatWhen } from "../lib/iptv";
import { useI18n } from "../lib/locale-context";
import { Dialog } from "./Dialog";
import { Pill } from "./Pill";

/**
 * A programme of the guide: what it is and when, plus what can be done with it —
 * a reminder when it has not started, the archive when it already aired on a channel
 * with catch-up, and the live channel always.
 */
export function ProgrammeDialog({
  channel,
  programme,
  reminded,
  onToggleReminder,
  onPlayLive,
  onCatchup,
  onClose,
}: {
  channel: Channel;
  programme: Programme;
  reminded: boolean;
  onToggleReminder: (on: boolean) => void;
  onPlayLive: () => void;
  onCatchup: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const now = Date.now() / 1000;
  const upcoming = programme.start > now;
  const aired = programme.stop <= now;
  const archived = canCatchup(channel, programme);
  const status = upcoming
    ? t("programmeUpcoming")
    : aired
      ? archived
        ? t("catchupAvailable")
        : t("programmeEnded")
      : t("liveBadge");

  return (
    <Dialog
      labelledBy="programme-title"
      onEscape={onClose}
      onBackdrop={onClose}
      className="relative flex max-h-[calc(100vh-2rem)] w-[min(480px,92vw)] flex-col rounded-card bg-surface p-6 shadow-[0_24px_64px_rgb(0_0_0_/_0.45),0_0_0_1px_rgb(255_255_255_/_0.06)]"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t("close")}
        className="icon-hit absolute top-4 right-4 grid h-8 w-8 place-items-center rounded-full text-dim hover:bg-white/10 hover:text-text"
      >
        <X size={16} />
      </button>
      <div className="mb-4 flex items-center gap-3 pr-10">
        <span className="grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-md bg-white/6 p-1">
          {channel.logo ? (
            <img src={channel.logo} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-[12px] font-bold text-white/70">{channelInitials(channel.name)}</span>
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-muted">{channel.name}</p>
          <p className="text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">{status}</p>
        </div>
      </div>
      <h2 id="programme-title" className="text-[20px] leading-tight font-semibold">
        {programme.title}
      </h2>
      <p className="mt-1.5 text-[13px] text-dim tabular">
        {formatWhen(programme.start, locale)} – {formatTime(programme.stop, locale)}
        {programme.category ? ` · ${programme.category}` : ""}
      </p>
      {programme.desc ? (
        <p className="mt-4 min-h-0 flex-1 overflow-y-auto text-[14px] leading-[1.6] text-muted">{programme.desc}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-2">
        {upcoming ? (
          <Pill
            variant={reminded ? "tonal" : "primary"}
            data-autofocus
            icon={reminded ? <BellOff size={16} /> : <Bell size={16} />}
            onClick={() => onToggleReminder(!reminded)}
          >
            {reminded ? t("reminderCancel") : t("remindMe")}
          </Pill>
        ) : null}
        {aired && archived ? (
          <Pill variant="primary" data-autofocus icon={<History size={16} />} onClick={onCatchup}>
            {t("catchupWatch")}
          </Pill>
        ) : null}
        <Pill
          variant={upcoming || (aired && archived) ? "tonal" : "primary"}
          icon={aired || upcoming ? <Tv size={16} /> : <Play size={16} fill="currentColor" />}
          onClick={onPlayLive}
        >
          {t("watchLive")}
        </Pill>
      </div>
    </Dialog>
  );
}
