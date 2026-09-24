import { useEffect, useState } from "react";
import { Star, X } from "lucide-react";
import type { Channel, LiveRef } from "../lib/types";
import { api } from "../lib/api";
import { cn } from "../lib/format";
import { channelInitials, programmeProgress } from "../lib/iptv";
import { useI18n } from "../lib/locale-context";
import { Chip } from "./Chip";
import { Shimmer } from "./Shimmer";
import { useEpgNow } from "../hooks/useEpgNow";

type Tab = "group" | "favorites";

/** Logo tile of a row; falls back to the initials when the image is missing or broken. */
function RowLogo({ channel }: { channel: Channel }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="grid h-12 w-[84px] shrink-0 place-items-center overflow-hidden rounded-md bg-white/6 p-1.5">
      {channel.logo && !broken ? (
        <img
          src={channel.logo}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <span className="text-[13px] font-bold text-white/70">{channelInitials(channel.name)}</span>
      )}
    </div>
  );
}

/**
 * Side panel inside the player while a channel plays: the channels of the same group
 * (or the favorites) with what is on air, to switch without leaving the video.
 */
export function ChannelsPanel({
  live,
  channels,
  onPlay,
  onClose,
  onHoldUi,
}: {
  live: LiveRef;
  /** Channels of the current group, already loaded by the player for zapping. */
  channels: Channel[];
  onPlay: (channel: Channel) => void;
  onClose: () => void;
  onHoldUi: (hold: boolean) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("group");
  const [favorites, setFavorites] = useState<Channel[] | null>(null);
  const list = tab === "group" ? channels : favorites ?? [];

  useEffect(() => {
    if (tab !== "favorites" || favorites) return;
    let alive = true;
    api
      .iptvChannels({ favorites: true, limit: 500 })
      .then((page) => {
        if (alive) setFavorites(page.items);
      })
      .catch(() => {
        if (alive) setFavorites([]);
      });
    return () => {
      alive = false;
    };
  }, [tab, favorites]);

  const epg = useEpgNow(list);

  // Keep the current channel in view when the panel opens.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-panel-channel="${CSS.escape(live.channelId)}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [live.channelId, tab]);

  return (
    <aside
      data-own-wheel
      className="panel-in absolute inset-y-0 right-0 z-[35] flex w-[400px] flex-col border-l border-white/10 bg-surface/95 text-text shadow-[-24px_0_48px_rgb(0_0_0_/_0.45)] backdrop-blur-md"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseEnter={() => onHoldUi(true)}
      onMouseLeave={() => onHoldUi(false)}
    >
      <div className="flex items-center gap-3 px-5 pt-5 pb-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">{t("channels")}</p>
          <p className="truncate text-[16px] font-semibold">{live.group || live.sourceName || t("liveTv")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="icon-hit grid h-9 w-9 place-items-center rounded-full text-white/70 hover:bg-white/10"
        >
          <X size={18} />
        </button>
      </div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-5 pb-3">
        <Chip selected={tab === "group"} onClick={() => setTab("group")}>
          {live.group || t("allChannels")}
        </Chip>
        <Chip selected={tab === "favorites"} onClick={() => setTab("favorites")} icon={<Star size={13} />}>
          {t("favorites")}
        </Chip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {tab === "favorites" && favorites == null
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-3 p-2">
                <Shimmer className="h-12 w-[84px] shrink-0 rounded-md" delay={i * 80} />
                <div className="flex-1 space-y-2 py-1">
                  <Shimmer className="h-3.5 w-3/4 rounded" />
                  <Shimmer className="h-3 w-1/3 rounded" />
                </div>
              </div>
            ))
          : null}
        {tab === "favorites" && favorites && !favorites.length ? (
          <p className="px-2 py-6 text-center text-[13px] text-dim">{t("noFavoriteChannels")}</p>
        ) : null}
        {list.map((channel) => {
          const current = channel.id === live.channelId;
          const now = epg[channel.id]?.now ?? null;
          return (
            <button
              key={channel.id}
              type="button"
              data-panel-channel={channel.id}
              onClick={() => (current ? onClose() : onPlay(channel))}
              className={cn(
                "group/ch relative flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors duration-150 hover:bg-white/6",
                current && "bg-white/8",
              )}
              aria-current={current ? "true" : undefined}
            >
              {current ? <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent" /> : null}
              <RowLogo channel={channel} />
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-[13px]", current ? "font-semibold text-white" : "text-text")}>
                  {channel.number != null ? <span className="mr-1.5 text-dim tabular">{channel.number}</span> : null}
                  {channel.name}
                </p>
                {now ? (
                  <>
                    <p className="truncate text-[11px] text-dim">{now.title}</p>
                    <div className="mt-1 h-[2px] w-full rounded-full bg-white/15">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${programmeProgress(now)}%` }} />
                    </div>
                  </>
                ) : (
                  <p className="truncate text-[11px] text-dim">{channel.group || t("noGroup")}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
