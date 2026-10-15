import { useEffect, useState } from "react";
import { Download, Link2, Magnet, Settings2, SlidersHorizontal, X, Zap } from "lucide-react";
import type { AddonStream, Movie } from "../lib/types";
import { api } from "../lib/api";
import { cn, episodeCode } from "../lib/format";
import { formatSize, isTorrentOnly, streamView, type StreamKind, type StreamView } from "../lib/addons";
import { useI18n } from "../lib/locale-context";
import { errorText } from "../lib/errors";
import { useSettings } from "../lib/settings-context";
import { useBackNavigation } from "../lib/use-back";
import { useDownloads } from "../lib/downloads-context";
import { Chip } from "./Chip";
import { KebabMenu, type MenuAction } from "./KebabMenu";
import { Select } from "./Select";
import { Shimmer } from "./Shimmer";
import { Dialog } from "./Dialog";

/** Resolutions from best to worst, so the filter reads like a quality ladder. */
const QUALITY_ORDER = ["2160p", "1440p", "1080p", "720p", "576p", "480p", "360p"];

function byQuality(a: string, b: string): number {
  const rank = (q: string) => {
    const index = QUALITY_ORDER.indexOf(q.toLowerCase());
    return index < 0 ? QUALITY_ORDER.length : index;
  };
  return rank(a) - rank(b) || a.localeCompare(b);
}

type SortMode = "default" | "quality" | "size" | "seeders";

/** Seeders as most torrent addons print them in the description ("👤 123"). */
function seedersOf(stream: AddonStream): number {
  const match = /👤\s*(\d+)/u.exec(stream.title ?? "");
  return match ? Number(match[1]) : -1;
}

/** Size in bytes: the addon's field, else "💾 1.4 GB" in the description. */
function sizeOf(stream: AddonStream): number {
  if (stream.videoSize) return stream.videoSize;
  const match = /💾\s*([\d.,]+)\s*(TB|GB|MB)/iu.exec(stream.title ?? "");
  if (!match) return -1;
  const value = Number(match[1].replace(",", "."));
  const unit = match[2].toUpperCase();
  return value * 1024 ** (unit === "TB" ? 4 : unit === "GB" ? 3 : 2);
}

/** The source last played for each title ("the one I always use"), per title id. */
const PREFERRED_KEY = "ejflix.preferredSource";
type Preferred = { addonUrl: string; bingeGroup: string | null };

function readPreferred(metaId: string): Preferred | null {
  try {
    const all = JSON.parse(localStorage.getItem(PREFERRED_KEY) ?? "{}") as Record<string, Preferred>;
    return all[metaId] ?? null;
  } catch {
    return null;
  }
}

