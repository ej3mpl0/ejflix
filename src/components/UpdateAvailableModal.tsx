import { useMemo } from "react";
import { Download, ExternalLink, LoaderCircle } from "lucide-react";
import { Logo } from "./Logo";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { formatBytes, useUpdate } from "../lib/update-context";

type Block = { kind: "heading" | "bullet" | "text"; text: string };

/** Minimal markdown for GitHub release bodies: headings, bullets and paragraphs. */
function parseNotes(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const plain = line
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/\[(.+?)\]\((.+?)\)/g, "$1");
    if (/^#{1,6}\s/.test(plain)) blocks.push({ kind: "heading", text: plain.replace(/^#{1,6}\s+/, "") });
    else if (/^[-*•]\s/.test(plain)) blocks.push({ kind: "bullet", text: plain.replace(/^[-*•]\s+/, "") });
    else blocks.push({ kind: "text", text: plain });
  }
  // Drop a leading "# ejFlix x.y.z" heading: the dialog already says the version.
  if (blocks[0]?.kind === "heading" && /^ejflix\b/i.test(blocks[0].text)) blocks.shift();
  return blocks;
}

/** "A new version is available" dialog: notes from GitHub, download with progress, skip or later. */
export function UpdateAvailableModal() {
  const { t, locale } = useI18n();
  const { check, phase, progress, installError, downloadAndInstall, skipVersion, later, openRelease } = useUpdate();
  const blocks = useMemo(() => parseNotes(check?.notes ?? ""), [check?.notes]);
  if (!check) return null;

  const working = phase === "downloading" || phase === "installing";
  const percent =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;
  const primaryLabel =
    phase === "installing"
      ? t("updateInstalling")
      : phase === "downloading"
        ? t("updateDownloading", { percent })
        : check.assetSize
          ? t("updateDownloadSize", { size: formatBytes(check.assetSize, locale) })
          : t("updateDownload");

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 md:p-6" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <div className="modal-enter max-h-[calc(100vh-2rem)] w-[min(520px,92vw)] overflow-y-auto rounded-card bg-surface p-6 md:p-8 shadow-[0_24px_64px_rgb(0_0_0_/_0.45),0_0_0_1px_rgb(255_255_255_/_0.06)]">
        <div className="mb-4 text-center md:mb-6">
          <Logo size="login" />
        </div>
        <p className="mb-1 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">{t("update")}</p>
        <h2 id="update-title" className="mb-2 text-center text-[22px] font-semibold">
          {t("updateAvailable")}
        </h2>
        <p className="mb-5 text-center text-[14px] text-muted">
          {t("updateAvailableHint", { version: check.latest, current: check.current })}
        </p>

        {blocks.length ? (
          <div className="mb-6 max-h-[min(220px,30vh)] overflow-y-auto rounded-btn bg-black/25 px-4 py-3 text-[14px] leading-[1.55] text-muted">
            {blocks.map((block, i) =>
              block.kind === "heading" ? (
                <p key={i} className={cn("text-[12px] font-semibold uppercase tracking-wide text-dim", i > 0 && "mt-3")}>
                  {block.text}
                </p>
              ) : block.kind === "bullet" ? (
                <p key={i} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{block.text}</span>
                </p>
              ) : (
                <p key={i}>{block.text}</p>
              ),
            )}
          </div>
        ) : null}

        {check.assetUrl ? (
          <button
            type="button"
            disabled={working}
            onClick={() => void downloadAndInstall()}
            className="btn-press relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-btn bg-accent text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-progress"
          >
            {working ? (
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-black/20 transition-[width] duration-200 ease-std"
                style={{ width: `${phase === "installing" ? 100 : percent}%` }}
              />
            ) : null}
            <span className="relative flex items-center gap-2">
              {working ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
              {primaryLabel}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={openRelease}
            className="btn-press flex h-12 w-full items-center justify-center gap-2 rounded-btn bg-accent text-sm font-semibold text-on-accent hover:bg-accent-hover"
          >
            <ExternalLink size={16} />
            {t("updateViewGithub")}
          </button>
        )}
        <p className="mt-2 text-center text-[12px] text-dim">
          {installError ? (
            <span className="text-accent">{t("updateDownloadError", { error: installError })}</span>
          ) : check.assetUrl ? (
            t("updateInstallHint")
          ) : (
            t("updateNoAsset")
          )}
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-[13px]">
          <button type="button" onClick={openRelease} className="text-muted hover:text-text">
            {t("updateViewGithub")}
          </button>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <button type="button" disabled={working} onClick={() => void skipVersion()} className="text-dim hover:text-text disabled:opacity-50">
              {t("updateSkipVersion")}
            </button>
            <button type="button" disabled={working} onClick={later} className="font-semibold text-text hover:text-accent disabled:opacity-50">
              {t("updateLater")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
