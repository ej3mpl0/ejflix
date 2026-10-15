import { useCallback, useEffect, useRef, useState } from "react";
import { FileVideo, FolderOpen, Play, X } from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api } from "../lib/api";
import { useDownloads } from "../lib/downloads-context";
import { errorText } from "../lib/errors";
import { cn, formatBytes } from "../lib/format";
import { fileName, isMediaPath, localMovie, parentDir } from "../lib/media-file";
import { useI18n } from "../lib/locale-context";
import type { Movie } from "../lib/types";

type RecentFile = { path: string; name: string; at: number };

const RECENT_MAX = 16;

function recentKey(userId: string): string {
  return `ejflix.local-player.${userId}`;
}

function loadRecent(userId: string): RecentFile[] {
  try {
    const raw = JSON.parse(localStorage.getItem(recentKey(userId)) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is RecentFile => {
        if (!item || typeof item !== "object") return false;
        const row = item as RecentFile;
        return typeof row.path === "string" && typeof row.name === "string" && typeof row.at === "number";
      })
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function saveRecent(userId: string, items: RecentFile[]) {
  try {
    localStorage.setItem(recentKey(userId), JSON.stringify(items.slice(0, RECENT_MAX)));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Local files in the same mpv player as everything else. Drop a download on the page
 * or pick it; finished downloads from the app are listed so they can be played too.
 */
export function LocalPlayer({
  userId,
  onError,
  onPlay,
}: {
  userId: string;
  onError: (message: string) => void;
  onPlay: (movie: Movie) => void;
}) {
  const { t, locale } = useI18n();
  const { items } = useDownloads();
  const [recent, setRecent] = useState<RecentFile[]>(() => loadRecent(userId));
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const droppedAt = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    setRecent(loadRecent(userId));
  }, [userId]);

  const remember = useCallback(
    (path: string) => {
      setRecent((current) => {
        const next = [{ path, name: fileName(path), at: Date.now() }, ...current.filter((item) => item.path.toLowerCase() !== path.toLowerCase())].slice(
          0,
          RECENT_MAX,
        );
        saveRecent(userId, next);
        return next;
      });
    },
    [userId],
  );

  const forget = useCallback(
    (path: string) => {
      setRecent((current) => {
        const next = current.filter((item) => item.path.toLowerCase() !== path.toLowerCase());
        saveRecent(userId, next);
        return next;
      });
    },
    [userId],
  );

  const playPaths = useCallback(
    (paths: string[], title?: string) => {
      const path = paths.find((item) => isMediaPath(item));
      if (!path) {
        if (paths.length) onErrorRef.current(t("errNotMedia"));
        return;
      }
      remember(path);
      // The player screen starts mpv and opens the overlay, so the controls mount.
      onPlay(localMovie(path, title));
    },
    [onPlay, remember, t],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (!alive) return;
        const kind = event.payload.type;
        if (kind === "enter" || kind === "over") setOver(true);
        if (kind === "leave") setOver(false);
        if (kind === "drop") {
          setOver(false);
          droppedAt.current = Date.now();
          const paths = "paths" in event.payload ? event.payload.paths : [];
          if (paths.length) void playPaths(paths);
        }
      })
      .then((fn) => {
        if (alive) unlisten = fn;
        else fn();
      });
    return () => {
      alive = false;
      setOver(false);
      unlisten?.();
    };
  }, [playPaths]);

  const choose = async () => {
    if (busy || Date.now() - droppedAt.current < 500) return;
    setBusy(true);
    try {
      const path = await api.playerPickFile({
        title: t("localPlayerChoose"),
        videoLabel: t("localPlayerVideos"),
        audioLabel: t("localPlayerAudio"),
        initialDir: parentDir(recent[0]?.path ?? ""),
      });
      if (path) await playPaths([path]);
    } catch (err) {
      onError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  const downloads = items.filter((item) => item.status === "done" && isMediaPath(item.path));
  const downloadPaths = new Set(downloads.map((item) => item.path.toLowerCase()));
  const opened = recent.filter((item) => !downloadPaths.has(item.path.toLowerCase()));
  const last = recent[0] ?? null;

  return (
    <div className="page-enter px-page pt-28 pb-16">
      <div className="mb-8">
        <h1 className="text-[40px] leading-none font-extrabold tracking-[-0.025em]">{t("playerTab")}</h1>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-[1.55] text-muted">{t("localPlayerHint")}</p>
      </div>

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* The screen waiting for a film: drop a file on it, or pick one. The dot of the j
            lights up while something is held over it, because that is what will play. */}
        <button
          type="button"
          onClick={() => void choose()}
          disabled={busy}
          className={cn(
            "group relative grid aspect-video w-full place-items-center overflow-hidden rounded-card text-center transition-[background-color,box-shadow] duration-200 ease-std",
            over
              ? "bg-panel shadow-[inset_0_0_0_2px_var(--color-text)]"
              : "bg-surface shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-panel",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0 bg-[radial-gradient(60%_55%_at_50%_45%,rgb(242_35_47_/_0.14),transparent_70%)] transition-opacity duration-300",
              over ? "opacity-100" : "opacity-0",
            )}
          />
          <span className="relative flex flex-col items-center px-8">
            <svg viewBox="0 0 120 120" width={92} height={92} aria-hidden className="mb-6 overflow-visible">
              <path d="M66 50v34c0 11-7 17-18 17h-4" fill="none" stroke="var(--color-text)" strokeWidth="17" strokeLinecap="round" />
              <circle
                cx="66"
                cy="27"
                r="11"
                className={cn(
                  "transition-[fill,filter] duration-300",
                  over ? "fill-live drop-shadow-[0_0_14px_rgb(242_35_47_/_0.75)]" : "fill-line group-hover:fill-dim",
                )}
              />
            </svg>
            <span className="text-[26px] leading-tight font-bold tracking-[-0.015em] [text-wrap:balance]">
              {over ? t("localPlayerDrop") : t("localPlayerDropHere")}
            </span>
            <span className="mt-2 text-[14px] text-muted">{t("localPlayerFormats")}</span>
            <span
              className={cn(
                "mt-7 inline-flex h-12 items-center gap-2.5 rounded-pill bg-accent px-6 text-[15px] font-semibold text-on-accent transition-opacity duration-150 group-hover:bg-accent-hover",
                over && "opacity-0",
              )}
            >
              <FolderOpen size={18} />
              {t("localPlayerChoose")}
            </span>
          </span>
        </button>

        <aside className="min-w-0 space-y-9">
          {last ? (
            <section>
              <h2 className="mb-3 text-[19px] font-semibold">{t("localPlayerContinue")}</h2>
              <div className="rounded-card bg-surface p-5">
                <div className="flex items-start gap-3">
                  <TypeBadge name={last.name} large />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[15px] leading-snug font-semibold break-words" title={last.path}>
                      {last.name}
                    </p>
                    <p className="mt-1 truncate text-[13px] text-muted">{parentDir(last.path)}</p>
                    <p className="mt-0.5 text-[13px] text-dim">{relativeTime(last.at, locale)}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void playPaths([last.path])}
                  className="btn-press btn-play mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-pill bg-accent text-[14.5px] font-semibold text-on-accent hover:bg-accent-hover"
                >
                  <Play size={16} fill="currentColor" />
                  {t("play")}
                </button>
              </div>
            </section>
          ) : null}

          {downloads.length ? (
            <section>
              <h2 className="mb-2 flex items-baseline gap-2.5 text-[19px] font-semibold">
                {t("localPlayerDownloads")}
                <span className="font-sans text-[13px] font-medium text-dim tabular">{downloads.length}</span>
              </h2>
              <div className="-mx-2">
                {downloads.map((item) => {
                  const label = item.title || item.name;
                  return (
                    <FileRow
                      key={item.id}
                      name={item.name || label}
                      label={label}
                      hint={[item.source, item.total > 0 ? formatBytes(item.total) : null].filter(Boolean).join(", ")}
                      title={item.path}
                      onPlay={() => void playPaths([item.path], label)}
                    />
                  );
                })}
              </div>
            </section>
          ) : null}

          {opened.length > (last && !downloadPaths.has(last.path.toLowerCase()) ? 1 : 0) ? (
            <section>
              <h2 className="mb-2 text-[19px] font-semibold">{t("localPlayerRecent")}</h2>
              <div className="-mx-2">
                {opened
                  .filter((item) => item !== last)
                  .map((item) => (
                    <FileRow
                      key={item.path}
                      name={item.name}
                      label={item.name}
                      hint={relativeTime(item.at, locale)}
                      title={item.path}
                      onPlay={() => void playPaths([item.path])}
                      onRemove={() => forget(item.path)}
                    />
                  ))}
              </div>
            </section>
          ) : null}

          {!last && !downloads.length ? (
            <p className="rounded-card bg-surface p-5 text-[14px] leading-[1.55] text-muted">{t("localPlayerEmpty")}</p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/** "hace 2 días" / "2 days ago". */
function relativeTime(at: number, locale: string): string {
  const minutes = Math.round((at - Date.now()) / 60_000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, "hour");
  return format.format(Math.round(hours / 24), "day");
}

/** The file's container (MKV, MP4…) on a small tile, standing in for a cover. */
function TypeBadge({ name, large = false }: { name: string; large?: boolean }) {
  const ext = /\.([a-z0-9]{2,4})$/i.exec(name)?.[1]?.toUpperCase() ?? "";
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-[10px] bg-panel font-display font-bold text-muted",
        large ? "h-12 w-12 text-[12px]" : "h-10 w-10 text-[11px]",
      )}
    >
      {ext || <FileVideo size={18} />}
    </span>
  );
}

