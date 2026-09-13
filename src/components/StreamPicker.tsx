import { useEffect, useState } from "react";
import { Globe, Link2Off, Play, X } from "lucide-react";
import type { AddonStream, Movie } from "../lib/types";
import { api } from "../lib/api";
import { cn, episodeCode } from "../lib/format";
import { formatSize } from "../lib/addons";
import { useI18n } from "../lib/locale-context";
import { useBackNavigation } from "../lib/use-back";
import { Shimmer } from "./Shimmer";

/**
 * Sheet listing the online sources (Stremio addon streams) of a title.
 * Picking one plays it; sources mpv cannot open (raw torrents, external links) are
 * listed but disabled.
 */
export function StreamPicker({
  movie,
  onClose,
  onPlay,
}: {
  movie: Movie;
  onClose: () => void;
  onPlay: (movie: Movie, stream: AddonStream) => void;
}) {
  const { t } = useI18n();
  const [streams, setStreams] = useState<AddonStream[] | null>(null);
  const [error, setError] = useState("");
  const ext = movie.external;

  useBackNavigation(onClose);

  useEffect(() => {
    if (!ext) return;
    let alive = true;
    setStreams(null);
    api
      .addonStreams(ext.type, ext.videoId)
      .then((list) => {
        if (alive) setStreams(list);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [ext?.type, ext?.videoId]);

  if (!ext) return null;

  const heading = movie.kind === "Episode" ? (movie.seriesName ?? movie.name) : movie.name;
  const sub =
    movie.kind === "Episode" ? [episodeCode(movie, t("episodeCode")), movie.name].filter(Boolean).join(" · ") : null;
  const groups = new Map<string, AddonStream[]>();
  for (const stream of streams ?? []) {
    const list = groups.get(stream.addonName) ?? [];
    list.push(stream);
    groups.set(stream.addonName, list);
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="modal-enter flex max-h-[86vh] w-[min(760px,94vw)] flex-col overflow-hidden rounded-card bg-surface shadow-[0_24px_80px_rgb(0_0_0_/_0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4 px-6 pt-6 pb-4">
          {movie.posterUrl ? (
            <img src={movie.posterUrl} alt="" className="img-outline h-[96px] w-[64px] shrink-0 rounded-md object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">
              <Globe size={13} />
              {t("onlineSources")}
            </p>
            <h2 className="mt-1 truncate text-[20px] font-semibold">{heading}</h2>
            {sub ? <p className="truncate text-[14px] text-muted">{sub}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="icon-hit grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {error ? <p className="px-2 py-6 text-center text-sm text-muted">{error}</p> : null}
          {streams == null && !error ? (
            <div className="space-y-2 px-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Shimmer key={i} className="h-16 rounded-xl" delay={i * 80} />
              ))}
              <p className="pt-2 text-center text-[13px] text-dim">{t("loadingStreams")}</p>
            </div>
          ) : null}
          {streams && !streams.length ? (
            <div className="px-2 py-10 text-center">
              <p className="text-[15px] font-medium">{t("noStreams")}</p>
              <p className="mt-1 text-[13px] text-dim">{t("noStreamsHint")}</p>
            </div>
          ) : null}
          {[...groups.entries()].map(([addonName, list]) => (
            <section key={addonName} className="mb-3">
              <p className="px-2 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">{addonName}</p>
              <div className="space-y-1">
                {list.map((stream, i) => {
                  const size = formatSize(stream.videoSize);
                  return (
                    <button
                      key={`${stream.addonUrl}:${i}`}
                      type="button"
                      disabled={!stream.playable}
                      onClick={() => stream.playable && onPlay(movie, stream)}
                      className={cn(
                        "group/st flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150",
                        stream.playable ? "hover:bg-white/6" : "opacity-50",
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                          stream.playable ? "bg-white/10 text-white group-hover/st:bg-accent group-hover/st:text-on-accent" : "bg-white/5 text-dim",
                        )}
                      >
                        {stream.playable ? <Play size={15} fill="currentColor" className="translate-x-px" /> : <Link2Off size={15} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-text">{stream.name}</span>
                        <span className="line-clamp-2 text-[12px] leading-[1.4] whitespace-pre-line text-muted">
                          {stream.playable ? stream.title || stream.filename || "" : t("streamUnsupported")}
                        </span>
                      </span>
                      {size ? <span className="shrink-0 text-[12px] text-dim tabular">{size}</span> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
