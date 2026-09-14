import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, FolderOpen, LoaderCircle, Trash2, X } from "lucide-react";
import type { DownloadItem } from "../lib/types";
import { cn, formatBytes } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useDownloads } from "../lib/downloads-context";

function percent(item: DownloadItem): number {
  if (item.total <= 0) return 0;
  return Math.max(0, Math.min(100, (item.received / item.total) * 100));
}

/**
 * Header button with the list of downloads: progress of what is running, and what
 * finished (with a shortcut to its folder). Hidden while there is nothing to show.
 */
export function DownloadsButton() {
  const { t } = useI18n();
  const { items, active, cancel, remove, reveal, clearFinished } = useDownloads();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Nothing to show: the button disappears instead of opening an empty panel.
  useEffect(() => {
    if (!items.length) setOpen(false);
  }, [items.length]);

  if (!items.length) return null;

  const line = (item: DownloadItem) => {
    if (item.status === "downloading") {
      return item.total > 0
        ? `${Math.round(percent(item))}% · ${formatBytes(item.received)} / ${formatBytes(item.total)}`
        : formatBytes(item.received);
    }
    if (item.status === "done") return `${t("downloadDone")} · ${formatBytes(item.received)}`;
    if (item.status === "error") return item.error || t("downloadFailedShort");
    return t("downloadCanceled");
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={t("downloads")}
        title={t("downloads")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "icon-hit relative grid h-10 w-10 place-items-center rounded-full text-white hover:bg-white/10",
          open && "bg-white/10",
        )}
      >
        <Download size={18} />
        {active ? (
          <span className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent tabular">
            {active}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="modal-enter absolute top-11 right-0 z-10 w-[380px] rounded-2xl bg-panel/95 p-2 shadow-[0_16px_40px_rgb(0_0_0_/_0.5),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <p className="text-[13px] font-semibold">{t("downloads")}</p>
            {items.some((item) => item.status !== "downloading") ? (
              <button
                type="button"
                onClick={() => void clearFinished()}
                className="rounded-md px-2 py-1 text-[12px] text-dim hover:bg-white/8 hover:text-text"
              >
                {t("downloadsClear")}
              </button>
            ) : null}
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {items.map((item) => (
              <div key={item.id} className="rounded-lg px-3 py-2.5 hover:bg-white/5">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-muted">
                    {item.status === "downloading" ? (
                      <LoaderCircle size={14} className="animate-spin" />
                    ) : item.status === "done" ? (
                      <CheckCircle2 size={14} className="text-accent" />
                    ) : (
                      <X size={14} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-text" title={item.name}>
                      {item.name}
                    </p>
                    <p className={cn("truncate text-[11px] tabular", item.status === "error" ? "text-accent" : "text-dim")}>
                      {line(item)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {item.status === "done" ? (
                      <button
                        type="button"
                        onClick={() => void reveal(item.id)}
                        aria-label={t("downloadOpenFolder")}
                        title={t("downloadOpenFolder")}
                        className="grid h-8 w-8 place-items-center rounded-full text-dim hover:bg-white/10 hover:text-text"
                      >
                        <FolderOpen size={15} />
                      </button>
                    ) : null}
                    {item.status === "downloading" ? (
                      <button
                        type="button"
                        onClick={() => void cancel(item.id)}
                        aria-label={t("downloadCancel")}
                        title={t("downloadCancel")}
                        className="grid h-8 w-8 place-items-center rounded-full text-dim hover:bg-white/10 hover:text-text"
                      >
                        <X size={15} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void remove(item.id)}
                        aria-label={t("downloadRemove")}
                        title={t("downloadRemove")}
                        className="grid h-8 w-8 place-items-center rounded-full text-dim hover:bg-white/10 hover:text-text"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
                {item.status === "downloading" ? (
                  <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-white/12">
                    <div
                      className={cn("h-full rounded-full bg-accent", item.total <= 0 && "w-1/3 animate-pulse")}
                      style={item.total > 0 ? { width: `${percent(item)}%` } : undefined}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