function FileRow({
  name,
  label,
  hint,
  title,
  onPlay,
  onRemove,
}: {
  name: string;
  label: string;
  hint?: string;
  title: string;
  onPlay: () => void;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="group/file flex items-center gap-3 rounded-xl px-2 py-2 transition-colors duration-150 hover:bg-surface">
      <button type="button" onClick={onPlay} aria-label={`${t("play")} ${label}`} className="relative shrink-0">
        <TypeBadge name={name} />
        <span className="absolute inset-0 grid place-items-center rounded-[10px] bg-accent text-on-accent opacity-0 transition-opacity duration-150 group-hover/file:opacity-100">
          <Play size={15} fill="currentColor" className="translate-x-px" />
        </span>
      </button>
      <button type="button" onClick={onPlay} className="min-w-0 flex-1 text-left" title={title}>
        <p className="truncate text-[14.5px] font-semibold text-text">{label}</p>
        {hint ? <p className="truncate text-[13px] text-muted">{hint}</p> : null}
      </button>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("localPlayerRemove")}
          title={t("localPlayerRemove")}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-dim opacity-0 hover:bg-white/10 hover:text-text group-hover/file:opacity-100 focus-visible:opacity-100"
        >
          <X size={15} />
        </button>
      ) : null}
    </div>
  );
}
