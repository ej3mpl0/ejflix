import { AlertCircle, ArrowLeft, Globe, RotateCcw, Users, X } from "lucide-react";
import type { Movie, TorrentStatus } from "../lib/types";
import { useI18n } from "../lib/locale-context";
import { formatBytes } from "../lib/format";
import { Pill } from "./Pill";

/**
 * What the main window shows while a file is being prepared (before mpv and the overlay
 * take over): the title over its backdrop, the torrent's live numbers when there is one,
 * a way to cancel, and — when starting failed — the error with retry / other source.
 */
export function StartCover({
  movie,
  heading,
  subheading,
  hint,
  torrent,
  error,
  onCancel,
  onRetry,
  onOtherSource,
}: {
  movie: Movie;
  heading: string;
  subheading: string;
  hint: string;
  torrent: TorrentStatus | null;
  error: string | null;
  onCancel: () => void;
  onRetry: () => void;
  /** Online titles: back to the source picker. */
  onOtherSource?: () => void;
}) {
  const { t } = useI18n();
  const percent =
    torrent && torrent.totalBytes > 0 ? Math.min(100, (torrent.progressBytes / torrent.totalBytes) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-base text-text">
      {movie.backdropUrl ? (
        <img src={movie.backdropUrl} alt="" className="fade-in absolute inset-0 h-full w-full object-cover opacity-40" />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/40" />
      <div className="absolute inset-0 grid place-items-center px-8">
        <div className="enter flex max-w-[560px] flex-col items-center gap-4 text-center">
          {movie.logoUrl ? (
            <img src={movie.logoUrl} alt={heading} className="max-h-[100px] max-w-[min(420px,70vw)] object-contain" />
          ) : (
            <h1 className="text-[clamp(26px,4vw,44px)] leading-[1.05] font-extrabold tracking-[-0.02em] [text-wrap:balance]">
              {heading}
            </h1>
          )}
          {subheading ? <p className="text-[15px] font-medium text-white/85">{subheading}</p> : null}

          {error ? (
            <div role="alert" className="mt-2 flex flex-col items-center gap-4">
              <p className="flex items-start gap-2 text-[14px] text-danger">
                <AlertCircle size={17} className="mt-0.5 shrink-0" />
                <span className="[overflow-wrap:anywhere]">{error}</span>
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Pill variant="primary" icon={<RotateCcw size={16} />} onClick={onRetry} data-autofocus>
                  {t("retry")}
                </Pill>
                {onOtherSource ? (
                  <Pill variant="tonal" icon={<Globe size={16} />} onClick={onOtherSource}>
                    {t("otherSource")}
                  </Pill>
                ) : null}
                <Pill variant="ghost" icon={<ArrowLeft size={16} />} onClick={onCancel}>
                  {t("back")}
                </Pill>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-2 h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-accent" />
              <p className="min-h-5 text-[13px] text-muted" role="status" aria-live="polite">
                {hint}
              </p>
              {torrent?.known ? (
                <div className="w-[min(320px,80vw)] space-y-2">
                  <div className="flex items-center justify-center gap-4 text-[12px] text-dim tabular">
                    <span className="inline-flex items-center gap-1.5">
                      <Users size={13} />
                      {t("torrentPeers", { n: torrent.peers })}
                    </span>
                    <span>{t("torrentSpeed", { speed: torrent.downMbps.toFixed(1) })}</span>
                    {torrent.totalBytes ? <span>{formatBytes(torrent.totalBytes)}</span> : null}
                  </div>
                  {percent > 0 ? (
                    <div className="h-1 overflow-hidden rounded-full bg-white/15">
                      <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${percent}%` }} />
                    </div>
                  ) : null}
                </div>
              ) : null}
              <Pill variant="ghost" size="sm" icon={<X size={14} />} onClick={onCancel} className="mt-2">
                {t("cancel")}
              </Pill>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