function savePreferred(metaId: string, stream: AddonStream) {
  try {
    const all = JSON.parse(localStorage.getItem(PREFERRED_KEY) ?? "{}") as Record<string, Preferred>;
    // Re-inserted, so a title played again moves to the recent end.
    delete all[metaId];
    all[metaId] = { addonUrl: stream.addonUrl, bingeGroup: stream.bingeGroup };
    // Keep the most recent 300 titles.
    const entries = Object.entries(all).slice(-300);
    localStorage.setItem(PREFERRED_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage unavailable: nothing to remember */
  }
}

function isPreferred(stream: AddonStream, preferred: Preferred | null): boolean {
  if (!preferred || stream.addonUrl !== preferred.addonUrl) return false;
  return preferred.bingeGroup ? stream.bingeGroup === preferred.bingeGroup : false;
}

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
 * first (usenet). In the Streaming tab a row plays and the three-dot menu downloads or
 * copies the link; in the Downloads tab a row can only download, because usenet is
 * fetched before it can be watched. Sources mpv cannot open are listed but disabled.
 * Bare torrents play through the built-in engine; with that switched off they fold
 * into one notice per addon that offers to turn it on or to set up a debrid key in
 * the addon, which is what turns them into plain links.
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
  onToast: (message: string, action?: { label: string; run: () => void }) => void;
}) {
  const { t } = useI18n();
  const downloads = useDownloads();
  const { settings, update: updateSettings } = useSettings();
  const torrentsOn = settings.torrents.enabled;
  const [streams, setStreams] = useState<AddonStream[] | null>(null);
  const [tab, setTab] = useState<StreamKind>("stream");
  const [showFilters, setShowFilters] = useState(false);
  const [quality, setQuality] = useState("");
  const [availability, setAvailability] = useState("");
  const [language, setLanguage] = useState("");
  const [sort, setSort] = useState<SortMode>("default");
  const [error, setError] = useState("");
  /** Manifest URL -> the addon's settings page, for the torrent-only notices. */
  const [configure, setConfigure] = useState<Record<string, string>>({});
  const ext = movie.external;

  useBackNavigation(onClose);

  useEffect(() => {
    let alive = true;
    api
      .addonsList()
      .then((list) => {
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const addon of list) if (addon.configureUrl) map[addon.url] = addon.configureUrl;
        setConfigure(map);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

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
        if (alive) setError(errorText(t, err));
      });
    return () => {
      alive = false;
    };
  }, [ext?.type, ext?.videoId]);

  if (!ext) return null;

  const isEpisode = movie.kind === "Episode";
  const heading = isEpisode ? (movie.seriesName ?? movie.name) : movie.name;
  const sub = isEpisode ? [episodeCode(movie, t("episodeCode")), movie.name].filter(Boolean).join(" ") : null;
  /** Name the download is listed under when the addon does not give a file name. */
  const downloadTitle = isEpisode
    ? [movie.seriesName, episodeCode(movie, "S{s}E{e}"), movie.name].filter(Boolean).join(" - ")
    : [movie.name, movie.year ? `(${movie.year})` : null].filter(Boolean).join(" ");

  const all = (streams ?? []).map(streamView);
  const views = all.filter((v) => torrentsOn || !isTorrentOnly(v.stream));
  /** With torrents off: one notice per addon that answered with bare torrents. */
  const notices = (() => {
    if (torrentsOn) return [];
    const map = new Map<string, { name: string; url: string; count: number }>();
    for (const view of all) {
      if (!isTorrentOnly(view.stream)) continue;
      const entry = map.get(view.stream.addonUrl) ?? { name: view.stream.addonName, url: view.stream.addonUrl, count: 0 };
      entry.count += 1;
      map.set(view.stream.addonUrl, entry);
    }
    return [...map.values()];
  })();
  const streaming = views.filter((v) => v.kind === "stream");
  const fetched = views.filter((v) => v.kind === "download");
  /** The tabs only earn their place once a usenet source has actually turned up. */
  const tabbed = fetched.length > 0;
  const active: StreamKind = tabbed ? tab : "stream";
  const shown = active === "stream" ? streaming : fetched;

  const qualities = [...new Set(shown.map((v) => v.label.resolution).filter((q): q is string => Boolean(q)))].sort(
    byQuality,
  );
  const languages = [...new Set(shown.flatMap((v) => v.meta.languages))].sort((a, b) => a.localeCompare(b));
  const filtered = shown.filter((view) => {
    if (quality && view.label.resolution !== quality) return false;
    if (availability === "instant" && !view.label.cached) return false;
    if (availability === "fetch" && view.label.cached) return false;
    if (language && !view.meta.languages.includes(language)) return false;
    return true;
  });
  const preferred = ext ? readPreferred(ext.metaId) : null;
  const rank = (view: StreamView): number => {
    if (sort === "quality") {
      const q = view.label.resolution ? QUALITY_ORDER.indexOf(view.label.resolution.toLowerCase()) : -1;
      return q < 0 ? QUALITY_ORDER.length : q;
    }
    if (sort === "size") return -sizeOf(view.stream);
    if (sort === "seeders") return -seedersOf(view.stream);
    return 0;
  };
  // The usual source first, then the chosen order (stable: the addon's own order breaks ties).
  filtered.sort(
    (a, b) =>
      Number(isPreferred(b.stream, preferred)) - Number(isPreferred(a.stream, preferred)) || rank(a) - rank(b),
  );
  const filtering = Boolean(quality || availability || language);
  const activeFilters = [quality, availability, language].filter(Boolean).length;
  /** With one quality and one language there is nothing a filter could narrow down. */
  const canFilter = qualities.length > 1 || languages.length > 1 || active === "stream";

  // Grouped by quality, best first: the first thing to decide is usually "4K or 1080p".
  const groups = new Map<string, StreamView[]>();
  for (const view of filtered) {
    const key = view.label.resolution ?? "";
    const list = groups.get(key) ?? [];
    list.push(view);
    groups.set(key, list);
  }
  const groupOrder = [...groups.keys()].sort((a, b) => (!a ? 1 : !b ? -1 : byQuality(a, b)));
  const addonCount = new Set(views.map((v) => v.stream.addonUrl)).size;
  /** "2160p" reads as 4K on a disc box; everything else keeps its own name. */
  const qualityName = (q: string) => (!q ? t("otherQuality") : q.toLowerCase() === "2160p" ? "4K" : q);

  const copy = async (link: string) => {
    onToast((await copyText(link)) ? t("linkCopied") : t("copyFailed"));
  };

  const startDownload = (stream: AddonStream) =>
    void downloads.start({
      url: stream.url ?? "",
      headers: stream.headers,
      title: downloadTitle,
      fileName: stream.filename ?? "",
      source: stream.addonName,
      size: stream.videoSize,
    });

  const actionsFor = (view: StreamView): MenuAction[] => {
    const stream = view.stream;
    const actions: MenuAction[] = [];
    if (view.label.failed) return actions;
    // In the Downloads tab the row itself downloads, so the menu would only repeat it.
    if (stream.url && active !== "download") {
      actions.push({
        id: "download",
        label: t("download"),
        icon: <Download size={15} />,
        hint: formatSize(stream.videoSize) || undefined,
        onSelect: () => startDownload(stream),
      });
    }
    const link = stream.url ?? stream.externalUrl;
    if (link) {
      actions.push({ id: "copy", label: t("copyLink"), icon: <Link2 size={15} />, onSelect: () => void copy(link) });
    }
    return actions;
  };

  return (
    // Escape and the mouse back button already close it through useBackNavigation.
    <Dialog
      z="z-[60]"
      side
      labelledBy="stream-picker-title"
      onBackdrop={onClose}
      className="flex w-[min(540px,100vw)] flex-col bg-surface shadow-[-30px_0_60px_rgb(0_0_0_/_0.45)]"
    >
      <div className="flex items-start gap-4 px-7 pt-7 pb-2">
        <div className="min-w-0 flex-1">
          <h2 id="stream-picker-title" className="text-[24px] font-bold tracking-[-0.01em]">
            {t("chooseSource")}
          </h2>
          <p className="mt-1 truncate text-[14px] text-muted">
            {[heading, sub].filter(Boolean).join(": ")}
            {views.length ? (
              <span className="tabular">
                {", "}
                {addonCount > 1
                  ? t("sourcesFromAddons", { count: String(views.length), addons: String(addonCount) })
                  : views.length === 1
                    ? t("sourceCountOne")
                    : t("sourceCount", { count: String(views.length) })}
              </span>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="icon-hit grid h-10 w-10 shrink-0 place-items-center rounded-full bg-panel text-white/80 hover:bg-line"
        >
          <X size={18} />
        </button>
      </div>
      {views.length ? (
        <div className="px-7 pt-3 pb-2">
          {tabbed ? (
            <div className="mb-3 flex gap-2" role="tablist" aria-label={t("onlineSources")}>
              <Chip role="tab" aria-selected={active === "stream"} selected={active === "stream"} onClick={() => setTab("stream")}>
                {t("sourcesStreaming")}
                <span className="text-[11px] opacity-70 tabular">{streaming.length}</span>
              </Chip>
              <Chip role="tab" aria-selected={active === "download"} selected={active === "download"} onClick={() => setTab("download")}>
                {t("sourcesDownload")}
                <span className="text-[11px] opacity-70 tabular">{fetched.length}</span>
              </Chip>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {qualities.length > 1 ? (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("filterQuality")}>
                <Chip role="radio" aria-checked={!quality} selected={!quality} onClick={() => setQuality("")}>
                  {t("allQualities")}
                </Chip>
                {qualities.map((q) => (
                  <Chip key={q} role="radio" aria-checked={quality === q} selected={quality === q} onClick={() => setQuality(q)}>
                    {qualityName(q)}
                  </Chip>
                ))}
              </div>
            ) : null}
            {canFilter ? (
              <button
                type="button"
                aria-expanded={showFilters}
                aria-label={t("filters")}
                onClick={() => setShowFilters((v) => !v)}
                className={cn(
                  "ml-auto inline-flex h-9 items-center gap-1.5 rounded-pill px-3 text-[13px] transition-colors duration-150",
                  showFilters || filtering ? "bg-white/12 text-text" : "text-muted hover:bg-white/8 hover:text-text",
                )}
              >
                <SlidersHorizontal size={15} />
                {t("filters")}
                {activeFilters ? (
                  <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold text-on-accent tabular">
                    {activeFilters}
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>
          {canFilter && showFilters ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Select<SortMode>
                label={t("sortBy")}
                value={sort}
                onChange={setSort}
                className="h-9 min-w-[150px] text-[13px]"
                options={[
                  { value: "default", label: t("sortRecommended") },
                  { value: "quality", label: t("sortQuality") },
                  { value: "size", label: t("sortSize") },
                  { value: "seeders", label: t("sortSeeders") },
                ]}
              />
              {active === "stream" ? (
                <Select
                  label={t("filterAvailability")}
                  value={availability}
                  onChange={setAvailability}
                  className="h-9 min-w-[150px] text-[13px]"
                  options={[
                    { value: "", label: t("anyAvailability") },
                    { value: "instant", label: t("streamInstant") },
                    { value: "fetch", label: t("streamNeedsFetch") },
                  ]}
                />
              ) : null}
              {languages.length > 1 ? (
                <Select
                  label={t("filterLanguage")}
                  value={language}
                  onChange={setLanguage}
                  className="h-9 min-w-[140px] text-[13px]"
                  options={[{ value: "", label: t("allLanguages") }, ...languages.map((l) => ({ value: l, label: l }))]}
                />
              ) : null}
              {filtering ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuality("");
                    setAvailability("");
                    setLanguage("");
                  }}
                  className="h-9 rounded-pill px-3 text-[13px] text-muted hover:bg-white/8 hover:text-text"
                >
                  {t("filterClear")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7">
        {error ? <p className="py-6 text-center text-sm text-muted">{error}</p> : null}
        {streams == null && !error ? (
          <div className="space-y-2 pt-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Shimmer key={i} className="h-[86px] rounded-xl" delay={i * 80} />
            ))}
            <p className="pt-2 text-center text-[13px] text-dim">{t("loadingStreams")}</p>
          </div>
        ) : null}
        {streams && !views.length && !notices.length ? (
          <div className="py-10 text-center">
            <p className="text-[15px] font-medium">{t("noStreams")}</p>
            <p className="mt-1 text-[13px] text-dim">{t("noStreamsHint")}</p>
          </div>
        ) : null}
        {views.length > 0 && !shown.length ? (
          <p className="py-10 text-center text-[13px] text-dim">
            {active === "stream" ? t("noStreamingSources") : t("noDownloadSources")}
          </p>
        ) : null}
        {shown.length > 0 && !filtered.length ? (
          <p className="py-10 text-center text-[13px] text-dim">{t("noSourcesMatch")}</p>
        ) : null}
        {groupOrder.map((key) => {
          const list = groups.get(key) ?? [];
          return (
            <section key={key || "other"} className="pt-5">
              <h3 className="mb-2.5 flex items-baseline gap-2.5">
                <span className="text-[26px] leading-none font-bold">{qualityName(key)}</span>
                <span className="text-[13px] text-dim tabular">
                  {list.length === 1 ? t("sourceCountOne") : t("sourceCount", { count: String(list.length) })}
                </span>
              </h3>
              <div className="space-y-2">
                {list.map((view, i) => {
                  const stream = view.stream;
                  const size = formatSize(stream.videoSize);
                  const actions = actionsFor(view);
                  const failed = view.label.failed;
                  // Usenet sources are fetched, not streamed: in that tab the row downloads.
                  const downloadOnly = active === "download";
                  const torrent = isTorrentOnly(stream);
                  const plays = stream.playable || (torrent && torrentsOn);
                  const enabled = failed ? false : downloadOnly ? Boolean(stream.url) : plays;
                  const usual = isPreferred(stream, preferred);
                  const seeders = seedersOf(stream);
                  const chips = view.chips.filter((chip) => chip !== view.label.resolution);
                  return (
                    <div
                      key={`${key}:${i}`}
                      className={cn(
                        "group/st relative flex items-start rounded-xl bg-panel transition-[background-color,box-shadow] duration-150",
                        enabled ? "hover:bg-line" : "opacity-50",
                        usual && "shadow-[inset_0_0_0_2px_var(--color-text)]",
                      )}
                    >
                      <button
                        type="button"
                        disabled={!enabled}
                        aria-label={downloadOnly ? `${t("download")} ${view.title}` : undefined}
                        onClick={() => {
                          if (!enabled) return;
                          if (downloadOnly) startDownload(stream);
                          else {
                            if (ext && stream.bingeGroup) savePreferred(ext.metaId, stream);
                            onPlay(movie, stream);
                          }
                        }}
                        className="min-w-0 flex-1 px-4 py-3.5 text-left"
                      >
                        <span className="flex flex-wrap items-center gap-1.5">
                          {usual ? (
                            <span className="inline-flex h-[22px] items-center rounded-md bg-accent px-2 text-[11.5px] font-bold text-on-accent">
                              {t("usualSource")}
                            </span>
                          ) : null}
                          {view.label.cached ? (
                            <span className="inline-flex h-[22px] items-center gap-1 rounded-md bg-amber/16 px-2 text-[11.5px] font-bold text-amber">
                              <Zap size={11} fill="currentColor" />
                              {t("streamInstant")}
                            </span>
                          ) : view.label.pending ? (
                            <span
                              title={t("streamNeedsFetchHint")}
                              className="inline-flex h-[22px] items-center rounded-md bg-white/8 px-2 text-[11.5px] font-semibold text-muted"
                            >
                              {t("streamNeedsFetch")}
                            </span>
                          ) : null}
                          {torrent ? (
                            <span className="inline-flex h-[22px] items-center gap-1 rounded-md bg-white/12 px-2 text-[11.5px] font-bold text-text">
                              <Magnet size={11} />
                              {t("torrentBadge")}
                            </span>
                          ) : null}
                          {chips.map((chip) => (
                            <span key={chip} className="inline-flex h-[22px] items-center rounded-md bg-line px-2 text-[11.5px] font-bold text-text">
                              {chip}
                            </span>
                          ))}
                        </span>
                        <span className="mt-2 block truncate text-[13px] text-muted">
                          {failed
                            ? stream.title || t("streamFailed")
                            : !plays && !downloadOnly
                              ? t("streamUnsupported")
                              : view.parsed
                                ? view.title
                                : (stream.title || view.raw).split("\n")[0]}
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-medium text-text">
                          <span className="text-muted">{view.label.addon ?? stream.addonName}</span>
                          {size ? <span className="tabular">{size}</span> : null}
                          {view.meta.languages.length ? <span>{view.meta.languages.join(", ")}</span> : null}
                          {seeders >= 0 ? <span className="tabular">{t("seedersCount", { n: seeders })}</span> : null}
                        </span>
                      </button>
                      {actions.length ? <KebabMenu actions={actions} label={t("moreOptions")} className="mt-2.5 mr-2" /> : null}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {notices.map((notice) => {
          const page = configure[notice.url];
          return (
            <div key={notice.url} className={cn("flex items-start gap-3 rounded-xl bg-panel px-4 py-3.5", views.length ? "mt-5" : "my-6")}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-text">
                <Magnet size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-text">
                  {t("torrentOnlyTitle", { addon: notice.name, count: String(notice.count) })}
                </p>
                <p className="mt-0.5 text-[12.5px] leading-[1.45] text-muted">{t("torrentOnlyText")}</p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void updateSettings({ torrents: { enabled: true } })}
                    className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-accent px-3 text-[12.5px] font-semibold text-on-accent hover:bg-accent-hover"
                  >
                    <Magnet size={13} />
                    {t("torrentsEnable")}
                  </button>
                  {page ? (
                    <button
                      type="button"
                      onClick={() => void api.openExternal(page).catch(() => undefined)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-white/10 px-3 text-[12.5px] font-medium text-text hover:bg-white/16"
                    >
                      <Settings2 size={13} />
                      {t("configureAddon")}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
