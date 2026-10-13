import { useCallback, useEffect, useRef, useState } from "react";
import { FileVideo, Play, X } from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api } from "../lib/api";
import { useDownloads } from "../lib/downloads-context";
import { errorText } from "../lib/errors";
import { cn } from "../lib/format";
import { fileName, isMediaPath, parentDir } from "../lib/media-file";
import { useI18n } from "../lib/locale-context";

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
export function LocalPlayer({ userId, onError }: { userId: string; onError: (message: string) => void }) {
  const { t } = useI18n();
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
    async (paths: string[], title?: string) => {
      let last: unknown = null;
      for (const path of paths) {
        try {
          await api.playerStartFile({ path, title });
          remember(path);
          return;
        } catch (err) {
          last = err;
          const message = err instanceof Error ? err.message : String(err ?? "");
          if (message.startsWith("err:fileNotFound")) forget(path);
        }
      }
      if (last) onErrorRef.current(errorText(t, last));
    },
    [forget, remember, t],
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

  return (
    <div className="page-enter px-page pt-24 pb-16">
      <div className="mb-6">
        <h1 className="flex items-center gap-2.5 text-[28px] font-semibold tracking-[-0.02em]">
          <FileVideo size={26} className="text-accent" />
          {t("playerTab")}
        </h1>
        <p className="mt-1 max-w-[62ch] text-[13px] text-dim">{t("localPlayerHint")}</p>
      </div>

      <button
        type="button"
        onClick={() => void choose()}
        disabled={busy}
        className={cn(
          "flex w-full flex-col items-center rounded-card border border-dashed px-8 py-16 text-center transition-colors duration-150",
          over ? "border-accent bg-accent-soft" : "border-white/15 bg-surface hover:border-white/30",
        )}
      >
        <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
          <FileVideo size={26} />
        </span>
        <p className="text-[16px] font-medium [text-wrap:balance]">{over ? t("localPlayerDrop") : t("localPlayerChoose")}</p>
      </button>

      {downloads.length ? (
        <section className="mt-10">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">{t("localPlayerDownloads")}</h2>
          <div>
            {downloads.map((item) => {
              const label = item.title || item.name;
              const hint = item.title && item.name && item.title !== item.name ? item.name : item.source;
              return (
                <FileRow
                  key={item.id}
                  label={label}
                  hint={hint}
                  title={item.path}
                  onPlay={() => void playPaths([item.path], label)}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {opened.length ? (
        <section className="mt-10">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">{t("localPlayerRecent")}</h2>
          <div>
            {opened.map((item) => (
              <FileRow
                key={item.path}
                label={item.name}
                hint={parentDir(item.path)}
                title={item.path}
                onPlay={() => void playPaths([item.path])}
                onRemove={() => forget(item.path)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function FileRow({
  label,
  hint,
  title,
  onPlay,
  onRemove,
}: {
  label: string;
  hint?: string;
  title: string;
  onPlay: () => void;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="group/file flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5">
      <button
        type="button"
        onClick={onPlay}
        aria-label={`${t("play")} ${label}`}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/90 text-black"
      >
        <Play size={16} fill="currentColor" className="translate-x-px" />
      </button>
      <button type="button" onClick={onPlay} className="min-w-0 flex-1 text-left" title={title}>
        <p className="truncate text-[14px] font-medium text-text">{label}</p>
        {hint ? <p className="truncate text-[12px] text-dim">{hint}</p> : null}
      </button>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("localPlayerRemove")}
          title={t("localPlayerRemove")}
          className="grid h-8 w-8 place-items-center rounded-full text-dim opacity-0 hover:bg-white/10 hover:text-text group-hover/file:opacity-100 focus-visible:opacity-100"
        >
          <X size={15} />
        </button>
      ) : null}
    </div>
  );
}
