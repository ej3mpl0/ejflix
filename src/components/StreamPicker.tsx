import { useEffect, useState } from "react";
import { Download, Globe, Link2, Link2Off, Play, X, Zap } from "lucide-react";
import type { AddonStream, Movie } from "../lib/types";
import { api } from "../lib/api";
import { cn, episodeCode } from "../lib/format";
import { formatSize, streamView, type StreamKind, type StreamView } from "../lib/addons";
import { useI18n } from "../lib/locale-context";
import { useBackNavigation } from "../lib/use-back";
import { useDownloads } from "../lib/downloads-context";
import { Chip } from "./Chip";
import { KebabMenu, type MenuAction } from "./KebabMenu";
import { Shimmer } from "./Shimmer";

/** Clipboard, with the old command as a fallback when WebView2 refuses the async API. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Sheet listing the online sources (Stremio addon streams) of a title, split into the
 * ones that stream straight away (torrent/debrid) and the ones that have to be fetched
 * first (usenet). Picking one plays it; the three-dot menu saves it to the Downloads
 * folder or copies its link. Sources mpv cannot open are listed but cannot be played.
 */
export function StreamPicker({
  movie,
  onClose,
  onPlay,
  onToast,
}: {
  movie: Movie;
  onClose: () => void;
  onPlay: (movie: Movie, stream: AddonStream) => void;
  onToast: (message: string) => void;
}) {
  const { t } = useI18n();
  const downloads = useDownloads();
  const [streams, setStreams] = useState<AddonStream[] | null>(null);
  const [tab, setTab] = useState<StreamKind>("stream");
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

  const isEpisode = movie.kind === "Episode";
  const heading = isEpisode ? (movie.seriesName ?? movie.name) : movie.name;
  const sub = isEpisode ? [episodeCode(movie, t("episodeCode")), movie.name].filter(Boolean).join(" · ") : null;
  /** Name the download is listed under when the addon does not give a file name. */
  const downloadTitle = isEpisode
    ? [movie.seriesName, episodeCode(movie, "S{s}E{e}"), movie.name].filter(Boolean).join(" - ")
    : [movie.name, movie.year ? `(${movie.year})` : null].filter(Boolean).join(" ");

  /** Addons that answered with an error report instead of a source are not worth a row. */
  const views = (streams ?? []).map(streamView).filter((v) => !v.label.failed);
  const streaming = views.filter((v) => v.kind === "stream");
  const fetched = views.filter((v) => v.kind === "download");
  /** The tabs only earn their place once a usenet source has actually turned up. */
  const tabbed = fetched.length > 0;
  const active: StreamKind = tabbed ? tab : "stream";
  const shown = active === "stream" ? streaming : fetched;

  const groups = new Map<string, StreamView[]>();
  for (const view of shown) {
    const key = view.label.addon ?? view.stream.addonName;
    const list = groups.get(key) ?? [];
    list.push(view);
    groups.set(key, list);
  }

  const copy = async (link: string) => {
    onToast((await copyText(link)) ? t("linkCopied") : t("copyFailed"));
  };

  const actionsFor = (stream: AddonStream): MenuAction[] => {
    const actions: MenuAction[] = [];
    if (stream.url) {
      actions.push({
        id: "download",
        label: t("download"),
        icon: <Download size={15} />,
        hint: formatSize(stream.videoSize) || undefined,
        onSelect: () =>
          void downloads.start({
            url: stream.url ?? "",
            headers: stream.headers,
            title: downloadTitle,
            fileName: stream.filename ?? "",
            source: stream.addonName,
            size: stream.videoSize,
          }),
      });
    }
    const link = stream.url ?? stream.externalUrl;
    if (link) {
      actions.push({ id: "copy", label: t("copyLink"), icon: <Link2 size={15} />, onSelect: () => void copy(link) });
    }
    return actions;
  };

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
        {tabbed ? (
          <div className="flex gap-2 px-6 pb-3" role="tablist" aria-label={t("onlineSources")}>
            <Chip
              role="tab"
              aria-selected={active === "stream"}
              selected={active === "stream"}
              onClick={() => setTab("stream")}
            >
              {t("sourcesStreaming")}
              <span className="text-[11px] opacity-70 tabular">{streaming.length}</span>
            </Chip>
            <Chip
              role="tab"
              aria-selected={active === "download"}
              selected={active === "download"}
              onClick={() => setTab("download")}
            >
              {t("sourcesDownload")}
              <span className="text-[11px] opacity-70 tabular">{fetched.length}</span>
            </Chip>
          </div>
        ) : null}
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
          {streams && !views.length ? (
            <div className="px-2 py-10 text-center">
              <p className="text-[15px] font-medium">{t("noStreams")}</p>
              <p className="mt-1 text-[13px] text-dim">{t("noStreamsHint")}</p>
            </div>
          ) : null}
          {views.length > 0 && !shown.length ? (
            <p className="px-2 py-10 text-center text-[13px] text-dim">
              {active === "stream" ? t("noStreamingSources") : t("noDownloadSources")}
            </p>
          ) : null}
          {[...groups.entries()].map(([source, list]) => (
            <section key={source} className="mb-3">
              <p className="px-2 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">{source}</p>
              <div className="space-y-1">
                {list.map((view, i) => {
                  const stream = view.stream;
                  const size = formatSize(stream.videoSize);
                  const actions = actionsFor(stream);
                  return (
                    <div
                      key={`${source}:${i}`}
                      className={cn(
                        "group/st flex items-center rounded-xl pr-1.5 transition-colors duration-150",
                        stream.playable ? "hover:bg-white/6" : "opacity-50",
                      )}
                    >
                      <button
                        type="button"
                        disabled={!stream.playable}
                        onClick={() => stream.playable && onPlay(movie, stream)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left"
                      >
                        <span
                          className={cn(
                            "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                            stream.playable
                              ? "bg-white/10 text-white group-hover/st:bg-accent group-hover/st:text-on-accent"
                              : "bg-white/5 text-dim",
                          )}
                        >
                          {stream.playable ? <Play size={15} fill="currentColor" className="translate-x-px" /> : <Link2Off size={15} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium text-text">{view.title}</span>
                          {!stream.playable ? (
                            <span className="line-clamp-2 text-[12px] leading-[1.4] text-muted">{t("streamUnsupported")}</span>
                          ) : view.parsed ? (
                            <span className="mt-1 flex flex-wrap items-center gap-1.5">
                              {view.label.cached ? (
                                <span className="inline-flex h-[18px] items-center gap-0.5 rounded-md bg-success/15 px-1.5 text-[11px] font-medium text-success">
                                  <Zap size={10} fill="currentColor" />
                                  {t("streamInstant")}
                                </span>
                              ) : view.label.pending ? (
                                <span className="inline-flex h-[18px] items-center rounded-md bg-warning/15 px-1.5 text-[11px] font-medium text-warning">
                                  {t("streamNeedsFetch")}
                                </span>
                              ) : null}
                              {view.meta.languages.map((lang) => (
                                <span
                                  key={lang}
                                  className="inline-flex h-[18px] items-center rounded-md bg-accent-soft px-1.5 text-[11px] font-medium text-accent"
                                >
                                  {lang}
                                </span>
                              ))}
                              {view.chips.map((chip) => (
                                <span
                                  key={chip}
                                  className="inline-flex h-[18px] items-center rounded-md bg-white/8 px-1.5 text-[11px] text-muted"
                                >
                                  {chip}
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="line-clamp-2 text-[12px] leading-[1.4] whitespace-pre-line text-muted">
                              {stream.title || stream.filename || ""}
                            </span>
                          )}
                        </span>
                        {size ? <span className="shrink-0 pl-2 text-[12px] text-dim tabular">{size}</span> : null}
                      </button>
                      {actions.length ? <KebabMenu actions={actions} label={t("moreOptions")} className="ml-1" /> : null}
                    </div>
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
